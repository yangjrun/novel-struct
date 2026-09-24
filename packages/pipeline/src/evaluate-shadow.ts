import { z } from 'zod';
import { type Db, getChapterByNumber, getEdition, listChapterSegments } from '@novelstruct/db';
import {
  evidenceReviewCandidates,
  judgeEvidence,
  judgeQuotes,
  quoteReviewCandidates,
  type EvidenceVerdict,
  type QuoteVerdict,
  type ShadowJudge,
} from './shadow-review.js';
import { PipelineError } from './errors.js';

const Base = z.object({
  chapter: z.number().int().positive(),
  quote: z.string().min(1),
  occurrence: z.number().int().positive().optional(),
});
const ShadowGold = z.discriminatedUnion('kind', [
  Base.extend({ kind: z.literal('quote'), expected: z.enum(['dialogue', 'thought', 'term', 'uncertain']) }),
  Base.extend({
    kind: z.literal('evidence'),
    claim: z.string().min(1),
    expected: z.enum(['supports', 'contradicts', 'insufficient']),
  }),
]);
export type ShadowGoldItem = z.output<typeof ShadowGold>;

export interface ShadowEvalItem {
  readonly gold: ShadowGoldItem;
  readonly predicted: QuoteVerdict | EvidenceVerdict;
  readonly confidence: number;
  readonly correct: boolean;
  /** The stored structure pass's answer, when the chapter has already been parsed. */
  readonly mainPrediction?: QuoteVerdict;
}

export interface ShadowEvalReport {
  readonly model: string;
  readonly requested: number;
  readonly assessed: number;
  readonly correct: number;
  readonly wrong: number;
  readonly uncertain: number;
  readonly quote: { readonly assessed: number; readonly correct: number; readonly wrong: number };
  readonly evidence: { readonly assessed: number; readonly correct: number; readonly wrong: number };
  readonly mainQuote: { readonly assessed: number; readonly correct: number; readonly wrong: number };
  /** Compare disagreements with stored structure outputs on labelled examples. */
  readonly disagreements: {
    readonly detectedErrors: number;
    readonly falseAlarms: number;
    readonly missedErrors: number;
  };
  readonly accuracy: number | null;
  readonly items: readonly ShadowEvalItem[];
  readonly failures: readonly { chapter: number; error: string }[];
  readonly missedByExtractor: readonly { chapter: number; quote: string }[];
}

