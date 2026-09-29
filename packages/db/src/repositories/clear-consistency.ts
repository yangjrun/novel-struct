import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { lockBookMemory } from './memory.js';
import {
  entityAliases,
  foreshadows,
  memoryItems,
  parseRuns,
  relationships,
  reviewItems,
  sourceRefs,
  stateChanges,
  stateFacts,
  storyEvents,
  shadowReviews,
  chapters,
  bookEditions,
} from '../schema/index.js';

/** Invalidate one edition's consistency pass and its derived evidence before rewriting structure. */
export async function clearEditionConsistency(db: Db, editionId: string): Promise<void> {
  const [edition] = await db
    .select({ bookId: bookEditions.bookId })
    .from(bookEditions)
    .where(eq(bookEditions.id, editionId));
  if (edition) await lockBookMemory(db, edition.bookId);
  await db
    .delete(shadowReviews)
    .where(
      and(
        eq(shadowReviews.pass, 'consistency'),
        inArray(
          shadowReviews.chapterId,
          db.select({ id: chapters.id }).from(chapters).where(eq(chapters.editionId, editionId)),
        ),
      ),
    );
  const states = await db
    .select({ id: stateFacts.sourceRefId })
    .from(stateFacts)
    .where(eq(stateFacts.editionId, editionId));
  const relations = await db
    .select({ id: relationships.sourceRefId })
    .from(relationships)
    .where(eq(relationships.editionId, editionId));
  const events = await db
    .select({ id: storyEvents.sourceRefId })
    .from(storyEvents)
    .where(eq(storyEvents.editionId, editionId));
  const clues = await db
    .select({ id: foreshadows.sourceRefId })
    .from(foreshadows)
    .where(eq(foreshadows.editionId, editionId));
  const evidenceIds = [...new Set([...states, ...relations, ...events, ...clues].map((row) => row.id))];

  // State changes point at the same evidence as the replacement state fact.
  if (evidenceIds.length) await db.delete(stateChanges).where(inArray(stateChanges.sourceRefId, evidenceIds));
  await db.delete(memoryItems).where(eq(memoryItems.editionId, editionId));
  await db
    .delete(reviewItems)
    .where(and(eq(reviewItems.editionId, editionId), inArray(reviewItems.kind, ['state', 'relationship'])));
  await db.delete(storyEvents).where(eq(storyEvents.editionId, editionId));
  await db.delete(foreshadows).where(eq(foreshadows.editionId, editionId));
  await db.delete(relationships).where(eq(relationships.editionId, editionId));
  await db.delete(stateFacts).where(eq(stateFacts.editionId, editionId));
  if (evidenceIds.length) {
    await db.update(entityAliases).set({ sourceRefId: null }).where(inArray(entityAliases.sourceRefId, evidenceIds));
    await db.delete(sourceRefs).where(inArray(sourceRefs.id, evidenceIds));
  }
  await db.delete(parseRuns).where(and(eq(parseRuns.editionId, editionId), eq(parseRuns.pass, 'consistency')));
}
