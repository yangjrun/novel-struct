import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { sha256Hex } from '@novelstruct/core';
import { getChapterById, getEdition, listKnownEntities, scenes, type Db } from '@novelstruct/db';
import { ConsistencyFactsSchema } from './consistency-pass.js';
import { PipelineError } from './errors.js';
import type { ShadowJudge } from './shadow-review.js';

export const CONSISTENCY_REVIEW_VERSION = 'consistency-review/0.2';
const BATCH_SIZE = 1;
const SavedEvidence = z
  .object({
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().positive(),
    quote: z.string().min(1),
  })
  .strict();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const RevisionAuditBodySchema = z
  .object({
    version: z.literal('consistency-revision/0.2'),
    sourceHash: Hash,
    genesisPreviewHash: Hash,
    parentPreviewHash: Hash,
    parentAuditHash: Hash.nullable(),
    previewHash: Hash,
    editor: z.string().trim().min(1),
    changes: z
      .array(
        z
          .object({
            key: z.string().regex(/^(states|relationships|events|foreshadows):\d+$/),
            candidateHash: Hash,
            reason: z.string().trim().min(1),
            before: z.unknown(),
            after: z.unknown(),
          })
          .strict(),
      )
      .min(1),
    humanReview: z.literal('pending'),
  })
  .strict();
const RevisionAuditSchema = RevisionAuditBodySchema.extend({ auditHash: Hash });

export function hashRevisionAudit(audit: z.output<typeof RevisionAuditBodySchema>): string {
  return sha256Hex(JSON.stringify(RevisionAuditBodySchema.strip().parse(audit)));
}

export const SavedConsistencyPreviewSchema = z
  .object({
    chapterId: z.string().min(1),
    editionId: z.string().min(1),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    // Metadata is preserved for inspection, never used to build a claim or validate identity.
    entities: z.unknown().optional(),
    context: z.unknown().optional(),
    usage: z.unknown().optional(),
    revision: RevisionAuditSchema.optional(),
    revisionHistory: z.array(RevisionAuditSchema).min(1).optional(),
    facts: z
      .object({
        // Extraction-only timeEvidence is already expanded into the saved continuous evidence.
        states: z.array(
          ConsistencyFactsSchema.shape.states
            .removeDefault()
            .element.omit({ timeEvidence: true })
            .extend({ evidence: SavedEvidence })
            .strict(),
        ),
        relationships: z.array(
          ConsistencyFactsSchema.shape.relationships
            .removeDefault()
            .element.omit({ timeEvidence: true })
            .extend({ evidence: SavedEvidence })
            .strict(),
        ),
        events: z.array(
          ConsistencyFactsSchema.shape.events
            .removeDefault()
            .element.omit({ timeEvidence: true })
            .extend({ evidence: SavedEvidence })
            .strict(),
        ),
        foreshadows: z.array(
          ConsistencyFactsSchema.shape.foreshadows.removeDefault().element.extend({ evidence: SavedEvidence }).strict(),
        ),
        resolveForeshadowIds: ConsistencyFactsSchema.shape.resolveForeshadowIds.removeDefault(),
      })
      .strict(),
  })
  .strict();
const SavedConsistencyPreviewCoreSchema = SavedConsistencyPreviewSchema.omit({
  entities: true,
  context: true,
  usage: true,
  revision: true,
  revisionHistory: true,
}).strip();
type PreviewCore = z.output<typeof SavedConsistencyPreviewCoreSchema>;
type Audit = z.output<typeof RevisionAuditSchema>;
const FACT_GROUPS = ['states', 'relationships', 'events', 'foreshadows'] as const;

