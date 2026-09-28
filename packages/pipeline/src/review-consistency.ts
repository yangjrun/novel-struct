import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { sha256Hex } from '@novelstruct/core';
import { getChapterById, getEdition, listKnownEntities, scenes, type Db } from '@novelstruct/db';
import { ConsistencyFactsSchema } from './consistency-pass.js';
import { PipelineError } from './errors.js';
import type { ShadowJudge } from './shadow-review.js';

export const CONSISTENCY_REVIEW_VERSION = 'consistency-review/0.1';
const BATCH_SIZE = 8;
const SavedPreview = z.object({
  chapterId: z.string().min(1),
  editionId: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  facts: z.object({
    states: ConsistencyFactsSchema.shape.states.removeDefault(),
    relationships: ConsistencyFactsSchema.shape.relationships.removeDefault(),
    events: ConsistencyFactsSchema.shape.events.removeDefault(),
    foreshadows: ConsistencyFactsSchema.shape.foreshadows.removeDefault(),
    resolveForeshadowIds: ConsistencyFactsSchema.shape.resolveForeshadowIds.removeDefault(),
  }),
});
const Answer = z.object({
  label: z.enum(['supports', 'contradicts', 'insufficient']),
  confidence: z.number().min(0).max(1),
});
type Verdict = z.output<typeof Answer>['label'];
interface Candidate {
  readonly key: string;
  readonly claim: string;
  readonly candidateHash: string;
  readonly evidence: { readonly quote: string; readonly charStart: number; readonly charEnd: number };
}
export interface ConsistencyReviewItem extends Candidate {
  readonly verdict: Verdict | null;
  readonly confidence: number | null;
  readonly error: string | null;
  /** Model opinions never constitute human approval. */
  readonly humanReview: 'pending';
}
const criteria: Record<Verdict, string> = {
  supports: '仅给定 quote 就能支持整条断言，包括人物、数量、时间和结果；不能借用其他原文或常识补全事实。',
  contradicts: 'quote 明确否定断言的某项内容；未提到某项内容不算否定。',
  insufficient: 'quote 只支持部分断言，或人物所指、时间、数量、结果无法仅凭这条引用确认。',
};

