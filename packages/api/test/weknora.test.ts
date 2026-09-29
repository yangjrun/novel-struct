import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  acquireBookLock,
  releaseBookLock,
  createBook,
  ensureDefaultLibrary,
  importNormalizedBook,
  getChapterByIndex,
  getWeKnoraKb,
  openDatabase,
  saveWeKnoraKb,
  saveWeKnoraDocument,
  sourceRefs,
  type DbHandle,
} from '@novelstruct/db';
import { normalizeNovel } from '../../ingest/src/index.js';
import { WeKnoraClient } from '@novelstruct/knowledge';
import { MemoryJobQueue } from '@novelstruct/queue';
import { createApp } from '../src/app.js';
import { silentLogger } from '../src/log.js';
import type { AppContext } from '../src/context.js';
import type { ApiResponse, WeKnoraSearchDto, WeKnoraStatusDto, WeKnoraSyncResultDto } from '../src/contracts.js';

let handle: DbHandle;
let jobs: MemoryJobQueue;
let context: AppContext;
let sequence = 0;
let bookId: string;
let editionId: string;
let documentSequence: number;
let parsed: boolean;
let failChunks: boolean;
let searchData: unknown;
let documents: { id: string; title: string; content: string; parse_status: string }[];
let bases: { id: string; name: string }[];

const fetcher = vi.fn<typeof fetch>();
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
const client = new WeKnoraClient({ baseUrl: 'http://weknora.test', apiKey: 'server-only-secret' }, fetcher);

async function seed(title: string) {
  const id = await createBook(handle.db, { libraryId: await ensureDefaultLibrary(handle.db), title });
  const edition = await importNormalizedBook(handle.db, {
    bookId: id,
    label: 'v1',
    sourceFormat: 'txt',
    normalized: normalizeNovel(
      new TextEncoder().encode('第一章 初遇\n🌉沈青崖来到石桥。回声。回声。\n第二章 归来\n雨后回家。'),
    ),
  });
  return { bookId: id, editionId: edition.editionId };
}

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  jobs = new MemoryJobQueue({ db: handle.db, llm: undefined, logger: silentLogger });
  context = { db: handle.db, databaseKind: 'pglite', jobs, llm: undefined, pricing: undefined, logger: silentLogger };
});
afterAll(async () => {
  await jobs.close();
  await handle.close();
});
beforeEach(async () => {
  ({ bookId, editionId } = await seed(`网页 WeKnora ${++sequence}`));
  documentSequence = 0;
  parsed = false;
  failChunks = false;
  searchData = [];
  documents = [];
  bases = [];
  fetcher.mockReset();
  fetcher.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('server-only-secret');
    if (path.endsWith('/hybrid-search')) return envelope(searchData);
    if (path === '/api/v1/knowledge-bases') {
      if (method === 'POST') {
        const kb = { id: `kb-${sequence}`, name: body['name']! };
        bases.push(kb);
        return envelope(kb);
      }
      return envelope(bases);
    }
    if (path.endsWith('/knowledge/manual')) {
      const doc = {
        id: `doc-${sequence}-${++documentSequence}`,
        title: body['title']!,
        content: body['content']!,
        parse_status: 'pending',
      };
      documents.push(doc);
      return envelope(doc);
    }
    if (path.includes('/knowledge/manual/')) {
      const doc = documents.find((d) => path.endsWith(`/${d.id}`))!;
      doc.title = body['title']!;
      doc.content = body['content']!;
      return envelope(doc);
    }
    if (path.endsWith('/reparse')) return envelope({ id: path.split('/').at(-2), parse_status: 'pending' });
    if (path.includes('/chunks/')) {
      if (failChunks) return new Response('private upstream diagnostic', { status: 500 });
      const doc = documents.find((d) => path.endsWith(`/${d.id}`));
      return envelope(parsed && doc ? [{ id: `chunk-${doc.id}`, content: doc.content }] : []);
    }
    if (path.endsWith('/knowledge')) return envelope(documents);
    throw new Error(`Unexpected ${method} ${path}`);
  });
});

const app = () => createApp({ ...context, weknora: client });
const post = (path: string, body: unknown, target = app()) =>
  target.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const sync = (body: unknown = { from: 0, to: 0 }) => post(`/api/weknora/editions/${editionId}/sync`, body);
async function data<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error);
  return body.data;
}

