import { UNKNOWN_SPEAKER_SURFACE } from '@novelstruct/core';
import { type Db, getChapterByNumber, getEdition, listKnownEntities } from '@novelstruct/db';
import { type QuoteSpan, runStructurePass } from '@novelstruct/parser';
import { type AttributorChoice, type AttributorName, chooseAttributor } from './attributors.js';
import type { LlmEnv } from './env.js';
import { PipelineError } from './errors.js';
import type { GoldItem } from './gold.js';

export interface EvaluateOptions {
  readonly editionId: string;
  readonly gold: readonly GoldItem[];
  readonly attributor?: AttributorName;
  readonly llm?: LlmEnv;
  /** Progress per chapter, for a CLI that would otherwise sit silent while a model works. */
  readonly onProgress?: (event: EvalProgressEvent) => void;
}

export type EvalProgressEvent =
  | {
      readonly type: 'chapter_start';
      readonly chapter: number;
      readonly chapterIndex: number;
      readonly charCount: number;
      readonly goldCount: number;
    }
  | {
      readonly type: 'chapter_done';
      readonly chapter: number;
      readonly chapterIndex: number;
      readonly elapsedMs: number;
      readonly warnings: readonly string[];
    };

export type EvalOutcome = 'correct' | 'wrong' | 'unattributed';

export interface EvalItemResult {
  readonly gold: GoldItem;
  readonly chapterIndex: number;
  /** The quote as extracted, with its marks. */
  readonly quoteText: string;
  readonly expected: string;
  /** What the attributor answered: the resolved canonical name, else the surface, else null. */
  readonly predicted: string | null;
  readonly confidence: number;
  readonly outcome: EvalOutcome;
}

export interface EvalChapterSummary {
  readonly chapter: number;
  readonly chapterIndex: number;
  readonly total: number;
  readonly correct: number;
  readonly wrong: number;
  readonly unattributed: number;
}

