import { z } from 'zod';
import type { Db, ShadowReviewInput } from '@novelstruct/db';
import { replaceShadowReviews } from '@novelstruct/db';
import { paragraphsFromText } from '@novelstruct/ingest';
import { extractQuotes } from '@novelstruct/parser';
import type { ShadowEnv } from './env.js';

const Unit = z.number().min(0).max(1);
const ChoiceAnswer = z.object({ type: z.literal('choice'), choice: z.string(), confidence: Unit });
const Reply = z.object({ model: z.string(), answers: z.record(z.string(), ChoiceAnswer) });
const MAX_BATCH = 8;
const TIMEOUT_MS = 30_000;

export type QuoteVerdict = 'dialogue' | 'thought' | 'term' | 'uncertain';
export type EvidenceVerdict = 'supports' | 'contradicts' | 'insufficient';

export interface ShadowChoice {
  readonly label: string;
  readonly confidence: number;
}

/** Dependency boundary; mocks can exercise every path without a remote Jev account. */
export interface ShadowJudge {
  readonly model: string;
  choose(
    state: unknown,
    questions: Readonly<
      Record<
        string,
        { readonly type: 'choice'; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
      >
    >,
  ): Promise<Readonly<Record<string, ShadowChoice>>>;
}

/** Jev's /v1/systemone is NOT the OpenAI-compatible chat/completions endpoint. */
export function createJevJudge(config: ShadowEnv, fetchImpl: typeof fetch = fetch): ShadowJudge {
  return {
    model: config.model,
    async choose(state, questions) {
      const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/systemone`;
      let response: Response;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify({ model: config.model, state, questions }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (error) {
          if (attempt >= 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        if (response.ok) break;
        if (![429, 529].includes(response.status) || attempt >= 2) {
          throw new Error(`TypeSafe returned HTTP ${response.status}`);
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      const reply = Reply.parse(await response.json());
      const answers: Record<string, ShadowChoice> = {};
      for (const [id, question] of Object.entries(questions)) {
        const answer = reply.answers[id];
        if (!answer || !Object.hasOwn(question.criteria, answer.choice))
          throw new Error(`TypeSafe missing or invalid choice for ${id}`);
        answers[id] = { label: answer.choice, confidence: answer.confidence };
      }
      return answers;
    },
  };
}

const QUOTE_CRITERIA: Record<QuoteVerdict, string> = {
  dialogue: '人物说出口的话，包括群聊或屏幕上人物发出的消息；不包含转述他人说话的术语。',
  thought: '人物内心想法或脑内独白，在此处没有说出口。',
  term: '叙述者在引用名称、术语、作品标题或其他非人物发言的文字。',
  uncertain: '上下文不能确认这处引号是发言、心声还是叙述术语。',
};
const EVIDENCE_CRITERIA: Record<EvidenceVerdict, string> = {
  supports: '上下文直接支持整个断言，包括涉及的人物与所述变化。',
  contradicts: '上下文直接否定整个断言。',
  insufficient: '上下文没有充分说明整个断言，或只有部分内容相关。',
};

export interface QuoteReviewCandidate {
  readonly charStart: number;
  readonly charEnd: number;
  readonly source: string;
  readonly context: string;
  readonly predicted: 'dialogue' | 'thought' | 'narration';
}

/** Include terms filtered by the deterministic extractor so omissions are visible in shadow mode. */
export function quoteReviewCandidates(
  text: string,
  spoken: readonly { charStart: number; charEnd: number; kind: string }[],
): QuoteReviewCandidate[] {
  const paragraphs = paragraphsFromText(text);
  return extractQuotes(text, paragraphs, { includeTerms: true }).quotes.map((q) => {
    const segment = spoken.find((s) => s.charStart === q.charStart && s.charEnd === q.charEnd);
    return {
      charStart: q.charStart,
      charEnd: q.charEnd,
      source: q.text,
      context: text.slice(Math.max(0, q.charStart - 180), Math.min(text.length, q.charEnd + 180)),
      predicted: segment?.kind === 'thought' ? 'thought' : segment ? 'dialogue' : 'narration',
    };
  });
}

export interface EvidenceReviewCandidate {
  readonly itemKey: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly source: string;
  readonly context: string;
  readonly claim: string;
}

/** Keep the source span and the surrounding passage together; offset arithmetic stays in code. */
export function evidenceReviewCandidates(
  text: string,
  facts: readonly {
    readonly type: string;
    readonly claim: string;
    readonly evidence: { readonly charStart: number; readonly charEnd: number; readonly quote: string };
  }[],
): EvidenceReviewCandidate[] {
  return facts.map((fact, index) => ({
    itemKey: `${fact.type}:${index}`,
    charStart: fact.evidence.charStart,
    charEnd: fact.evidence.charEnd,
    source: fact.evidence.quote,
    context: text.slice(Math.max(0, fact.evidence.charStart - 120), Math.min(text.length, fact.evidence.charEnd + 120)),
    claim: fact.claim,
  }));
}

/** Each question addresses one candidate. Small batches prevent unrelated prose from diluting the state. */
export async function judgeQuotes(
  judge: ShadowJudge,
  candidates: readonly QuoteReviewCandidate[],
): Promise<ShadowReviewInput[]> {
  const results: ShadowReviewInput[] = [];
  for (let start = 0; start < candidates.length; start += MAX_BATCH) {
    const batch = candidates.slice(start, start + MAX_BATCH);
    const questions = Object.fromEntries(
      batch.map((_, i) => [
        `q${i}`,
        {
          type: 'choice' as const,
          instructions: `判断 quotes 中 id 为 q${i} 的引号在小说中起什么作用。仅判断该 id 对应的引号；上下文中的其他引号只供参考。`,
          criteria: QUOTE_CRITERIA,
        },
      ]),
    );
    const answers = await judge.choose(
      { quotes: batch.map((c, i) => ({ id: `q${i}`, quote: c.source, context: c.context })) },
      questions,
    );
    batch.forEach((c, i) => {
      const answer = answers[`q${i}`]!;
      if (!Object.hasOwn(QUOTE_CRITERIA, answer.label))
        throw new Error(`TypeSafe returned invalid quote choice ${answer.label}`);
      results.push({
        itemKey: `quote:${c.charStart}`,
        charStart: c.charStart,
        charEnd: c.charEnd,
        source: c.source,
        claim: c.predicted,
        label: answer.label,
        confidence: answer.confidence,
      });
    });
  }
  return results;
}

export async function judgeEvidence(
  judge: ShadowJudge,
  candidates: readonly EvidenceReviewCandidate[],
): Promise<ShadowReviewInput[]> {
  const results: ShadowReviewInput[] = [];
  for (let start = 0; start < candidates.length; start += MAX_BATCH) {
    const batch = candidates.slice(start, start + MAX_BATCH);
    const questions = Object.fromEntries(
      batch.map((_, i) => [
        `f${i}`,
        {
          type: 'choice' as const,
          instructions: `判断 claims 中 id 为 f${i} 的原文引用和上下文是否支持该条小说事实断言。仅判断该 id；其他断言只供参考。`,
          criteria: EVIDENCE_CRITERIA,
        },
      ]),
    );
    const answers = await judge.choose(
      { claims: batch.map((c, i) => ({ id: `f${i}`, claim: c.claim, quote: c.source, context: c.context })) },
      questions,
    );
    batch.forEach((c, i) => {
      const answer = answers[`f${i}`]!;
      if (!Object.hasOwn(EVIDENCE_CRITERIA, answer.label))
        throw new Error(`TypeSafe returned invalid evidence choice ${answer.label}`);
      results.push({
        itemKey: c.itemKey,
        charStart: c.charStart,
        charEnd: c.charEnd,
        source: c.source,
        claim: c.claim,
        label: answer.label,
        confidence: answer.confidence,
      });
    });
  }
  return results;
}

/** Shadow failures are recorded and never affect the primary parse or replace its answer. */
export async function reviewInShadow(
  db: Db,
  chapterId: string,
  pass: 'structure' | 'consistency',
  judge: ShadowJudge,
  candidates: readonly QuoteReviewCandidate[] | readonly EvidenceReviewCandidate[],
): Promise<{ readonly error?: string }> {
  if (candidates.length === 0) {
    try {
      await replaceShadowReviews(db, chapterId, pass, judge.model, []);
      return {};
    } catch (error) {
      return { error: `复核结果未保存：${error instanceof Error ? error.message : String(error)}` };
    }
  }
  try {
    const reviews =
      pass === 'structure'
        ? await judgeQuotes(judge, candidates as readonly QuoteReviewCandidate[])
        : await judgeEvidence(judge, candidates as readonly EvidenceReviewCandidate[]);
    await replaceShadowReviews(db, chapterId, pass, judge.model, reviews);
    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await replaceShadowReviews(db, chapterId, pass, judge.model, [{ itemKey: 'error', error: message }]);
      return { error: message };
    } catch (writeError) {
      return {
        error: `${message}；复核错误未保存：${writeError instanceof Error ? writeError.message : String(writeError)}`,
      };
    }
  }
}
