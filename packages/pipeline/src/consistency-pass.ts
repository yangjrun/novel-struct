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
import { createOpenAICompatibleClient, type LlmClient } from '@novelstruct/parser';
import { asc, eq } from 'drizzle-orm';
import type { LlmEnv } from './env.js';
import { PipelineError } from './errors.js';
import { evidenceReviewCandidates, reviewInShadow, type ShadowJudge } from './shadow-review.js';

export const CONSISTENCY_PROMPT_VERSION = 'consistency-pass/0.1';

const Evidence = z.object({
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().positive(),
  quote: z.string().min(1),
});
const Confidence = z.number().min(0).max(1);
const Output = z.object({
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

export async function runConsistencyPass(
  db: Db,
  options: ConsistencyPassOptions,
): Promise<{ facts: number; usage?: { inputTokens: number; outputTokens: number }; shadowError?: string }> {
  const { ir, text } = await persistedChapterIR(db, options.chapterId);
  const context = await buildConsistencyContext(db, ir, { budget: options.budget ?? 3000 });
  const client = options.client ?? createOpenAICompatibleClient(options.llm);
  const response = await client.completeJson({
    system:
      '你是小说事实抽取器。只根据给出的本章原文输出 JSON。每个事实引用必须包含本章原文的 UTF-16 charStart/charEnd 和严格等于切片的 quote；实体及场景只能使用列表里的 ID；不要编造不存在的证据。输出 {"states":[],"relationships":[],"events":[],"foreshadows":[],"resolveForeshadowIds":[]}。resolveForeshadowIds 只能选取上下文中 foreshadow 项的 reference。状态字段用稳定名称，同一字段只给一个最终值。故事时间不确定时省略。',
    user: JSON.stringify({
      chapterId: ir.chapterId,
      text,
      entityIds: ir.entities.map((e) => ({ id: e.id, name: e.canonicalName })),
      scenes: ir.scenes.map((s) => ({ id: s.id, charStart: s.charStart, charEnd: s.charEnd })),
      context: context.sections,
    }),
  });
  if (response.usage) options.onUsage?.(response.usage);
  let parsed: z.output<typeof Output>;
  try {
    parsed = Output.parse(JSON.parse(response.content.replace(/^```(?:json)?\s*|\s*```$/g, '')));
  } catch (error) {
    throw new Error(`一致性遍模型输出无效：${error instanceof Error ? error.message : String(error)}`);
  }
  const allowed = new Set(
    context.sections.filter((section) => section.kind === 'foreshadow').map((section) => section.reference),
  );
  if (parsed.resolveForeshadowIds.some((id) => !allowed.has(id))) {
    throw new Error('模型试图解决不在上下文中的伏笔');
  }
  const input: CommitFactsInput = {
    bookId: ir.bookId,
    editionId: ir.editionId,
    chapterId: ir.chapterId,
    ...(options.parseRunId ? { parseRunId: options.parseRunId } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
    ...parsed,
  };
  await commitConsistencyFacts(db, input);
  let shadowError: string | undefined;
  if (options.shadowJudge) {
    try {
      const candidates = evidenceReviewCandidates(text, [
        ...parsed.states.map((s) => ({
          type: 'state',
          claim: `${ir.entities.find((e) => e.id === s.entityId)?.canonicalName ?? s.entityId} 的 ${s.field} 是 ${s.value}`,
          evidence: s.evidence,
        })),
        ...parsed.relationships.map((r) => ({
          type: 'relationship',
          claim: `${ir.entities.find((e) => e.id === r.subjectId)?.canonicalName ?? r.subjectId} ${r.predicate} ${ir.entities.find((e) => e.id === r.objectId)?.canonicalName ?? r.objectId}`,
          evidence: r.evidence,
        })),
        ...parsed.events.map((e) => ({
          type: 'event',
          claim: `${e.type}：${e.summary}${e.actorId ? `；行动者：${ir.entities.find((entity) => entity.id === e.actorId)?.canonicalName ?? e.actorId}` : ''}${e.targetId ? `；对象：${ir.entities.find((entity) => entity.id === e.targetId)?.canonicalName ?? e.targetId}` : ''}`,
          evidence: e.evidence,
        })),
        ...parsed.foreshadows.map((f) => ({ type: 'foreshadow', claim: `伏笔：${f.summary}`, evidence: f.evidence })),
      ]);
      const shadow = await reviewInShadow(db, ir.chapterId, 'consistency', options.shadowJudge, candidates);
      shadowError = shadow.error;
    } catch (error) {
      shadowError = `复核结果未保存：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return {
    facts: parsed.states.length + parsed.relationships.length + parsed.events.length + parsed.foreshadows.length,
    ...(shadowError ? { shadowError } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
  };
}
