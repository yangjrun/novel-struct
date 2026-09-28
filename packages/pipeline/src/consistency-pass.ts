import { z } from 'zod';
import { type ChapterIR, ChapterIRSchema, IR_VERSION, validateChapterIR } from '@novelstruct/core';
import {
  type Db,
  getChapterById,
  getEdition,
  listKnownEntities,
  scenes,
  segments,
  entityMentions,
  entities,
  sourceRefs,
  commitConsistencyFacts,
  type CommitFactsInput,
} from '@novelstruct/db';
import { buildConsistencyContext } from '@novelstruct/knowledge';
import { createOpenAICompatibleClient, LlmRequestRejectedError, type LlmClient } from '@novelstruct/parser';
import { asc, eq } from 'drizzle-orm';
import type { LlmEnv } from './env.js';
import { PipelineError } from './errors.js';
import { evidenceReviewCandidates, reviewInShadow, type ShadowJudge } from './shadow-review.js';
import { locateConsistencyEvidence } from './consistency-evidence.js';
import { CONSISTENCY_SYSTEM_PROMPT } from './consistency-prompt.js';

export const CONSISTENCY_PROMPT_VERSION = 'consistency-pass/0.3';

const Evidence = z.object({
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().positive().optional(),
  quote: z.string().min(1),
});
const Confidence = z.number().min(0).max(1);
export const ConsistencyFactsSchema = z.object({
  states: z
    .array(
      z.object({
        entityId: z.string(),
        field: z.string().min(1),
        value: z.string().min(1),
        confidence: Confidence,
        storyTime: z.string().optional(),
        evidence: Evidence,
      }),
    )
    .default([]),
  relationships: z
    .array(
      z.object({
        subjectId: z.string(),
        predicate: z.string().min(1),
        objectId: z.string(),
        confidence: Confidence,
        storyTime: z.string().optional(),
        evidence: Evidence,
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        type: z.string().min(1),
        summary: z.string().min(1),
        actorId: z.string().optional(),
        targetId: z.string().optional(),
        sceneId: z.string().optional(),
        storyTime: z.string().optional(),
        evidence: Evidence,
      }),
    )
    .default([]),
  foreshadows: z.array(z.object({ summary: z.string().min(1), evidence: Evidence })).default([]),
  resolveForeshadowIds: z.array(z.string()).default([]),
});