/** Review saved candidates, not a new extraction. No facts, runs, reviews or statuses are written. */
export async function reviewConsistencyPreview(db: Db, value: unknown, judge: ShadowJudge) {
  const parsed = SavedPreview.safeParse(value);
  if (!parsed.success) throw new PipelineError('invalid_input', `一致性预览文件格式无效：${parsed.error.message}`);
  const preview = parsed.data;
  const chapter = await getChapterById(db, preview.chapterId);
  if (!chapter || chapter.editionId !== preview.editionId)
    throw new PipelineError('invalid_input', '预览的章节与版本不匹配');
  const edition = await getEdition(db, preview.editionId);
  if (!edition) throw new PipelineError('not_found', '预览版本不存在');
  const entities = await listKnownEntities(db, edition.book.id);
  const names = new Map(entities.map((entity) => [entity.id, entity.canonicalName]));
  const chapterScenes = new Set(
    (await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.chapterId, chapter.id))).map((scene) => scene.id),
  );
  const name = (id: string): string => {
    const found = names.get(id);
    if (!found) throw new PipelineError('invalid_input', `预览引用了不存在、失效或其他书的实体：${id}`);
    return found;
  };
  const sourceHash = sha256Hex(chapter.text);
  const candidates: Candidate[] = [];
  const add = (
    key: string,
    claim: string,
    fact: { evidence: { quote: string; charStart?: number; charEnd?: number }; storyTime?: string },
  ) => {
    const { quote, charStart, charEnd } = fact.evidence;
    if (
      charStart === undefined ||
      charEnd === undefined ||
      charEnd <= charStart ||
      charEnd > chapter.text.length ||
      chapter.text.slice(charStart, charEnd) !== quote
    )
      throw new PipelineError('invalid_input', `预览证据已失效或缺少准确偏移：${key}，请重新预览`);
    const completeClaim = `${claim}${fact.storyTime === undefined ? '' : `；故事时间：${fact.storyTime}`}`;
    candidates.push({
      key,
      claim: completeClaim,
      evidence: { quote, charStart, charEnd },
      candidateHash: sha256Hex(JSON.stringify({ chapterId: chapter.id, sourceHash, key, claim: completeClaim, fact })),
    });
  };
  preview.facts.states.forEach((fact, i) =>
    add(`states:${i}`, `${name(fact.entityId)} 的 ${fact.field} 是 ${fact.value}`, fact),
  );
  preview.facts.relationships.forEach((fact, i) =>
    add(`relationships:${i}`, `${name(fact.subjectId)} ${fact.predicate} ${name(fact.objectId)}`, fact),
  );
  preview.facts.events.forEach((fact, i) => {
    if (fact.sceneId !== undefined && !chapterScenes.has(fact.sceneId))
      throw new PipelineError('invalid_input', `预览事件的场景不属于本章：events:${i}`);
    add(
      `events:${i}`,
      `${fact.type}：${fact.summary}${fact.actorId === undefined ? '' : `；行动者：${name(fact.actorId)}`}${fact.targetId === undefined ? '' : `；对象：${name(fact.targetId)}`}`,
      fact,
    );
  });
  preview.facts.foreshadows.forEach((fact, i) => add(`foreshadows:${i}`, `伏笔：${fact.summary}`, fact));
  const items: ConsistencyReviewItem[] = [];
  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE);
    let answers: Awaited<ReturnType<ShadowJudge['choose']>>;
    try {
      answers = await judge.choose(
        {
          claims: batch.map((candidate, i) => ({
            id: `f${i}`,
            claim: candidate.claim,
            quote: candidate.evidence.quote,
          })),
        },
        Object.fromEntries(
          batch.map((_, i) => [
            `f${i}`,
            {
              type: 'choice' as const,
              instructions: `只用 claims 中 f${i} 自己的 quote 判断该 claim 是否完整被支持。不得使用其他候选的 quote、未提供的前后文或预览历史上下文补齐证据。检查断言中每项信息，包括故事时间；无法消解的代词按证据不足处理。这只是机器意见，不能替代人工认可。`,
              criteria,
            },
          ]),
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      items.push(
        ...batch.map((candidate) => ({
          ...candidate,
          verdict: null,
          confidence: null,
          error: message,
          humanReview: 'pending' as const,
        })),
      );
      continue;
    }
    batch.forEach((candidate, i) => {
      const answer = Answer.safeParse(answers[`f${i}`]);
      items.push({
        ...candidate,
        verdict: answer.success ? answer.data.label : null,
        confidence: answer.success ? answer.data.confidence : null,
        error: answer.success ? null : `复核结果缺失或无效：${candidate.key}`,
        humanReview: 'pending',
      });
    });
  }
  const assessed = items.filter((item) => item.verdict !== null).length;
  return {
    reviewVersion: CONSISTENCY_REVIEW_VERSION,
    scope: 'quote-only' as const,
    judgeModel: judge.model,
    extractionModel: preview.model,
    promptVersion: preview.promptVersion,
    chapterId: chapter.id,
    editionId: preview.editionId,
    sourceHash,
    previewHash: sha256Hex(JSON.stringify(preview)),
    requested: candidates.length + preview.facts.resolveForeshadowIds.length,
    assessed,
    unassessed: candidates.length - assessed + preview.facts.resolveForeshadowIds.length,
    counts: {
      supports: items.filter((item) => item.verdict === 'supports').length,
      insufficient: items.filter((item) => item.verdict === 'insufficient').length,
      contradicts: items.filter((item) => item.verdict === 'contradicts').length,
      errors: items.filter((item) => item.error !== null).length,
    },
    // The current extraction format has no evidence attached to a resolution, so do not mark these as reviewed.
    unassessedResolutionIds: preview.facts.resolveForeshadowIds,
    items,
  };
}
