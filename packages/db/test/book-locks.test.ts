import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  acquireBookLock,
  createBook,
  type DbHandle,
  ensureDefaultLibrary,
  importNormalizedBook,
  openDatabase,
  releaseBookLock,
  renewBookLock,
  sweepStaleBookLocks,
} from '../src/index.js';

const fixture = new Uint8Array(readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url)));
const MINUTE = 60_000;

let handle: DbHandle;
let bookA: string;
let bookB: string;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const libraryId = await ensureDefaultLibrary(handle.db);
  bookA = await createBook(handle.db, { libraryId, title: '甲' });
  bookB = await createBook(handle.db, { libraryId, title: '乙' });
  const normalized = normalizeNovel(fixture);
  await importNormalizedBook(handle.db, { bookId: bookA, label: 'v1', sourceFormat: 'txt', normalized });
  await importNormalizedBook(handle.db, { bookId: bookB, label: 'v1', sourceFormat: 'txt', normalized });
});

afterAll(async () => {
  await handle.close();
});

const request = (bookId: string, owner: string) => ({ bookId, owner, workerId: `host:${owner}`, staleAfterMs: MINUTE });

describe('book locks', () => {
  it('is exclusive per book, re-entrant for the same owner, and independent across books', async () => {
    expect(await acquireBookLock(handle.db, request(bookA, 'one'))).toEqual({ acquired: true });
    expect(await acquireBookLock(handle.db, request(bookA, 'one'))).toEqual({ acquired: true });

    const refused = await acquireBookLock(handle.db, request(bookA, 'two'));
    expect(refused.acquired).toBe(false);
    if (!refused.acquired) expect(refused.heldBy).toMatchObject({ owner: 'one', workerId: 'host:one' });

    expect(await acquireBookLock(handle.db, request(bookB, 'two'))).toEqual({ acquired: true });
    await releaseBookLock(handle.db, bookB, 'two');
  });

  it('renews only for the owner and releases only for the owner', async () => {
    expect(await renewBookLock(handle.db, bookA, 'one')).toBe(true);
    expect(await renewBookLock(handle.db, bookA, 'two')).toBe(false);

    await releaseBookLock(handle.db, bookA, 'two');
    expect((await acquireBookLock(handle.db, request(bookA, 'two'))).acquired).toBe(false);

    await releaseBookLock(handle.db, bookA, 'one');
    expect(await acquireBookLock(handle.db, request(bookA, 'two'))).toEqual({ acquired: true });
  });

  it('lets a live process take over a stale lock, after which the old owner cannot renew', async () => {
    await renewBookLock(handle.db, bookA, 'two', new Date(Date.now() - 2 * MINUTE));
    expect(await acquireBookLock(handle.db, request(bookA, 'three'))).toEqual({ acquired: true });
    expect(await renewBookLock(handle.db, bookA, 'two')).toBe(false);
    expect(await renewBookLock(handle.db, bookA, 'three')).toBe(true);
  });

  it('sweeps stale locks, or all of them with a zero threshold', async () => {
    await acquireBookLock(handle.db, request(bookB, 'four'));
    await renewBookLock(handle.db, bookB, 'four', new Date(Date.now() - 2 * MINUTE));
    expect(await sweepStaleBookLocks(handle.db, MINUTE)).toEqual([bookB]);
    expect(await sweepStaleBookLocks(handle.db, 0)).toEqual([bookA]);
    expect(await sweepStaleBookLocks(handle.db, 0)).toEqual([]);
  });
});
