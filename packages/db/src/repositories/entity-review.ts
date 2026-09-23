import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { newId } from '@novelstruct/core';
import type { Db } from '../client.js';
import { bookEditions, chapters, entities, entityAliases, entityMerges, reviewItems } from '../schema/index.js';

export async function resolveEntityNameAt(
  db: Db,
  bookId: string,
  editionId: string,
  name: string,
  chapterIndex: number,
): Promise<string | undefined> {
  const matches = await db
    .select({ id: entities.id, canonicalName: entities.canonicalName })
    .from(entities)
    .where(and(eq(entities.bookId, bookId), eq(entities.status, 'active')))
    .orderBy(asc(entities.id));
  // Canonical names always identify active entities. Ambiguous names remain unresolved.
  const canonical = [...new Set(matches.filter((row) => row.canonicalName === name).map((row) => row.id))];
  if (canonical.length > 1) return undefined;
  const aliasRows = await db
    .select({
      id: entities.id,
      fromChapterId: entityAliases.validFromChapterId,
      toChapterId: entityAliases.validToChapterId,
    })
    .from(entityAliases)
    .innerJoin(entities, eq(entities.id, entityAliases.entityId))
    .where(and(eq(entities.bookId, bookId), eq(entities.status, 'active'), eq(entityAliases.alias, name)));
  const bounds = [
    ...new Set(
      aliasRows.flatMap((row) => [row.fromChapterId, row.toChapterId].filter((id): id is string => id !== null)),
    ),
  ];
  const chapterRows = bounds.length
    ? await db
        .select({ id: chapters.id, editionId: chapters.editionId, index: chapters.index })
        .from(chapters)
        .where(inArray(chapters.id, bounds))
    : [];
  const positions = new Map(chapterRows.map((row) => [row.id, row] as const));
  const possible = aliasRows.filter((row) => {
    if (row.fromChapterId && !positions.has(row.fromChapterId)) return false;
    if (row.toChapterId && !positions.has(row.toChapterId)) return false;
    const from = row.fromChapterId ? positions.get(row.fromChapterId) : undefined;
    const to = row.toChapterId ? positions.get(row.toChapterId) : undefined;
    return (
      (!from || (from.editionId === editionId && from.index <= chapterIndex)) &&
      (!to || (to.editionId === editionId && chapterIndex < to.index))
    );
  });
  const ids = [...new Set(possible.map((row) => row.id))];
  const candidates = [...new Set([...canonical, ...ids])];
  return candidates.length === 1 ? candidates[0] : undefined;
}

export async function setEntityAliasInterval(
  db: Db,
  input: { bookId: string; entityId: string; alias: string; fromChapterId?: string; toChapterId?: string },
): Promise<void> {
  const entity = (
    await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, input.entityId), eq(entities.bookId, input.bookId)))
      .limit(1)
  )[0];
  if (!entity || !input.alias.trim()) throw new Error('别名所属实体或别名无效');
  const bounds = [input.fromChapterId, input.toChapterId].filter((id): id is string => !!id);
  if (bounds.length) {
    const valid = await db
      .select({ id: chapters.id, index: chapters.index, editionId: chapters.editionId })
      .from(chapters)
      .innerJoin(bookEditions, eq(bookEditions.id, chapters.editionId))
      .where(and(eq(bookEditions.bookId, input.bookId), inArray(chapters.id, bounds)));
    if (valid.length !== bounds.length || (bounds.length === 2 && valid[0]?.editionId !== valid[1]?.editionId))
      throw new Error('别名章节区间必须属于同一本书的同一版本');
    if (
      bounds.length === 2 &&
      valid.find((c) => c.id === bounds[0])!.index >= valid.find((c) => c.id === bounds[1])!.index
    )
      throw new Error('别名区间结束章必须晚于开始章');
  }
  await db
    .insert(entityAliases)
    .values({
      id: newId('alias'),
      entityId: input.entityId,
      alias: input.alias.trim(),
      validFromChapterId: input.fromChapterId ?? null,
      validToChapterId: input.toChapterId ?? null,
    })
    .onConflictDoUpdate({
      target: [entityAliases.entityId, entityAliases.alias],
      set: { validFromChapterId: input.fromChapterId ?? null, validToChapterId: input.toChapterId ?? null },
    });
}

