import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ChapterIRSchema } from '@novelstruct/core';
import {
  commitChapterIR,
  createBook,
  ensureDefaultLibrary,
  getChapterByIndex,
  importNormalizedBook,
  openDatabase,
  sourceRefs,
  type DbHandle,
} from '@novelstruct/db';
import { normalizeNovel } from '@novelstruct/ingest';
import { eq } from 'drizzle-orm';
import { syncEditionToWeKnora, WeKnoraClient } from '../src/index.js';

let handle: DbHandle;
let editionId: string;
let chapterId: string;
let quote: string;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  const bookId = await createBook(handle.db, {
    libraryId: await ensureDefaultLibrary(handle.db),
    title: 'WeKnora 测试',
  });
  editionId = (
    await importNormalizedBook(handle.db, {
      bookId,
      label: 'v1',
      sourceFormat: 'txt',
      normalized: normalizeNovel(new TextEncoder().encode('第一章 初遇\n沈青崖来到石桥。')),
    })
  ).editionId;
  const chapter = await getChapterByIndex(handle.db, editionId, 0);
  if (!chapter) throw new Error('missing chapter');
  chapterId = chapter.id;
  quote = chapter.text;
  const at = quote.indexOf('沈青崖');
  await commitChapterIR(
    handle.db,
    ChapterIRSchema.parse({
      irVersion: '0.1',
      bookId,
      editionId,
      chapterId,
      charCount: quote.length,
      scenes: [{ id: 'scn_test', index: 0, charStart: 0, charEnd: quote.length, characterIds: ['ent_test'] }],
      segments: [
        { id: 'seg_test', sceneId: 'scn_test', index: 0, kind: 'narration', charStart: 0, charEnd: quote.length },
      ],
      entities: [
        { id: 'ent_test', type: 'character', canonicalName: '沈青崖', isNew: true, confidence: 1, aliases: [] },
      ],
      mentions: [{ entityId: 'ent_test', surface: '沈青崖', charStart: at, charEnd: at + 3 }],
      provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
    }),
  );
});
afterAll(async () => {
  await handle.close();
});

it('creates one KB per edition, resumes sync, and maps exact chunk spans onto evidence', async () => {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    const data = url.endsWith('/knowledge-bases')
      ? init?.method === 'POST'
        ? { id: 'kb_test' }
        : []
      : url.includes('/knowledge/manual')
        ? { id: 'doc_test', parse_status: 'draft' }
        : url.includes('/knowledge?page=')
          ? calls.some((call) => call.includes('/knowledge/manual'))
            ? [{ id: 'doc_test', title: `初遇 [${chapterId}]` }]
            : []
          : url.includes('/reparse')
            ? { id: 'doc_test' }
            : [{ id: 'chunk_test', content: quote }];
    return new Response(JSON.stringify({ success: true, data, total: 1 }), { status: 200 });
  });
  const client = new WeKnoraClient({ baseUrl: 'http://weknora', apiKey: 'key' }, fetcher as typeof fetch);
  expect(await syncEditionToWeKnora(handle.db, editionId, client)).toEqual({
    kbId: 'kb_test',
    created: 1,
    updated: 0,
    linked: 1,
  });
  expect(await syncEditionToWeKnora(handle.db, editionId, client)).toEqual({
    kbId: 'kb_test',
    created: 0,
    updated: 0,
    linked: 0,
  });
  expect(calls.filter((call) => call === 'POST /api/v1/knowledge-bases')).toHaveLength(1);
  const refs = await handle.db
    .select({ chunk: sourceRefs.weknoraChunkId })
    .from(sourceRefs)
    .where(eq(sourceRefs.chapterId, chapterId));
  expect(refs).toEqual([{ chunk: 'chunk_test' }]);
});