export function parseShadowGold(text: string): ShadowGoldItem[] {
  const items: ShadowGoldItem[] = [];
  for (const [line, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    try {
      items.push(ShadowGold.parse(JSON.parse(raw)));
    } catch (error) {
      throw new PipelineError(
        'invalid_input',
        `影子复核金标第 ${line + 1} 行无效：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!items.length) throw new PipelineError('invalid_input', '影子复核金标为空');
  return items;
}

/** Evaluates labelled Chinese snippets without writing any model output to the database. */
export async function evaluateShadow(
  db: Db,
  editionId: string,
  gold: readonly ShadowGoldItem[],
  judge: ShadowJudge,
): Promise<ShadowEvalReport> {
  if (!(await getEdition(db, editionId))) throw new PipelineError('not_found', `版本 ${editionId} 不存在`);
  const groups = new Map<number, ShadowGoldItem[]>();
  for (const item of gold) groups.set(item.chapter, [...(groups.get(item.chapter) ?? []), item]);
  const items: ShadowEvalItem[] = [];
  const failures: { chapter: number; error: string }[] = [];
  const missedByExtractor: { chapter: number; quote: string }[] = [];
  for (const [number, chapterGold] of groups) {
    const chapter = await getChapterByNumber(db, editionId, number);
    if (!chapter) throw new PipelineError('not_found', `版本里没有第 ${number} 章`);
    const stored = await listChapterSegments(db, chapter.id);
    const hasMainResult = stored.length > 0;
    const allQuotes = quoteReviewCandidates(chapter.text, []);
    const quoteGold = chapterGold.filter((g) => g.kind === 'quote');
    const factGold = chapterGold.filter((g) => g.kind === 'evidence');
    // Locate all labelled spans before a provider error can be reported as an incomplete evaluation.
    const matchedQuotes = quoteGold.flatMap((g) => {
      const matches = allQuotes.filter((candidate) => candidate.source.includes(g.quote));
      if (matches.length === 0) {
        if (!chapter.text.includes(g.quote)) {
          throw new PipelineError('invalid_input', `第 ${number} 章金标「${g.quote}」在原文中不存在`);
        }
        missedByExtractor.push({ chapter: number, quote: g.quote });
        return [];
      }
      return [{ gold: g, candidate: locate(matches, g, number, (q) => q.source) }];
    });
    const quotes = matchedQuotes.map((entry) => entry.candidate);
    const evidence = evidenceReviewCandidates(
      chapter.text,
      factGold.map((g) => {
        const matches = [...chapter.text.matchAll(new RegExp(escapeRegex(g.quote), 'g'))].map((m) => m.index);
        const start = chooseMatch(matches, g, number);
        return {
          type: 'evidence',
          claim: g.claim,
          evidence: { charStart: start, charEnd: start + g.quote.length, quote: g.quote },
        };
      }),
    );
    if (quotes.length) {
      try {
        const quoteResults = await judgeQuotes(judge, quotes);
        for (const [index, { gold: g }] of matchedQuotes.entries()) {
          const result = quoteResults[index]!;
          items.push({
            gold: g,
            predicted: result.label as QuoteVerdict,
            confidence: result.confidence!,
            correct: result.label === g.expected,
            ...(hasMainResult
              ? {
                  mainPrediction: (stored.find(
                    (s) =>
                      s.charStart === quotes[index]!.charStart &&
                      s.charEnd === quotes[index]!.charEnd &&
                      s.kind !== 'narration',
                  )?.kind ?? 'term') as QuoteVerdict,
                }
              : {}),
          });
        }
      } catch (error) {
        failures.push({
          chapter: number,
          error: `引号判断：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    if (evidence.length) {
      try {
        const evidenceResults = await judgeEvidence(judge, evidence);
        for (const [index, g] of factGold.entries()) {
          const result = evidenceResults[index]!;
          items.push({
            gold: g,
            predicted: result.label as EvidenceVerdict,
            confidence: result.confidence!,
            correct: result.label === g.expected,
          });
        }
      } catch (error) {
        failures.push({
          chapter: number,
          error: `证据判断：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }
  const correct = items.filter((item) => item.correct).length;
  const counts = (kind: ShadowGoldItem['kind']) => {
    const selected = items.filter((item) => item.gold.kind === kind);
    const hits = selected.filter((item) => item.correct).length;
    return { assessed: selected.length, correct: hits, wrong: selected.length - hits };
  };
  const main = items.filter((item) => item.gold.kind === 'quote' && item.mainPrediction !== undefined);
  const mainCorrect = main.filter((item) => item.mainPrediction === item.gold.expected).length;
  const disagreements = {
    detectedErrors: main.filter((item) => item.mainPrediction !== item.gold.expected && item.correct).length,
    falseAlarms: main.filter((item) => item.mainPrediction === item.gold.expected && !item.correct).length,
    missedErrors: main.filter((item) => item.mainPrediction !== item.gold.expected && !item.correct).length,
  };
  return {
    model: judge.model,
    requested: gold.length,
    assessed: items.length,
    correct,
    wrong: items.length - correct,
    uncertain: items.filter((item) => item.predicted === 'uncertain' || item.predicted === 'insufficient').length,
    quote: counts('quote'),
    evidence: counts('evidence'),
    mainQuote: { assessed: main.length, correct: mainCorrect, wrong: main.length - mainCorrect },
    disagreements,
    accuracy: items.length ? correct / items.length : null,
    items,
    failures,
    missedByExtractor,
  };
}

function locate<T>(
  candidates: readonly T[],
  gold: ShadowGoldItem,
  chapter: number,
  source: (candidate: T) => string,
): T {
  const matches = candidates.filter((c) => source(c).includes(gold.quote));
  return matches[
    chooseMatch(
      matches.map((_, i) => i),
      gold,
      chapter,
    )
  ]!;
}

function chooseMatch(matches: readonly number[], gold: ShadowGoldItem, chapter: number): number {
  if (matches.length === 0 || (gold.occurrence === undefined && matches.length !== 1)) {
    throw new PipelineError(
      'invalid_input',
      `第 ${chapter} 章金标「${gold.quote}」${matches.length === 0 ? '找不到' : '不唯一，请指定 occurrence'}`,
    );
  }
  const picked = matches[(gold.occurrence ?? 1) - 1];
  if (picked === undefined)
    throw new PipelineError('invalid_input', `第 ${chapter} 章金标「${gold.quote}」occurrence 越界`);
  return picked;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