export async function enqueueEntityReview(
  db: Db,
  input: {
    bookId: string;
    editionId?: string;
    chapterId?: string;
    kind: string;
    targetId: string;
    reason: string;
    confidence: number;
  },
): Promise<string> {
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    throw new Error('置信度必须在 0 到 1 之间');
  const id = `rev_${randomUUID()}`;
  await db.insert(reviewItems).values({ id, ...input });
  return id;
}

export async function listEntityReviews(db: Db, bookId: string) {
  return db
    .select()
    .from(reviewItems)
    .where(eq(reviewItems.bookId, bookId))
    .orderBy(reviewItems.createdAt, reviewItems.id);
}

export async function finishEntityReview(db: Db, id: string, status: 'approved' | 'rejected'): Promise<boolean> {
  const rows = await db
    .update(reviewItems)
    .set({ status })
    .where(and(eq(reviewItems.id, id), eq(reviewItems.status, 'pending')))
    .returning({ id: reviewItems.id });
  return rows.length > 0;
}

export async function mergeEntities(
  db: Db,
  input: { bookId: string; fromId: string; intoId: string; reason: string; createdBy: string; chapterId?: string },
): Promise<void> {
  if (input.fromId === input.intoId || !input.reason.trim() || !input.createdBy.trim()) throw new Error('合并参数无效');
  await db.transaction(async (tx) => {
    const pair = await tx
      .select({ id: entities.id, type: entities.type, status: entities.status })
      .from(entities)
      .where(and(eq(entities.bookId, input.bookId), or(eq(entities.id, input.fromId), eq(entities.id, input.intoId))));
    if (pair.length !== 2 || pair[0]!.type !== pair[1]!.type || pair.some((p) => p.status !== 'active'))
      throw new Error('合并实体必须属于同一本书、状态有效且类型相同');
    if (input.chapterId) {
      const chapter = (
        await tx
          .select({ bookId: bookEditions.bookId })
          .from(chapters)
          .innerJoin(bookEditions, eq(bookEditions.id, chapters.editionId))
          .where(eq(chapters.id, input.chapterId))
          .limit(1)
      )[0];
      if (chapter?.bookId !== input.bookId) throw new Error('合并章节不属于本书');
    }
    await tx
      .update(entities)
      .set({ status: 'merged', mergedIntoId: input.intoId })
      .where(eq(entities.id, input.fromId));
    await tx.insert(entityMerges).values({
      id: `audit_${randomUUID()}`,
      bookId: input.bookId,
      fromEntityId: input.fromId,
      intoEntityId: input.intoId,
      kind: 'merge',
      reason: input.reason,
      createdBy: input.createdBy,
    });
    if (input.chapterId)
      await tx
        .update(entityAliases)
        .set({ validToChapterId: input.chapterId })
        .where(and(eq(entityAliases.entityId, input.fromId), isNull(entityAliases.validToChapterId)));
  });
}

export async function splitEntity(
  db: Db,
  input: { bookId: string; originalId: string; newName: string; reason: string; createdBy: string },
): Promise<string> {
  if (!input.newName.trim()) throw new Error('拆分后的实体名不能为空');
  const original = (
    await db
      .select()
      .from(entities)
      .where(and(eq(entities.bookId, input.bookId), eq(entities.id, input.originalId)))
      .limit(1)
  )[0];
  if (!original || original.status !== 'active') throw new Error('待拆分实体不存在或已合并');
  const id = newId('entity');
  await db.transaction(async (tx) => {
    await tx.insert(entities).values({
      id,
      bookId: input.bookId,
      type: original.type,
      canonicalName: input.newName,
      confidence: original.confidence,
    });
    await tx.insert(entityMerges).values({
      id: `audit_${randomUUID()}`,
      bookId: input.bookId,
      fromEntityId: original.id,
      intoEntityId: id,
      kind: 'split',
      reason: input.reason,
      createdBy: input.createdBy,
    });
  });
  return id;
}
