import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { chapters, storyEvents, entities } from '../schema/index.js';

/** Reader order is chapter index; storyTime is an optional hint for nonlinear narration. */
export async function listEditionTimeline(db: Db, editionId: string) {
  const events = await db
    .select({
      id: storyEvents.id,
      chapterId: chapters.id,
      chapterIndex: chapters.index,
      chapterTitle: chapters.title,
      storyTime: storyEvents.storyTime,
      type: storyEvents.type,
      summary: storyEvents.summary,
      actor: entities.canonicalName,
    })
    .from(storyEvents)
    .innerJoin(chapters, eq(chapters.id, storyEvents.chapterId))
    .leftJoin(entities, eq(entities.id, storyEvents.actorId))
    .where(eq(storyEvents.editionId, editionId))
    .orderBy(asc(chapters.index), asc(storyEvents.id));
  return events;
}
