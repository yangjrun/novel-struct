import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { bookLocks } from '../schema/index.js';

export interface BookLockRequest {
  readonly bookId: string;
  /** Unique token of this holder; renew and release only work with the same token. */
  readonly owner: string;
  /** host:pid, shown to whoever is refused the lock. */
  readonly workerId: string;
  /** A holder silent for longer than this is treated as dead and its lock taken over. */
  readonly staleAfterMs: number;
}

export interface BookLockHolder {
  readonly owner: string;
  readonly workerId: string;
  readonly heartbeatAt: Date;
}

export type BookLockOutcome =
  { readonly acquired: true } | { readonly acquired: false; readonly heldBy: BookLockHolder };

/**
 * Takes the book's lock in one statement: insert, or update the existing row only when it is
 * ours already or its heartbeat is stale. Postgres returns the row exactly when the insert or
 * the conditional update happened, so "no row" means someone alive holds it.
 */
export async function acquireBookLock(db: Db, request: BookLockRequest): Promise<BookLockOutcome> {
  for (let round = 0; round < 2; round += 1) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - request.staleAfterMs).toISOString();
    const rows = await db
      .insert(bookLocks)
      .values({
        bookId: request.bookId,
        owner: request.owner,
        workerId: request.workerId,
        acquiredAt: now,
        heartbeatAt: now,
      })
      .onConflictDoUpdate({
        target: bookLocks.bookId,
        set: { owner: request.owner, workerId: request.workerId, acquiredAt: now, heartbeatAt: now },
        setWhere: sql`${bookLocks.owner} = ${request.owner} or ${bookLocks.heartbeatAt} < ${cutoff}::timestamptz`,
      })
      .returning({ owner: bookLocks.owner });
    if (rows.length > 0) return { acquired: true };

    const holder = await db
      .select({ owner: bookLocks.owner, workerId: bookLocks.workerId, heartbeatAt: bookLocks.heartbeatAt })
      .from(bookLocks)
      .where(eq(bookLocks.bookId, request.bookId))
      .limit(1);
    // The holder released between our two statements: try once more instead of reporting a ghost.
    if (holder[0] !== undefined) return { acquired: false, heldBy: holder[0] };
  }
  return { acquired: false, heldBy: { owner: '', workerId: '?', heartbeatAt: new Date() } };
}

/** Refreshes our heartbeat. False when the lock is no longer ours, which means it was taken over. */
export async function renewBookLock(db: Db, bookId: string, owner: string, at = new Date()): Promise<boolean> {
  const rows = await db
    .update(bookLocks)
    .set({ heartbeatAt: at })
    .where(and(eq(bookLocks.bookId, bookId), eq(bookLocks.owner, owner)))
    .returning({ bookId: bookLocks.bookId });
  return rows.length > 0;
}

/** Drops our lock; a no-op when it was already taken over. */
export async function releaseBookLock(db: Db, bookId: string, owner: string): Promise<void> {
  await db.delete(bookLocks).where(and(eq(bookLocks.bookId, bookId), eq(bookLocks.owner, owner)));
}

/** Removes every lock whose heartbeat is older than `staleAfterMs`; 0 removes them all. Returns the book ids. */
export async function sweepStaleBookLocks(db: Db, staleAfterMs: number, now = new Date()): Promise<readonly string[]> {
  const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
  const rows = await db
    .delete(bookLocks)
    .where(sql`${bookLocks.heartbeatAt} < ${cutoff}::timestamptz`)
    .returning({ bookId: bookLocks.bookId });
  return rows.map((r) => r.bookId);
}