export interface ConsistencyPassOptions {
  readonly chapterId: string;
  readonly llm: LlmEnv;
  readonly budget?: number;
  readonly parseRunId?: string;
  readonly client?: LlmClient;
  readonly shadowJudge?: ShadowJudge;
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

/** Reconstructs a validated structure IR from stored results to make context reproducible. */
async function persistedChapterIR(db: Db, chapterId: string): Promise<{ ir: ChapterIR; text: string }> {
  const chapter = await getChapterById(db, chapterId);
  if (!chapter) throw new PipelineError('not_found', `章节 ${chapterId} 不存在`);
  const edition = await getEdition(db, chapter.editionId);
  if (!edition) throw new PipelineError('not_found', '章节版本不存在');
  const [sceneRows, segmentRows, mentionRows, entityRows] = await Promise.all([
    db.select().from(scenes).where(eq(scenes.chapterId, chapterId)).orderBy(asc(scenes.index)),
    db.select().from(segments).where(eq(segments.chapterId, chapterId)).orderBy(asc(segments.index)),
    db
      .select({
        entityId: entityMentions.entityId,
        surface: entityMentions.surface,
        charStart: sourceRefs.charStart,
        charEnd: sourceRefs.charEnd,
      })
      .from(entityMentions)
      .innerJoin(sourceRefs, eq(sourceRefs.id, entityMentions.sourceRefId))
      .where(eq(entityMentions.chapterId, chapterId))
      .orderBy(asc(sourceRefs.charStart)),
    db
      .select({ id: entities.id, type: entities.type, canonicalName: entities.canonicalName })
      .from(entities)
      .where(eq(entities.bookId, edition.book.id)),
  ]);
  if (!sceneRows.length || !segmentRows.length)
    throw new PipelineError('invalid_input', '章节尚未完成结构遍，不能运行一致性遍');
  const involvedIds = new Set([
    ...segmentRows.flatMap((s) => (s.speakerEntityId ? [s.speakerEntityId] : [])),
    ...mentionRows.map((m) => m.entityId),
  ]);
  const known = await listKnownEntities(db, edition.book.id);
  const ir = ChapterIRSchema.parse({
    irVersion: IR_VERSION,
    bookId: edition.book.id,
    editionId: edition.edition.id,
    chapterId,
    charCount: chapter.charCount,
    scenes: sceneRows.map((s) => ({
      id: s.id,
      index: s.index,
      charStart: s.charStart,
      charEnd: s.charEnd,
      characterIds: [],
      ...(s.summary ? { summary: s.summary } : {}),
      ...(s.location ? { location: s.location } : {}),
      ...(s.timeHint ? { timeHint: s.timeHint } : {}),
    })),
    segments: segmentRows.map((s) => ({
      id: s.id,
      index: s.index,
      sceneId: s.sceneId,
      kind: s.kind,
      charStart: s.charStart,
      charEnd: s.charEnd,
      ...(s.speakerEntityId || s.speakerSurface
        ? {
            speaker: {
              ...(s.speakerEntityId ? { entityId: s.speakerEntityId } : {}),
              ...(s.speakerSurface ? { surface: s.speakerSurface } : {}),
              confidence: s.speakerConfidence ?? 0,
            },
          }
        : {}),
      ...(s.emotionType ? { emotion: { type: s.emotionType, intensity: s.emotionIntensity ?? 0.5 } } : {}),
    })),
    entities: entityRows
      .filter((e) => involvedIds.has(e.id))
      .map((e) => ({ ...e, aliases: known.find((k) => k.id === e.id)?.aliases ?? [], isNew: false, confidence: 1 })),
    mentions: mentionRows,
    provenance: {
      pass: 'structure',
      attributor: 'stored',
      promptVersion: 'stored/0',
      normalizerVersion: edition.edition.normalizerVersion,
    },
  });
  const validation = validateChapterIR(ir, chapter.text);
  if (!validation.ok) throw new PipelineError('invalid_input', '已存结构遍结果与原文不一致，先重新解析结构遍');
  return { ir, text: chapter.text };
}

export type ConsistencyPreviewOptions = Pick<
  ConsistencyPassOptions,
  'chapterId' | 'llm' | 'budget' | 'client' | 'onUsage'
>;

/** Shared extraction and exact-evidence validation; never writes facts, runs or shadow reviews. */
async function extractConsistencyPass(db: Db, options: ConsistencyPreviewOptions) {
  const { ir, text } = await persistedChapterIR(db, options.chapterId);
  const context = await buildConsistencyContext(db, ir, { budget: options.budget ?? 3000 });
  const client = options.client ?? createOpenAICompatibleClient(options.llm);
  const response = await client.completeJson({
    system: CONSISTENCY_SYSTEM_PROMPT,
    user: JSON.stringify({
      chapterId: ir.chapterId,
      text,
      entityIds: ir.entities.map((e) => ({ id: e.id, name: e.canonicalName })),
      scenes: ir.scenes.map((s) => ({ id: s.id, charStart: s.charStart, charEnd: s.charEnd })),
      context: context.sections,
      outputSchema: z.toJSONSchema(ConsistencyFactsSchema),
    }),
  });
  if (response.usage) options.onUsage?.(response.usage);
  const content = response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (/^The request was rejected because it was considered high risk\b/i.test(content)) {
    throw new LlmRequestRejectedError(content.replace(/\s+/g, ' ').slice(0, 180));
  }
  if (response.finishReason === 'content_filter') {
    throw new LlmRequestRejectedError(
      `provider stopped the response with finish_reason: content_filter after ${content.length} characters`,
    );
  }
  let parsed: z.output<typeof ConsistencyFactsSchema>;
  try {
    parsed = ConsistencyFactsSchema.parse(JSON.parse(content));
  } catch (error) {
    const reason = response.finishReason === undefined ? '' : `; finish_reason: ${response.finishReason}`;
    throw new Error(
      `一致性遍模型输出无效：${error instanceof Error ? error.message : String(error)}; response length: ${content.length} characters${reason}; response preview: ${content.replace(/\s+/g, ' ').slice(0, 180)}`,
    );
  }
  const allowed = new Set(
    context.sections.filter((section) => section.kind === 'foreshadow').map((section) => section.reference),
  );
  if (parsed.resolveForeshadowIds.some((id) => !allowed.has(id))) {
    throw new Error('模型试图解决不在上下文中的伏笔');
  }
  if (new Set(parsed.resolveForeshadowIds).size !== parsed.resolveForeshadowIds.length)
    throw new Error('模型重复引用待解决伏笔');
  const entityIds = new Set(ir.entities.map((entity) => entity.id));
  const referencedIds = [
    ...parsed.states.map((fact) => fact.entityId),
    ...parsed.relationships.flatMap((fact) => [fact.subjectId, fact.objectId]),
    ...parsed.events.flatMap((fact) => [fact.actorId, fact.targetId].filter((id) => id !== undefined)),
  ];
  if (referencedIds.some((id) => !entityIds.has(id))) throw new Error('事实引用了本章候选之外的实体');
  const sceneIds = new Set(ir.scenes.map((scene) => scene.id));
  if (parsed.events.some((fact) => fact.sceneId !== undefined && !sceneIds.has(fact.sceneId)))
    throw new Error('事件场景不属于本章');
  const stateKeys = parsed.states.map((fact) => JSON.stringify([fact.entityId, fact.field]));
  const relationKeys = parsed.relationships.map((fact) => JSON.stringify([fact.subjectId, fact.predicate]));
  if (new Set(stateKeys).size !== stateKeys.length) throw new Error('同一批事实不能重复定义同一实体字段');
  if (new Set(relationKeys).size !== relationKeys.length) throw new Error('同一批事实不能重复定义同一关系谓词');
  const facts = {
    states: parsed.states.map((fact) => ({ ...fact, evidence: locateConsistencyEvidence(text, fact.evidence) })),
    relationships: parsed.relationships.map((fact) => ({
      ...fact,
      evidence: locateConsistencyEvidence(text, fact.evidence),
    })),
    events: parsed.events.map((fact) => ({ ...fact, evidence: locateConsistencyEvidence(text, fact.evidence) })),
    foreshadows: parsed.foreshadows.map((fact) => ({
      ...fact,
      evidence: locateConsistencyEvidence(text, fact.evidence),
    })),
    resolveForeshadowIds: parsed.resolveForeshadowIds,
  };
  return { ir, text, context, facts, usage: response.usage };
}

/** Re-evaluate stored structure against the current historical context without modifying the database. */
export async function previewConsistencyPass(db: Db, options: ConsistencyPreviewOptions) {
  const { ir, context, facts, usage } = await extractConsistencyPass(db, options);
  return {
    chapterId: ir.chapterId,
    editionId: ir.editionId,
    promptVersion: CONSISTENCY_PROMPT_VERSION,
    model: options.client?.model ?? options.llm.model,
    entities: ir.entities.map((entity) => ({ id: entity.id, name: entity.canonicalName })),
    context,
    facts,
    ...(usage ? { usage } : {}),
  };
}

export async function runConsistencyPass(
  db: Db,
  options: ConsistencyPassOptions,
): Promise<{ facts: number; usage?: { inputTokens: number; outputTokens: number }; shadowError?: string }> {
  const { ir, text, facts, usage } = await extractConsistencyPass(db, options);
  const input: CommitFactsInput = {
    bookId: ir.bookId,
    editionId: ir.editionId,
    chapterId: ir.chapterId,
    ...(options.parseRunId ? { parseRunId: options.parseRunId } : {}),
    ...(usage ? { usage } : {}),
    ...facts,
  };
  await commitConsistencyFacts(db, input);
  let shadowError: string | undefined;
  if (options.shadowJudge) {
    try {
      const candidates = evidenceReviewCandidates(text, [
        ...facts.states.map((s) => ({
          type: 'state',
          claim: `${ir.entities.find((e) => e.id === s.entityId)?.canonicalName ?? s.entityId} 的 ${s.field} 是 ${s.value}`,
          evidence: s.evidence,
        })),
        ...facts.relationships.map((r) => ({
          type: 'relationship',
          claim: `${ir.entities.find((e) => e.id === r.subjectId)?.canonicalName ?? r.subjectId} ${r.predicate} ${ir.entities.find((e) => e.id === r.objectId)?.canonicalName ?? r.objectId}`,
          evidence: r.evidence,
        })),
        ...facts.events.map((e) => ({
          type: 'event',
          claim: `${e.type}：${e.summary}${e.actorId ? `；行动者：${ir.entities.find((entity) => entity.id === e.actorId)?.canonicalName ?? e.actorId}` : ''}${e.targetId ? `；对象：${ir.entities.find((entity) => entity.id === e.targetId)?.canonicalName ?? e.targetId}` : ''}`,
          evidence: e.evidence,
        })),
        ...facts.foreshadows.map((f) => ({ type: 'foreshadow', claim: `伏笔：${f.summary}`, evidence: f.evidence })),
      ]);
      const shadow = await reviewInShadow(db, ir.chapterId, 'consistency', options.shadowJudge, candidates);
      shadowError = shadow.error;
    } catch (error) {
      shadowError = `复核结果未保存：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return {
    facts: facts.states.length + facts.relationships.length + facts.events.length + facts.foreshadows.length,
    ...(shadowError ? { shadowError } : {}),
    ...(usage ? { usage } : {}),
  };
}