it('reports configuration without exposing upstream credentials and protects new routes with API_TOKEN', async () => {
  const config = await app().request('/api/config');
  const text = await config.text();
  expect(text).toContain('"weknoraConfigured":true');
  expect(text).not.toContain('server-only-secret');
  expect(text).not.toContain('weknora.test');
  const secured = createApp({ ...context, weknora: client, apiToken: 'app-secret' });
  expect((await secured.request(`/api/weknora/editions/${editionId}`)).status).toBe(401);
  expect((await post('/api/weknora/search', { query: '桥', bookIds: [bookId] }, secured)).status).toBe(401);
  expect((await post(`/api/weknora/editions/${editionId}/sync`, { from: 0, to: 0 }, secured)).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});

it('reports not configured locally, and rejects sync and search without contacting WeKnora', async () => {
  const disabled = createApp(context);
  const status = await data<WeKnoraStatusDto>(await disabled.request(`/api/weknora/editions/${editionId}`));
  expect(status).toMatchObject({ configured: false, kbId: null, evidenceTotal: 0, evidenceLinked: 0 });
  expect((await post(`/api/weknora/editions/${editionId}/sync`, { from: 0, to: 0 }, disabled)).status).toBe(400);
  expect((await post('/api/weknora/search', { query: '桥', bookIds: [bookId] }, disabled)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  {},
  { from: 0 },
  { from: 0, to: 10 },
  { from: 1, to: 0 },
  { from: -1, to: 0 },
  { from: 0.5, to: 1 },
  { from: 0, to: 2 },
  { from: 0, to: 0, all: true },
])('rejects an invalid or missing chapter range before external writes: %j', async (body) => {
  expect((await sync(body)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await getWeKnoraKb(handle.db, editionId)).toBeUndefined();
});

it('rejects missing editions', async () => {
  expect((await app().request('/api/weknora/editions/missing')).status).toBe(404);
  expect((await post('/api/weknora/editions/missing/sync', { from: 0, to: 0 })).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});

it('syncs only the selected chapter, preserves remote documents, and backfills evidence on repeat', async () => {
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const start = chapter.text.indexOf('沈青崖');
  await handle.db.insert(sourceRefs).values({
    id: `ref-${sequence}`,
    editionId,
    chapterId: chapter.id,
    charStart: start,
    charEnd: start + 3,
    quote: '沈青崖',
  });
  documents.push({ id: 'unrelated', title: '其他章节 [chp_unrelated]', content: '保留', parse_status: 'completed' });
  const first = await data<WeKnoraSyncResultDto>(await sync());
  expect(first).toMatchObject({ created: 1, updated: 0, linked: 0 });
  expect(first.chapters).toHaveLength(1);
  let status = await data<WeKnoraStatusDto>(await app().request(`/api/weknora/editions/${editionId}`));
  expect(status.chapters[0]).toMatchObject({ parseStatus: 'pending', needsSync: false });
  expect(status.chapters[1]).toMatchObject({ knowledgeId: null, needsSync: true });
  expect(status.evidenceTotal).toBe(1);
  parsed = true;
  documents[1]!.parse_status = 'completed';
  expect(await data<WeKnoraSyncResultDto>(await sync())).toMatchObject({ created: 0, updated: 0, linked: 1 });
  status = await data<WeKnoraStatusDto>(await app().request(`/api/weknora/editions/${editionId}`));
  expect(status.evidenceLinked).toBe(1);
  expect(status.chapters[0]?.parseStatus).toBe('completed');
  expect(documents).toHaveLength(2);
  expect(bases).toHaveLength(1);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});

it('refuses a concurrent parse/sync lock without contacting upstream', async () => {
  await acquireBookLock(handle.db, { bookId, owner: 'other', workerId: 'other', staleAfterMs: 60_000 });
  try {
    expect((await sync()).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await releaseBookLock(handle.db, bookId, 'other');
  }
});

it('recreates a remotely removed chapter when its range is synced again', async () => {
  await sync();
  documents = [];
  const status = await data<WeKnoraStatusDto>(await app().request(`/api/weknora/editions/${editionId}`));
  expect(status.chapters[0]).toMatchObject({ parseStatus: 'missing', needsSync: true });
  expect(await data<WeKnoraSyncResultDto>(await sync())).toMatchObject({ created: 1, updated: 0 });
  expect(documents).toHaveLength(1);
});

it('retries a failed remote parse without duplicating the chapter', async () => {
  await sync();
  documents[0]!.parse_status = 'failed';
  fetcher.mockClear();
  expect(await data<WeKnoraSyncResultDto>(await sync())).toMatchObject({ created: 0, updated: 1 });
  expect(documents).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/reparse'))).toBe(true);
});

it('retains committed mappings after a partial failure and releases its lock for a repeat', async () => {
  failChunks = true;
  const response = await sync();
  expect(response.status).toBe(502);
  const text = await response.text();
  expect(text).toContain('部分章节可能已提交');
  expect(text).not.toContain('private upstream');
  expect(await getWeKnoraKb(handle.db, editionId)).toBeDefined();
  failChunks = false;
  expect(await data<WeKnoraSyncResultDto>(await sync())).toMatchObject({ created: 0, updated: 0 });
  expect(documents).toHaveLength(1);
});

it('shows local state when remote authentication fails, and reports a safe search error', async () => {
  await saveWeKnoraKb(handle.db, editionId, 'kb');
  fetcher.mockImplementation(async () => new Response('server-only-secret', { status: 401 }));
  const status = await data<WeKnoraStatusDto>(await app().request(`/api/weknora/editions/${editionId}`));
  expect(status.remoteError).toContain('鉴权失败');
  expect(status.chapters).toHaveLength(2);
  const response = await post('/api/weknora/search', { query: '桥', bookIds: [bookId] });
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('server-only-secret');
});

it('searches only selected local KBs and maps verified hits with exact UTF-16 offsets', async () => {
  await sync();
  const other = await seed('其他小说');
  const otherChapter = (await getChapterByIndex(handle.db, other.editionId, 0))!;
  await saveWeKnoraKb(handle.db, other.editionId, 'other-kb');
  await saveWeKnoraDocument(handle.db, otherChapter.id, 'foreign-doc', otherChapter.contentHash);
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  const hit = { id: 'exact', knowledge_id: documents[0]!.id, score: 0.8, content: '沈青崖来到石桥。' };
  searchData = [
    hit,
    hit,
    { ...hit, id: 'ambiguous', content: '回声。', score: 0.7 },
    { ...hit, id: 'rewritten', content: '摘要：石桥初遇', score: 0.6 },
    { ...hit, id: 'foreign', knowledge_id: 'foreign-doc' },
    { ...hit, id: 'wrong-kb', knowledge_base_id: 'other-kb' },
  ];
  fetcher.mockClear();
  const result = await data<WeKnoraSearchDto>(await post('/api/weknora/search', { query: ' 桥 ', bookIds: [bookId] }));
  expect(result.results).toHaveLength(3);
  expect(result.results[0]).toMatchObject({
    bookId,
    editionId,
    chapterIndex: 0,
    charStart: chapter.text.indexOf(hit.content),
    charEnd: chapter.text.indexOf(hit.content) + hit.content.length,
  });
  expect(result.results[1]?.charStart).toBeNull();
  expect(result.results[2]?.charStart).toBeNull();
  expect(result.skippedEditions).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[0])).toContain(`/knowledge-bases/kb-${sequence}/hybrid-search`);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ query_text: '桥', match_count: 20 });
});

it('reports unsynced editions without searching arbitrary remote knowledge bases', async () => {
  const result = await data<WeKnoraSearchDto>(await post('/api/weknora/search', { query: '桥', bookIds: [bookId] }));
  expect(result.results).toEqual([]);
  expect(result.skippedEditions[0]?.editionId).toBe(editionId);
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects invalid search scopes and limits before external reads', async () => {
  for (const body of [
    { query: '桥', bookIds: [] },
    { query: ' ', bookIds: [bookId] },
    { query: '桥', bookIds: [bookId], limit: 51 },
    { query: '桥', bookIds: [bookId], kbId: 'foreign' },
  ]) {
    expect((await post('/api/weknora/search', body)).status).toBe(400);
  }
  expect((await post('/api/weknora/search', { query: '桥', bookIds: [bookId, 'missing'] })).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});

it('omits stale document mappings and accepts an empty null upstream result', async () => {
  await sync();
  const chapter = (await getChapterByIndex(handle.db, editionId, 0))!;
  await saveWeKnoraDocument(handle.db, chapter.id, documents[0]!.id, 'outdated-hash');
  searchData = [{ id: 'stale', knowledge_id: documents[0]!.id, content: chapter.text, score: 1 }];
  expect(
    (await data<WeKnoraSearchDto>(await post('/api/weknora/search', { query: '桥', bookIds: [bookId] }))).results,
  ).toEqual([]);
  searchData = null;
  expect(
    (await data<WeKnoraSearchDto>(await post('/api/weknora/search', { query: '桥', bookIds: [bookId] }))).results,
  ).toEqual([]);
  searchData = [{ id: 'bad', content: 'bad', score: '0.5' }];
  expect((await post('/api/weknora/search', { query: '桥', bookIds: [bookId] })).status).toBe(502);
});
