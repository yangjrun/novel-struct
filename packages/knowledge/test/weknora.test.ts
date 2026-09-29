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
import { parseWeKnoraConfig, syncEditionToWeKnora, WeKnoraClient } from '../src/index.js';

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

it.each(['test-token', 'Bearer test-token'])('uses exactly one Bearer prefix for %s', async (value) => {
  let headers: Headers | undefined;
  const client = new WeKnoraClient(
    parseWeKnoraConfig({ WEKNORA_BASE_URL: 'http://localhost:18080', WEKNORA_BEARER_TOKEN: value })!,
    (async (_url: string, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    }) as typeof fetch,
  );
  expect(await client.listKnowledgeBases()).toEqual([]);
  expect(headers?.get('Authorization')).toBe('Bearer test-token');
  expect(headers?.has('X-API-Key')).toBe(false);
});

it('rejects a malformed or insecure remote Bearer endpoint before making requests', () => {
  expect(() =>
    parseWeKnoraConfig({ WEKNORA_BASE_URL: 'http://remote.example', WEKNORA_BEARER_TOKEN: 'token' }),
  ).toThrow('HTTPS');
  expect(() =>
    parseWeKnoraConfig({ WEKNORA_BASE_URL: 'http://localhost:18080/api/v1', WEKNORA_BEARER_TOKEN: 'token' }),
  ).toThrow('根路径');
  expect(() =>
    parseWeKnoraConfig({ WEKNORA_BASE_URL: 'https://remote.example', WEKNORA_BEARER_TOKEN: 'Bearer Bearer token' }),
  ).toThrow('Token 格式');
  expect(() =>
    parseWeKnoraConfig({ WEKNORA_BASE_URL: 'http://localhost:18080', WEKNORA_BEARER_TOKEN: 'Bearer ' }),
  ).toThrow('Token 格式');
});

it('normalizes a direct Bearer client config as well as env input', async () => {
  let authorization: string | null = null;
  const client = new WeKnoraClient({ baseUrl: 'http://localhost:18080', bearerToken: 'Bearer test-token' }, (async (
    _url: string,
    init?: RequestInit,
  ) => {
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
  }) as typeof fetch);
  await client.listKnowledgeBases();
  expect(authorization).toBe('Bearer test-token');
  expect(() => new WeKnoraClient({ baseUrl: 'http://remote.example', bearerToken: 'test-token' })).toThrow('HTTPS');
});

it('passes the selected embedding model ID when creating a knowledge base', async () => {
  let payload: unknown;
  const client = new WeKnoraClient(
    parseWeKnoraConfig({
      WEKNORA_BASE_URL: 'http://localhost:18080',
      WEKNORA_BEARER_TOKEN: 'token',
      WEKNORA_EMBEDDING_MODEL_ID: 'model_embedding',
    })!,
    (async (_url: string, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: { id: 'kb_test' } }), { status: 200 });
    }) as typeof fetch,
  );
  expect(await client.createKnowledgeBase('smoke')).toEqual({ id: 'kb_test' });
  expect(payload).toEqual({ name: 'smoke', type: 'document', embedding_model_id: 'model_embedding' });
});

it('rejects ambiguous WeKnora credentials at the config boundary', () => {
  expect(() =>
    parseWeKnoraConfig({ WEKNORA_BASE_URL: 'http://weknora', WEKNORA_API_KEY: 'key', WEKNORA_BEARER_TOKEN: 'token' }),
  ).toThrow('只能配置一种');
});

it('rejects malformed WeKnora envelopes before accepting a knowledge base ID', async () => {
  const client = new WeKnoraClient(
    { baseUrl: 'http://weknora', apiKey: 'key' },
    (async () => new Response(JSON.stringify({ success: true, data: { id: 42 } }), { status: 200 })) as typeof fetch,
  );
  await expect(client.createKnowledgeBase('test')).rejects.toThrow('WeKnora');
});

it('treats null list responses as empty while validating individual objects', async () => {
  const client = new WeKnoraClient(
    { baseUrl: 'http://weknora', apiKey: 'key' },
    (async () =>
      new Response(JSON.stringify({ success: true, data: null, total: 0 }), { status: 200 })) as typeof fetch,
  );
  expect(await client.listChunks('doc')).toEqual([]);
  expect(await client.listDocuments('kb')).toEqual([]);
  await expect(client.createKnowledgeBase('test')).rejects.toThrow('WeKnora');
});

it('rejects a null list when the server reports existing rows', async () => {
  const client = new WeKnoraClient(
    { baseUrl: 'http://weknora', apiKey: 'key' },
    (async () =>
      new Response(JSON.stringify({ success: true, data: null, total: 1 }), { status: 200 })) as typeof fetch,
  );
  await expect(client.listKnowledgeBases()).rejects.toThrow('invalid data');
});

it('rejects an ambiguous null KB list without a total instead of creating a duplicate', async () => {
  const client = new WeKnoraClient(
    { baseUrl: 'http://weknora', apiKey: 'key' },
    (async () => new Response(JSON.stringify({ success: true, data: null }), { status: 200 })) as typeof fetch,
  );
  await expect(client.listKnowledgeBases()).rejects.toThrow('invalid data');
});