function reverseRevision(current: PreviewCore, audit: Audit): PreviewCore {
  const changes = new Map(audit.changes.map((change) => [change.key, change]));
  if (changes.size !== audit.changes.length) throw new PipelineError('invalid_input', '修订记录重复候选');
  const restored = Object.fromEntries(
    FACT_GROUPS.map((group) => {
      const rows = current.facts[group];
      const removed = audit.changes.filter((item) => item.key.startsWith(`${group}:`) && item.after === null).length;
      const count = rows.length + removed;
      if (audit.changes.some((item) => item.key.startsWith(`${group}:`) && Number(item.key.split(':')[1]) >= count))
        throw new PipelineError('invalid_input', '修订记录的候选下标越界');
      let cursor = 0;
      const previous = Array.from({ length: count }, (_, index) => {
        const change = changes.get(`${group}:${index}`);
        const next = rows[cursor];
        if (change && change.after !== null && JSON.stringify(next) !== JSON.stringify(change.after))
          throw new PipelineError('invalid_input', `修订后的候选与审计不符：${group}:${index}`);
        if (!change && next === undefined) throw new PipelineError('invalid_input', '修订记录缺少原始候选');
        if (change?.after !== null) cursor += 1;
        return change ? change.before : next;
      });
      if (cursor !== rows.length) throw new PipelineError('invalid_input', '修订记录存在越界候选');
      return [group, previous];
    }),
  );
  const candidate = SavedConsistencyPreviewCoreSchema.safeParse({
    ...current,
    facts: { ...current.facts, ...restored },
  });
  if (!candidate.success) throw new PipelineError('invalid_input', '审计记录包含无效的原始候选');
  return candidate.data;
}

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

/** Validate saved candidates before a review or revision; never invokes a model or writes data. */
export async function prepareConsistencyPreview(db: Db, value: unknown) {
  const parsed = SavedConsistencyPreviewSchema.safeParse(value);
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
  const previewHash = sha256Hex(JSON.stringify(SavedConsistencyPreviewCoreSchema.parse(preview)));
  const history = preview.revisionHistory ?? (preview.revision ? [preview.revision] : []);
  if (preview.revisionHistory && JSON.stringify(history.at(-1)) !== JSON.stringify(preview.revision))
    throw new PipelineError('invalid_input', '修订记录与历史末项不一致');
  if (
    history.some(
      (entry, index) =>
        entry.sourceHash !== sourceHash ||
        entry.auditHash !== hashRevisionAudit(entry) ||
        (index === 0 && (entry.genesisPreviewHash !== entry.parentPreviewHash || entry.parentAuditHash !== null)) ||
        (index > 0 &&
          (entry.genesisPreviewHash !== history[0]!.genesisPreviewHash ||
            entry.parentPreviewHash !== history[index - 1]!.previewHash ||
            entry.parentAuditHash !== history[index - 1]!.auditHash)) ||
        (index === history.length - 1 && entry.previewHash !== previewHash),
    )
  )
    throw new PipelineError('invalid_input', '修订审计链或预览哈希已失效');
  let prior = SavedConsistencyPreviewCoreSchema.parse(preview);
  for (const entry of [...history].reverse()) {
    prior = reverseRevision(prior, entry);
    const original = await prepareConsistencyPreview(db, prior);
    if (
      original.previewHash !== entry.parentPreviewHash ||
      entry.changes.some(
        (change) =>
          !original.candidates.some(
            (candidate) => candidate.key === change.key && candidate.candidateHash === change.candidateHash,
          ),
      )
    )
      throw new PipelineError('invalid_input', '修订前候选与审计记录不符');
  }
  const candidates: Candidate[] = [];
  const add = (
    key: string,
    claim: string,
    fact: { evidence: { quote: string; charStart: number; charEnd: number }; storyTime?: string },
  ) => {
    const { quote, charStart, charEnd } = fact.evidence;
    if (charEnd <= charStart || charEnd > chapter.text.length || chapter.text.slice(charStart, charEnd) !== quote)
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
  return { preview, chapter, sourceHash, candidates, previewHash };
}

/** Review saved candidates, not a new extraction. No facts, runs, reviews or statuses are written. */
export async function reviewConsistencyPreview(db: Db, value: unknown, judge: ShadowJudge) {
  const { preview, chapter, sourceHash, candidates, previewHash } = await prepareConsistencyPreview(db, value);
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
    previewHash,
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
