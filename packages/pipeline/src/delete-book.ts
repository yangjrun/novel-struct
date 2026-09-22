import { randomUUID } from 'node:crypto';
import { acquireBookLock, type Db, deleteBook, type DeleteBookResult, getBook, releaseBookLock } from '@novelstruct/db';
import { PipelineError } from './errors.js';
import { defaultWorkerId, STALE_RUN_AFTER_MS } from './parse-edition.js';

export type { DeleteBookResult };

/**
 * Deletes a book under its lock, so it cannot happen while a parse holds the book. A live holder
 * is reported as a `conflict`; a stale one is taken over like any other stale lock.
 */
export async function deleteBookSafely(db: Db, bookId: string): Promise<DeleteBookResult> {
  if ((await getBook(db, bookId)) === undefined) throw new PipelineError('not_found', `书 ${bookId} 不存在`);

  const workerId = defaultWorkerId();
  const owner = `delete:${workerId}#${randomUUID()}`;
  const lock = await acquireBookLock(db, { bookId, owner, workerId, staleAfterMs: STALE_RUN_AFTER_MS });
  if (!lock.acquired) {
    throw new PipelineError('conflict', `这本书正在被 ${lock.heldBy.workerId} 解析，先取消任务或等它结束`);
  }

  try {
    const result = await deleteBook(db, bookId);
    if (result === undefined) throw new PipelineError('not_found', `书 ${bookId} 不存在`);
    return result;
  } finally {
    // The transaction drops the lock row on success; this only matters when the delete failed.
    await releaseBookLock(db, bookId, owner);
  }
}
