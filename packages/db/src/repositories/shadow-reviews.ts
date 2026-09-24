import { and, asc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../client.js';
import { shadowReviews } from '../schema/index.js';

export interface ShadowReviewInput {
  readonly itemKey: string;
  readonly charStart?: number;
  readonly charEnd?: number;
  readonly source?: string;
  readonly claim?: string;
  readonly label?: string;
  readonly confidence?: number;
  readonly error?: string;
}

export type ShadowPass = 'structure' | 'consistency';

/** Replace the shadow assessment of one pass, even when it has no findings. */
export async function replaceShadowReviews(
  db: Db,
  chapterId: string,
  pass: ShadowPass,
  model: string,
  items: readonly ShadowReviewInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(shadowReviews).where(and(eq(shadowReviews.chapterId, chapterId), eq(shadowReviews.pass, pass)));
    if (items.length === 0) return;
    await tx.insert(shadowReviews).values(
      items.map((item) => ({
        id: `shr_${randomUUID()}`,
        chapterId,
        pass,
        itemKey: item.itemKey,
        charStart: item.charStart ?? null,
        charEnd: item.charEnd ?? null,
        source: item.source ?? null,
        claim: item.claim ?? null,
        label: item.label ?? null,
        confidence: item.confidence ?? null,
        model,
        error: item.error ?? null,
      })),
    );
  });
}

export async function listChapterShadowReviews(db: Db, chapterId: string) {
  return db
    .select()
    .from(shadowReviews)
    .where(eq(shadowReviews.chapterId, chapterId))
    .orderBy(asc(shadowReviews.charStart), asc(shadowReviews.itemKey));
}

/** True only for completed judgments from the current model; errors can be retried. */
export async function hasChapterShadowReviews(
  db: Db,
  chapterId: string,
  pass: ShadowPass,
  model: string,
): Promise<boolean> {
  const found = await db
    .select({ id: shadowReviews.id })
    .from(shadowReviews)
    .where(
      and(
        eq(shadowReviews.chapterId, chapterId),
        eq(shadowReviews.pass, pass),
        eq(shadowReviews.model, model),
        isNull(shadowReviews.error),
      ),
    )
    .limit(1);
  return found.length > 0;
}
