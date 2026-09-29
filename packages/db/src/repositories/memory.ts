import { and, eq, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { books, foreshadows, memoryItems, relationships, stateFacts, storyEvents } from '../schema/index.js';

/** Serialize rebuilds, incremental refreshes and invalidation using the canonical book row. */
export async function lockBookMemory(tx: Db, bookId: string): Promise<void> {
  const rows = await tx.select({ id: books.id }).from(books).where(eq(books.id, bookId)).for('update');
  if (!rows.length) throw new Error(`书 ${bookId} 不存在`);
}

/** Called inside the fact transaction; includes superseded states and resolved clues. */
export async function refreshMemoryFromFacts(db: Db, bookId: string, chapterId?: string): Promise<number> {
  const [states, relations, events, clues] = await Promise.all([
    db
      .select()
      .from(stateFacts)
      .where(
        and(
          eq(stateFacts.bookId, bookId),
          chapterId === undefined
            ? undefined
            : or(eq(stateFacts.validFromChapterId, chapterId), eq(stateFacts.validToChapterId, chapterId)),
        ),
      ),
    db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.bookId, bookId),
          chapterId === undefined
            ? undefined
            : or(eq(relationships.validFromChapterId, chapterId), eq(relationships.validToChapterId, chapterId)),
        ),
      ),
    db
      .select()
      .from(storyEvents)
      .where(
        and(eq(storyEvents.bookId, bookId), chapterId === undefined ? undefined : eq(storyEvents.chapterId, chapterId)),
      ),
    db
      .select()
      .from(foreshadows)
      .where(
        and(
          eq(foreshadows.bookId, bookId),
          chapterId === undefined
            ? undefined
            : or(eq(foreshadows.plantedChapterId, chapterId), eq(foreshadows.resolvedChapterId, chapterId)),
        ),
      ),
  ]);
  const items = [
    ...states.map((f) => ({
      id: `mem_state_${f.id}`,
      bookId,
      editionId: f.editionId,
      room: 'state',
      entityId: f.entityId,
      content: `${f.field}: ${f.value}`,
      validFromChapterId: f.validFromChapterId,
      validToChapterId: f.validToChapterId,
      sourceFactTable: 'state_facts',
      sourceFactId: f.id,
    })),
    ...relations.map((f) => ({
      id: `mem_relation_${f.id}`,
      bookId,
      editionId: f.editionId,
      room: 'relationship',
      entityId: f.subjectId,
      content: `${f.subjectId} ${f.predicate} ${f.objectId}`,
      validFromChapterId: f.validFromChapterId,
      validToChapterId: f.validToChapterId,
      sourceFactTable: 'relationships',
      sourceFactId: f.id,
    })),
    ...events.map((f) => ({
      id: `mem_event_${f.id}`,
      bookId,
      editionId: f.editionId,
      room: 'event',
      entityId: f.actorId,
      content: f.summary,
      validFromChapterId: f.chapterId,
      validToChapterId: null,
      sourceFactTable: 'events',
      sourceFactId: f.id,
    })),
    ...clues.map((f) => ({
      id: `mem_clue_${f.id}`,
      bookId,
      editionId: f.editionId,
      room: 'foreshadow',
      entityId: null,
      content: f.summary,
      validFromChapterId: f.plantedChapterId,
      validToChapterId: f.resolvedChapterId,
      sourceFactTable: 'foreshadows',
      sourceFactId: f.id,
    })),
  ];
  // Stable IDs make projection refresh idempotent. Never write back to source facts.
  for (let offset = 0; offset < items.length; offset += 100) {
    await db
      .insert(memoryItems)
      .values(items.slice(offset, offset + 100))
      .onConflictDoUpdate({
        target: memoryItems.id,
        set: {
          content: sql`excluded.content`,
          validToChapterId: sql`excluded.valid_to_chapter_id`,
        },
      });
  }
  return items.length;
}

export async function rebuildBookMemory(db: Db, bookId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await lockBookMemory(tx, bookId);
    await tx.delete(memoryItems).where(eq(memoryItems.bookId, bookId));
    return refreshMemoryFromFacts(tx, bookId);
  });
}
