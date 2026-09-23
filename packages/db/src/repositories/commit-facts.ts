import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { newId } from '@novelstruct/core';
import type { Db } from '../client.js';
import {
  bookEditions,
  chapters,
  entities,
  foreshadows,
  parseRuns,
  relationships,
  scenes,
  sourceRefs,
  stateChanges,
  stateFacts,
  storyEvents,
  reviewItems,
} from '../schema/index.js';

export interface FactEvidence {
  readonly charStart: number;
  readonly charEnd: number;
  readonly quote: string;
}
export interface StateProposal {
  readonly entityId: string;
  readonly field: string;
  readonly value: string;
  readonly confidence: number;
  readonly evidence: FactEvidence;
  readonly storyTime?: string;
}
export interface RelationProposal {
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly confidence: number;
  readonly evidence: FactEvidence;
  readonly storyTime?: string;
}
export interface EventProposal {
  readonly type: string;
  readonly summary: string;
  readonly actorId?: string;
  readonly targetId?: string;
  readonly sceneId?: string;
  readonly evidence: FactEvidence;
  readonly storyTime?: string;
}
export interface ForeshadowProposal {
  readonly summary: string;
  readonly evidence: FactEvidence;
}

export interface CommitFactsInput {
  readonly bookId: string;
  readonly editionId: string;
  readonly chapterId: string;
  readonly parseRunId?: string;
  /** Usage recorded atomically with the facts and the successful parse run. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  readonly states: readonly StateProposal[];
  readonly relationships: readonly RelationProposal[];
  readonly events: readonly EventProposal[];
  readonly foreshadows: readonly ForeshadowProposal[];
  readonly resolveForeshadowIds?: readonly string[];
}

const factId = (): string => `fact_${randomUUID()}`;

/** Validates every foreign reference and quote before any write, then appends facts with history. */
export async function commitConsistencyFacts(db: Db, input: CommitFactsInput): Promise<void> {
  await db.transaction(async (tx) => {
    const chapter = (await tx.select().from(chapters).where(eq(chapters.id, input.chapterId)).limit(1))[0];
    const edition = (await tx.select().from(bookEditions).where(eq(bookEditions.id, input.editionId)).limit(1))[0];
    if (!chapter || !edition || chapter.editionId !== input.editionId || edition.bookId !== input.bookId) {
      throw new Error('事实的章节、版本与书不匹配');
    }
    const all = [
      ...input.states.map((item) => item.evidence),
      ...input.relationships.map((item) => item.evidence),
      ...input.events.map((item) => item.evidence),
      ...input.foreshadows.map((item) => item.evidence),
    ];
    for (const evidence of all) {
      if (
        !Number.isInteger(evidence.charStart) ||
        !Number.isInteger(evidence.charEnd) ||
        evidence.charStart < 0 ||
        evidence.charEnd <= evidence.charStart ||
        chapter.text.slice(evidence.charStart, evidence.charEnd) !== evidence.quote
      ) {
        throw new Error(`证据引用无法匹配原文 [${evidence.charStart}, ${evidence.charEnd})`);
      }
    }
    const ids = new Set([
      ...input.states.map((item) => item.entityId),
      ...input.relationships.flatMap((item) => [item.subjectId, item.objectId]),
      ...input.events.flatMap((item) => [item.actorId, item.targetId].filter((id): id is string => !!id)),
    ]);
    if (ids.size) {
      const known = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.bookId, input.bookId), inArray(entities.id, [...ids])));
      if (known.length !== ids.size) throw new Error('事实引用了其他书或不存在的实体');
    }
    const sceneIds = new Set(input.events.map((event) => event.sceneId).filter((id): id is string => !!id));
    if (sceneIds.size) {
      const known = await tx
        .select({ id: scenes.id })
        .from(scenes)
        .where(and(eq(scenes.chapterId, input.chapterId), inArray(scenes.id, [...sceneIds])));
      if (known.length !== sceneIds.size) throw new Error('事件场景不属于本章');
    }
    if (input.resolveForeshadowIds?.length) {
      const unresolved = await tx
        .select({ id: foreshadows.id })
        .from(foreshadows)
        .where(
          and(
            eq(foreshadows.editionId, input.editionId),
            isNull(foreshadows.resolvedChapterId),
            inArray(foreshadows.id, [...input.resolveForeshadowIds]),
          ),
        );
      if (unresolved.length !== input.resolveForeshadowIds.length) throw new Error('伏笔不存在、重复引用或已经解决');
    }
    if (
      input.usage &&
      (!Number.isInteger(input.usage.inputTokens) ||
        !Number.isInteger(input.usage.outputTokens) ||
        input.usage.inputTokens < 0 ||
        input.usage.outputTokens < 0)
    ) {
      throw new Error('token 用量必须是非负整数');
    }
    if (input.parseRunId) {
      const run = (
        await tx
          .select({ chapterId: parseRuns.chapterId, pass: parseRuns.pass, status: parseRuns.status })
          .from(parseRuns)
          .where(eq(parseRuns.id, input.parseRunId))
          .limit(1)
      )[0];
      if (!run || run.chapterId !== input.chapterId || run.pass !== 'consistency' || run.status !== 'running')
        throw new Error('解析记录不是本章运行中的一致性遍');
    }
    const evidenceIds: string[] = [];
    if (all.length) {
      const rows = all.map((evidence) => ({
        id: newId('sourceRef'),
        editionId: input.editionId,
        chapterId: input.chapterId,
        ...evidence,
      }));
      await tx.insert(sourceRefs).values(rows);
      evidenceIds.push(...rows.map((row) => row.id));
    }
    let refIndex = 0;
    const previousStates = await tx
      .select({ id: stateFacts.id, entityId: stateFacts.entityId, field: stateFacts.field, value: stateFacts.value })
      .from(stateFacts)
      .innerJoin(chapters, eq(chapters.id, stateFacts.validFromChapterId))
      .where(
        and(
          eq(stateFacts.editionId, input.editionId),
          isNull(stateFacts.validToChapterId),
          lt(chapters.index, chapter.index),
        ),
      );
    const previousRelations = await tx
      .select({ id: relationships.id, subjectId: relationships.subjectId, predicate: relationships.predicate })
      .from(relationships)
      .innerJoin(chapters, eq(chapters.id, relationships.validFromChapterId))
      .where(
        and(
          eq(relationships.editionId, input.editionId),
          isNull(relationships.validToChapterId),
          lt(chapters.index, chapter.index),
        ),
      );
    const priorFacts = await tx
      .select({ id: stateFacts.id })
      .from(stateFacts)
      .where(and(eq(stateFacts.editionId, input.editionId), eq(stateFacts.validFromChapterId, input.chapterId)))
      .limit(1);
    const priorEvents = await tx
      .select({ id: storyEvents.id })
      .from(storyEvents)
      .where(and(eq(storyEvents.editionId, input.editionId), eq(storyEvents.chapterId, input.chapterId)))
      .limit(1);
    const priorForeshadows = await tx
      .select({ id: foreshadows.id })
      .from(foreshadows)
      .where(and(eq(foreshadows.editionId, input.editionId), eq(foreshadows.plantedChapterId, input.chapterId)))
      .limit(1);
    const priorRelations = await tx
      .select({ id: relationships.id })
      .from(relationships)
      .where(and(eq(relationships.editionId, input.editionId), eq(relationships.validFromChapterId, input.chapterId)))
      .limit(1);
    if (priorFacts.length || priorEvents.length || priorForeshadows.length || priorRelations.length)
      throw new Error('本章已有一致性事实，避免重复提交');
    const stateKeys = new Set<string>();
    for (const item of input.states) {
      const key = JSON.stringify([item.entityId, item.field]);
      if (stateKeys.has(key)) throw new Error('同一批事实不能重复定义同一实体字段');
      stateKeys.add(key);
    }
    const relationKeys = new Set<string>();
    for (const item of input.relationships) {
      const key = JSON.stringify([item.subjectId, item.predicate]);
      if (relationKeys.has(key)) throw new Error('同一批事实不能重复定义同一关系谓词');
      relationKeys.add(key);
    }
    for (const item of input.states) {
      const sourceRefId = evidenceIds[refIndex++]!;
      if (
        !item.field.trim() ||
        !item.value.trim() ||
        !Number.isFinite(item.confidence) ||
        item.confidence < 0 ||
        item.confidence > 1
      )
        throw new Error('状态字段、值与置信度无效');
      const previous = previousStates.find((fact) => fact.entityId === item.entityId && fact.field === item.field);
      if (previous?.value === item.value) continue;
      const id = factId();
      if (previous)
        await tx.update(stateFacts).set({ validToChapterId: input.chapterId }).where(eq(stateFacts.id, previous.id));
      await tx.insert(stateFacts).values({
        id,
        bookId: input.bookId,
        editionId: input.editionId,
        entityId: item.entityId,
        field: item.field,
        value: item.value,
        validFromChapterId: input.chapterId,
        confidence: item.confidence,
        sourceRefId,
        parseRunId: input.parseRunId ?? null,
        storyTime: item.storyTime ?? null,
      });
      if (item.confidence < 0.6)
        await tx.insert(reviewItems).values({
          id: `rev_${randomUUID()}`,
          bookId: input.bookId,
          editionId: input.editionId,
          chapterId: input.chapterId,
          kind: 'state',
          targetId: id,
          reason: '低置信度状态事实',
          confidence: item.confidence,
        });
      if (previous) {
        await tx.update(stateFacts).set({ supersededBy: id }).where(eq(stateFacts.id, previous.id));
        await tx.insert(stateChanges).values({
          id: factId(),
          entityId: item.entityId,
          field: item.field,
          fromValue: previous.value,
          toValue: item.value,
          chapterId: input.chapterId,
          sourceRefId,
        });
      }
    }
    for (const item of input.relationships) {
      const sourceRefId = evidenceIds[refIndex++]!;
      if (!item.predicate.trim() || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)
        throw new Error('关系谓词与置信度无效');
      const previous = previousRelations.find(
        (relation) => relation.subjectId === item.subjectId && relation.predicate === item.predicate,
      );
      const id = factId();
      if (previous)
        await tx
          .update(relationships)
          .set({ validToChapterId: input.chapterId })
          .where(eq(relationships.id, previous.id));
      await tx.insert(relationships).values({
        id,
        bookId: input.bookId,
        editionId: input.editionId,
        subjectId: item.subjectId,
        predicate: item.predicate,
        objectId: item.objectId,
        validFromChapterId: input.chapterId,
        confidence: item.confidence,
        sourceRefId,
        storyTime: item.storyTime ?? null,
        parseRunId: input.parseRunId ?? null,
      });
      if (item.confidence < 0.6)
        await tx.insert(reviewItems).values({
          id: `rev_${randomUUID()}`,
          bookId: input.bookId,
          editionId: input.editionId,
          chapterId: input.chapterId,
          kind: 'relationship',
          targetId: id,
          reason: '低置信度关系事实',
          confidence: item.confidence,
        });
      if (previous) await tx.update(relationships).set({ supersededBy: id }).where(eq(relationships.id, previous.id));
    }
    for (const item of input.events) {
      const sourceRefId = evidenceIds[refIndex++]!;
      if (!item.type.trim() || !item.summary.trim()) throw new Error('事件类型和摘要不能为空');
      await tx.insert(storyEvents).values({
        id: factId(),
        bookId: input.bookId,
        editionId: input.editionId,
        chapterId: input.chapterId,
        sceneId: item.sceneId ?? null,
        type: item.type,
        summary: item.summary,
        actorId: item.actorId ?? null,
        targetId: item.targetId ?? null,
        storyTime: item.storyTime ?? null,
        sourceRefId,
        parseRunId: input.parseRunId ?? null,
      });
    }
    for (const item of input.foreshadows) {
      const sourceRefId = evidenceIds[refIndex++]!;
      if (!item.summary.trim()) throw new Error('伏笔摘要不能为空');
      await tx.insert(foreshadows).values({
        id: factId(),
        bookId: input.bookId,
        editionId: input.editionId,
        plantedChapterId: input.chapterId,
        summary: item.summary,
        sourceRefId,
        parseRunId: input.parseRunId ?? null,
      });
    }
    if (input.resolveForeshadowIds?.length)
      await tx
        .update(foreshadows)
        .set({ resolvedChapterId: input.chapterId })
        .where(inArray(foreshadows.id, [...input.resolveForeshadowIds]));
    // A crash after this transaction cannot leave committed facts with a failed/running run.
    if (input.parseRunId) {
      await tx
        .update(parseRuns)
        .set({ status: 'succeeded', finishedAt: new Date(), ...(input.usage ?? {}) })
        .where(and(eq(parseRuns.id, input.parseRunId), eq(parseRuns.status, 'running')));
    }
  });
}