export interface EvalReport {
  readonly attributor: string;
  readonly promptVersion: string;
  readonly model?: string;
  readonly total: number;
  readonly correct: number;
  readonly wrong: number;
  readonly unattributed: number;
  /** correct / total, 0 when total is 0. */
  readonly accuracy: number;
  readonly items: readonly EvalItemResult[];
  readonly chapters: readonly EvalChapterSummary[];
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

/**
 * Runs the structure pass on every chapter the gold set mentions, without writing anything, and
 * scores the speaker of each labelled quote. Known entities come from the database as it is
 * now, exactly as a real parse of those chapters would see them.
 */
export async function evaluateAttribution(db: Db, options: EvaluateOptions): Promise<EvalReport> {
  const choice = chooseAttributor(options.attributor ?? 'heuristic', options.llm);
  const found = await getEdition(db, options.editionId);
  if (found === undefined) throw new PipelineError('not_found', `版本 ${options.editionId} 不存在`);
  const knownEntities = await listKnownEntities(db, found.book.id);

  const items: EvalItemResult[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  for (const [number, goldItems] of groupByChapter(options.gold)) {
    const chapter = await getChapterByNumber(db, options.editionId, number);
    if (chapter === undefined) throw new PipelineError('not_found', `版本里没有第 ${number} 章，无法评测其金标`);
    options.onProgress?.({
      type: 'chapter_start',
      chapter: number,
      chapterIndex: chapter.index,
      charCount: chapter.charCount,
      goldCount: goldItems.length,
    });
    const startedAt = Date.now();
    const result = await runStructurePass({
      bookId: found.book.id,
      editionId: found.edition.id,
      chapterId: chapter.id,
      text: chapter.text,
      normalizerVersion: found.edition.normalizerVersion,
      knownEntities,
      attributor: choice.attributor,
    });
    options.onProgress?.({
      type: 'chapter_done',
      chapter: number,
      chapterIndex: chapter.index,
      elapsedMs: Date.now() - startedAt,
      warnings: result.warnings,
    });
    if (result.usage !== undefined) {
      sawUsage = true;
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
    }
    const nameById = new Map(result.ir.entities.map((e) => [e.id, e.canonicalName] as const));
    knownEntities.forEach((k) => nameById.set(k.id, k.canonicalName));
    const spoken = result.ir.segments.filter((s) => s.kind !== 'narration');
    for (const gold of goldItems) {
      const segment = locateQuote(chapter.text, spoken, gold, number);
      items.push(
        scoreItem(gold, chapter.index, chapter.text.slice(segment.charStart, segment.charEnd), segment, nameById),
      );
    }
  }

  return buildReport(choice, items, sawUsage ? { inputTokens, outputTokens } : undefined);
}

function groupByChapter(gold: readonly GoldItem[]): ReadonlyMap<number, readonly GoldItem[]> {
  const grouped = new Map<number, GoldItem[]>();
  for (const item of gold) grouped.set(item.chapter, [...(grouped.get(item.chapter) ?? []), item]);
  return new Map([...grouped.entries()].sort((a, b) => a[0] - b[0]));
}

type SpokenSegment = Pick<QuoteSpan, 'charStart' | 'charEnd'> & {
  readonly speaker?: { readonly entityId?: string; readonly surface?: string; readonly confidence: number };
};

function locateQuote(text: string, spoken: readonly SpokenSegment[], gold: GoldItem, number: number): SpokenSegment {
  const matches = spoken.filter((s) => text.slice(s.charStart, s.charEnd).includes(gold.quote));
  if (matches.length === 0) {
    throw new PipelineError('invalid_input', `第 ${number} 章没有包含「${gold.quote}」的对白，检查金标文本`);
  }
  if (gold.occurrence !== undefined) {
    const picked = matches[gold.occurrence - 1];
    if (picked === undefined) {
      throw new PipelineError(
        'invalid_input',
        `第 ${number} 章只有 ${matches.length} 条对白包含「${gold.quote}」，occurrence ${gold.occurrence} 越界`,
      );
    }
    return picked;
  }
  if (matches.length > 1) {
    throw new PipelineError(
      'invalid_input',
      `第 ${number} 章有 ${matches.length} 条对白包含「${gold.quote}」，请加长引文或指定 occurrence`,
    );
  }
  return matches[0]!;
}

function scoreItem(
  gold: GoldItem,
  chapterIndex: number,
  quoteText: string,
  segment: SpokenSegment,
  nameById: ReadonlyMap<string, string>,
): EvalItemResult {
  const speaker = segment.speaker;
  const predicted = predictedName(speaker, nameById);
  const accepted = new Set([gold.speaker, ...gold.aliases]);
  const outcome: EvalOutcome = predicted === null ? 'unattributed' : accepted.has(predicted) ? 'correct' : 'wrong';
  return {
    gold,
    chapterIndex,
    quoteText,
    expected: gold.speaker,
    predicted,
    confidence: speaker?.confidence ?? 0,
    outcome,
  };
}

function predictedName(speaker: SpokenSegment['speaker'], nameById: ReadonlyMap<string, string>): string | null {
  if (speaker === undefined) return null;
  const canonical = speaker.entityId === undefined ? undefined : nameById.get(speaker.entityId);
  const name = canonical ?? speaker.surface;
  return name === undefined || name === UNKNOWN_SPEAKER_SURFACE ? null : name;
}

function buildReport(
  choice: AttributorChoice,
  items: readonly EvalItemResult[],
  usage: EvalReport['usage'],
): EvalReport {
  const count = (list: readonly EvalItemResult[], outcome: EvalOutcome): number =>
    list.filter((i) => i.outcome === outcome).length;
  const chapters = [...new Map(items.map((i) => [i.gold.chapter, i.chapterIndex] as const)).entries()].map(
    ([chapter, chapterIndex]): EvalChapterSummary => {
      const own = items.filter((i) => i.gold.chapter === chapter);
      return {
        chapter,
        chapterIndex,
        total: own.length,
        correct: count(own, 'correct'),
        wrong: count(own, 'wrong'),
        unattributed: count(own, 'unattributed'),
      };
    },
  );
  const correct = count(items, 'correct');
  return {
    attributor: choice.attributor.name,
    promptVersion: choice.attributor.promptVersion,
    ...(choice.model === undefined ? {} : { model: choice.model }),
    total: items.length,
    correct,
    wrong: count(items, 'wrong'),
    unattributed: count(items, 'unattributed'),
    accuracy: items.length === 0 ? 0 : correct / items.length,
    items,
    chapters,
    ...(usage === undefined ? {} : { usage }),
  };
}