it('refuses to reuse a model-less KB when an embedding model is explicitly selected', async () => {
  const name = `WeKnora 测试 · v1 [${editionId}]`;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const data = path.endsWith('/knowledge-bases')
      ? [{ id: 'kb_stale', name }]
      : path.endsWith('/knowledge-bases/kb_stale')
        ? { id: 'kb_stale', name, embedding_model_id: '' }
        : [];
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  });
  const client = new WeKnoraClient(
    { baseUrl: 'http://weknora', apiKey: 'key', embeddingModelId: 'model_current' },
    fetcher as typeof fetch,
  );
  await expect(syncEditionToWeKnora(handle.db, editionId, client)).rejects.toThrow('embedding');
  expect(fetcher.mock.calls.every(([, init]) => !init || init.method === 'GET')).toBe(true);
});

it('does not upload chapters if newly created KB ignores the embedding model', async () => {
  const localBookId = await createBook(handle.db, {
    libraryId: await ensureDefaultLibrary(handle.db),
    title: '模型回退隔离测试',
  });
  const localEdition = await importNormalizedBook(handle.db, {
    bookId: localBookId,
    label: 'v1',
    sourceFormat: 'txt',
    normalized: normalizeNovel(new TextEncoder().encode('第一章 测试\n测试正文。')),
  });
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const data = path.endsWith('/knowledge-bases')
      ? method === 'POST'
        ? { id: 'kb_wrong' }
        : []
      : path.endsWith('/knowledge-bases/kb_wrong')
        ? { id: 'kb_wrong', embedding_model_id: 'other_model' }
        : null;
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  });
  const client = new WeKnoraClient(
    { baseUrl: 'http://weknora', apiKey: 'key', embeddingModelId: 'expected_model' },
    fetcher as typeof fetch,
  );
  await expect(syncEditionToWeKnora(handle.db, localEdition.editionId, client, { from: 0, to: 0 })).rejects.toThrow(
    'embedding_model_id',
  );
  expect(calls).not.toContain(expect.stringContaining('/knowledge/manual'));
});

it('rejects incomplete pilot ranges before making any remote request', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const client = new WeKnoraClient({ baseUrl: 'http://weknora', apiKey: 'key' }, fetcher);
  await expect(syncEditionToWeKnora(handle.db, editionId, client, { from: 0, to: 1 })).rejects.toThrow('章节范围');
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not create a KB when cancellation arrives during remote enumeration', async () => {
  let stopped = false;
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    stopped = true;
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
  });
  const client = new WeKnoraClient({ baseUrl: 'http://weknora', apiKey: 'key' }, fetcher as typeof fetch);
  await expect(
    syncEditionToWeKnora(handle.db, editionId, client, {
      from: 0,
      to: 0,
      shouldStop: () => stopped,
    }),
  ).rejects.toThrow('取消');
  expect(calls.every((call) => call.startsWith('GET'))).toBe(true);
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

it('reports cancellation after the final chapter instead of claiming completion', async () => {
  let stopped = false;
  const fetcher = vi.fn(async (url: string) => {
    const data = new URL(url).pathname.endsWith('/knowledge') ? [{ id: 'doc_test', title: `初遇 [${chapterId}]` }] : [];
    return new Response(JSON.stringify({ success: true, data, total: 1 }), { status: 200 });
  });
  const client = new WeKnoraClient({ baseUrl: 'http://weknora', apiKey: 'key' }, fetcher as typeof fetch);
  await expect(
    syncEditionToWeKnora(handle.db, editionId, client, {
      from: 0,
      to: 0,
      shouldStop: () => stopped,
      onChapter: () => {
        stopped = true;
      },
    }),
  ).rejects.toThrow('取消');
});

it('scoped sync preserves remote documents outside the selected chapter range', async () => {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const pathname = new URL(url).pathname;
    calls.push(`${method} ${pathname}`);
    const data = pathname.endsWith('/knowledge-bases')
      ? [{ id: 'kb_test', name: `WeKnora 测试 · v1 [${editionId}]` }]
      : pathname.endsWith('/knowledge')
        ? [
            { id: 'doc_test', title: `初遇 [${chapterId}]` },
            { id: 'doc_other', title: '其他章节 [chp_other]' },
          ]
        : pathname.includes('/chunks/')
          ? [{ id: 'chunk_test', content: quote }]
          : pathname.includes('/knowledge/manual/') || pathname.includes('/reparse')
            ? { id: 'doc_test' }
            : null;
    return new Response(JSON.stringify({ success: true, data, total: 2 }), { status: 200 });
  });
  const client = new WeKnoraClient({ baseUrl: 'http://weknora', apiKey: 'key' }, fetcher as typeof fetch);
  const result = await syncEditionToWeKnora(handle.db, editionId, client, { from: 0, to: 0 });
  expect(result.created).toBe(0);
  expect(calls.every((call) => !call.startsWith('DELETE'))).toBe(true);
});
