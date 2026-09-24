import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquireBookLock,
  getChapterByIndex,
  replaceShadowReviews,
  type DbHandle,
  openDatabase,
  releaseBookLock,
} from '@novelstruct/db';
import { enqueueEntityReview } from '@novelstruct/db';
import { MemoryJobQueue } from '@novelstruct/queue';
import type { Embedder } from '@novelstruct/knowledge';
import type { Hono } from 'hono';
import { createApp } from '../src/app.js';
import type {
  ApiResponse,
  BookDto,
  ChapterDetailDto,
  ConfigDto,
  DeleteBookResultDto,
  EditionDetailDto,
  EntityDto,
  ImportResultDto,
  JobDto,
  SceneSearchResultDto,
  UsageReportDto,
} from '../src/contracts.js';
import { silentLogger } from '../src/log.js';

const fixture = readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url));

let handle: DbHandle;
let app: Hono;
let jobs: MemoryJobQueue;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  jobs = new MemoryJobQueue({ db: handle.db, llm: undefined, logger: silentLogger });
  app = createApp({
    db: handle.db,
    databaseKind: 'pglite',
    llm: undefined,
    pricing: undefined,
    jobs,
    logger: silentLogger,
  });
});

afterAll(async () => {
  await jobs.close();
  await handle.close();
});

async function json<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

function expectSuccess<T>(body: ApiResponse<T>): T {
  if (!body.success) throw new Error(`expected success, got error: ${body.error}`);
  return body.data;
}

async function waitForJob(id: string): Promise<JobDto> {
  for (let i = 0; i < 200; i += 1) {
    const job = await jobs.get(id);
    if (job !== undefined && job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job ${id} did not finish`);
}

describe('config and errors', () => {
  it('requires a bearer token for every API route when configured (including HTML)', async () => {
    const protectedApp = createApp({
      db: handle.db,
      databaseKind: 'pglite',
      llm: undefined,
      pricing: undefined,
      jobs,
      logger: silentLogger,
      apiToken: 'secret-token',
    });
    expect((await protectedApp.request('/api/books')).status).toBe(401);
    expect((await protectedApp.request('/api/config', { headers: { authorization: 'Bearer wrong' } })).status).toBe(
      401,
    );
    expect(
      (await protectedApp.request('/api/books', { headers: { authorization: 'Bearer secret-token' } })).status,
    ).toBe(200);
    expect((await protectedApp.request('/api/editions/anything/report')).status).toBe(401);
    expect((await protectedApp.request('/health')).status).toBe(200);
  });

  it('reports the runtime configuration', async () => {
    const body = await json<ConfigDto>(await app.request('/api/config'));
    expect(expectSuccess(body)).toEqual({
      database: 'pglite',
      queue: 'memory',
      llmConfigured: false,
      llmModel: null,
      shadowModel: null,
      attributors: ['heuristic', 'llm'],
      pricing: null,
      embeddingConfigured: false,
    });
  });

  it('answers unknown routes with the envelope', async () => {
    const response = await app.request('/api/nothing');
    expect(response.status).toBe(404);
    const body = await json<never>(response);
    expect(body.success).toBe(false);
  });
});

describe('import, browse, parse', () => {
  let editionId: string;

  it('imports an uploaded TXT', async () => {
    const form = new FormData();
    form.set('file', new File([fixture], 'demo-novel.txt', { type: 'text/plain' }));
    form.set('title', '示例小说');
    form.set('author', '示例作者');
    const response = await app.request('/api/books/import', { method: 'POST', body: form });
    expect(response.status).toBe(201);
    const data = expectSuccess(await json<ImportResultDto>(response));
    expect(data.chapterCount).toBe(5);
    expect(data.reimport).toBeNull();
    editionId = data.editionId;
  });

  it('re-imports the same title into the same edition', async () => {
    const form = new FormData();
    form.set('file', new File([fixture], 'demo-novel.txt', { type: 'text/plain' }));
    form.set('title', '示例小说');
    form.set('author', '示例作者');
    const response = await app.request('/api/books/import', { method: 'POST', body: form });
    expect(response.status).toBe(200);
    const data = expectSuccess(await json<ImportResultDto>(response));
    expect(data.editionId).toBe(editionId);
    expect(data.reimport).toEqual({ kept: 5, updated: 0, added: 0, removed: 0 });
  });

  it('rejects an import without a file', async () => {
    const form = new FormData();
    form.set('title', 'x');
    const response = await app.request('/api/books/import', { method: 'POST', body: form });
    expect(response.status).toBe(400);
  });

  it('rejects a TXT import without a title', async () => {
    const form = new FormData();
    form.set('file', new File([fixture], 'demo-novel.txt', { type: 'text/plain' }));
    const response = await app.request('/api/books/import', { method: 'POST', body: form });
    expect(response.status).toBe(400);
    const body = await json<never>(response);
    expect(body.success === false && body.error).toContain('书名');
  });

  it('lists books with editions', async () => {
    const books = expectSuccess(await json<BookDto[]>(await app.request('/api/books')));
    expect(books).toHaveLength(1);
    expect(books[0]?.editions[0]).toEqual({ id: editionId, label: 'v1', chapterCount: 5 });
  });

  it('shows the edition with unparsed chapters', async () => {
    const detail = expectSuccess(await json<EditionDetailDto>(await app.request(`/api/editions/${editionId}`)));
    expect(detail.book.title).toBe('示例小说');
    expect(detail.chapters).toHaveLength(5);
    expect(detail.chapters.every((c) => c.segmentCount === 0 && c.latestRun === null)).toBe(true);
  });

  it('returns 404 for a missing edition', async () => {
    const response = await app.request('/api/editions/ed_missing');
    expect(response.status).toBe(404);
  });

  it('validates the parse request', async () => {
    const response = await app.request(`/api/editions/${editionId}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 3, to: 1 }),
    });
    expect(response.status).toBe(400);
    const zeroAttempts = await app.request(`/api/editions/${editionId}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxAttempts: 0 }),
    });
    expect(zeroAttempts.status).toBe(400);
  });

  it('refuses the llm attributor when it is not configured', async () => {
    const response = await app.request(`/api/editions/${editionId}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attributor: 'llm' }),
    });
    expect(response.status).toBe(400);
    const body = await json<never>(response);
    expect(body.success === false && body.error).toContain('LLM_API_KEY');
  });

  it('queues a heuristic parse job and runs it to completion', async () => {
    const response = await app.request(`/api/editions/${editionId}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 1, to: 2 }),
    });
    expect(response.status).toBe(202);
    const queued = expectSuccess(await json<JobDto>(response));
    expect(queued.total).toBe(2);
    expect(queued.options.maxAttempts).toBe(3);

    const done = await waitForJob(queued.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ succeeded: 2, failed: 0, skipped: 0, stopped: false });
    expect(done.events.map((e) => e.type)).toEqual(['succeeded', 'succeeded']);

    const listed = expectSuccess(await json<JobDto[]>(await app.request('/api/jobs')));
    expect(listed.map((j) => j.id)).toContain(queued.id);
  });

  it('skips chapters that already have a matching successful run', async () => {
    const response = await app.request(`/api/editions/${editionId}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 1, to: 1 }),
    });
    const done = await waitForJob(expectSuccess(await json<JobDto>(response)).id);
    expect(done.result?.skipped).toBe(1);
  });

  it('reports token usage per edition and for the whole library', async () => {
    const edition = expectSuccess(await json<UsageReportDto>(await app.request(`/api/editions/${editionId}/usage`)));
    expect(edition.pricing).toBeNull();
    expect(edition.rows).toHaveLength(1);
    expect(edition.rows[0]).toMatchObject({
      editionId,
      attributor: 'heuristic',
      model: null,
      runs: 2,
      succeeded: 2,
      failed: 0,
      chapters: 2,
      inputTokens: 0,
      outputTokens: 0,
      cost: null,
    });
    expect(edition.rows[0]?.lastRunAt).toMatch(/^\d{4}-/);
    expect(edition.total).toEqual({ runs: 2, succeeded: 2, failed: 0, inputTokens: 0, outputTokens: 0, cost: null });

    const library = expectSuccess(await json<UsageReportDto>(await app.request('/api/usage')));
    expect(library.rows.map((r) => r.editionId)).toContain(editionId);

    const missing = await app.request('/api/editions/ed_missing/usage');
    expect(missing.status).toBe(404);
  });

  it('estimates cost once prices are configured', async () => {
    const priced = createApp({
      db: handle.db,
      databaseKind: 'pglite',
      llm: undefined,
      pricing: { inputPerMillion: 1, outputPerMillion: 2, currency: 'USD' },
      jobs,
      logger: silentLogger,
    });
    const config = expectSuccess(await json<ConfigDto>(await priced.request('/api/config')));
    expect(config.pricing).toEqual({ inputPerMillion: 1, outputPerMillion: 2, currency: 'USD' });
    const report = expectSuccess(await json<UsageReportDto>(await priced.request('/api/usage')));
    expect(report.pricing?.currency).toBe('USD');
    // Heuristic rows have no model, so they are never priced; the total still reports a number.
    expect(report.rows.every((r) => r.cost === null)).toBe(true);
    expect(report.total.cost).toBe(0);
  });

  it('serves parsed segments and neighbours for a chapter', async () => {
    const detail = expectSuccess(
      await json<ChapterDetailDto>(await app.request(`/api/editions/${editionId}/chapters/1`)),
    );
    expect(detail.chapter.title).toBe('断剑');
    expect(detail.segments.length).toBeGreaterThan(0);
    expect(detail.prevIndex).toBe(0);
    expect(detail.nextIndex).toBe(2);
    expect(detail.shadowReviews).toEqual([]);
  });

  it('returns independent shadow findings with their original text offsets', async () => {
    const chapter = (await getChapterByIndex(handle.db, editionId, 1))!;
    const charStart = chapter.text.indexOf('修是修好了');
    await replaceShadowReviews(handle.db, chapter.id, 'structure', 'jev-test', [
      {
        itemKey: `quote:${charStart}`,
        source: '“修是修好了”',
        charStart,
        charEnd: charStart + 5,
        claim: 'dialogue',
        label: 'term',
        confidence: 0.7,
      },
    ]);
    const dto = expectSuccess(await json<ChapterDetailDto>(await app.request(`/api/editions/${editionId}/chapters/1`)));
    expect(dto.shadowReviews).toMatchObject([
      { pass: 'structure', itemKey: `quote:${charStart}`, charStart, label: 'term', confidence: 0.7 },
    ]);
    await replaceShadowReviews(handle.db, chapter.id, 'structure', 'jev-test', []);
  });

  it('stores a character voice and exports ordered TTS tasks', async () => {
    const books = expectSuccess(await json<BookDto[]>(await app.request('/api/books')));
    const bookId = books[0]!.id;
    const characters = expectSuccess(await json<EntityDto[]>(await app.request(`/api/editions/${editionId}/entities`)));
    const character = characters.find((item) => item.type === 'character');
    expect(character).toBeDefined();
    const saved = await app.request(`/api/books/${bookId}/voices/${character!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'test', voiceId: 'one' }),
    });
    expect(saved.status).toBe(200);
    const profiles = expectSuccess(
      await json<{ entityId: string; voiceId: string }[]>(await app.request(`/api/books/${bookId}/voices`)),
    );
    expect(profiles.some((p) => p.entityId === character!.id && p.voiceId === 'one')).toBe(true);
    const tasks = expectSuccess(
      await json<{ text: string; segmentIndex: number }[]>(
        await app.request(`/api/editions/${editionId}/chapters/1/tts`),
      ),
    );
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.map((item) => item.segmentIndex)).toEqual(tasks.map((_, i) => i));
    const chapter = expectSuccess(
      await json<ChapterDetailDto>(await app.request(`/api/editions/${editionId}/chapters/1`)),
    );
    expect(tasks.map((t) => t.text).join('')).toBe(chapter.chapter.text);
  });

  it('rejects a non-numeric chapter index', async () => {
    const response = await app.request(`/api/editions/${editionId}/chapters/abc`);
    expect(response.status).toBe(400);
  });

  it('marks parsed chapters in the edition view', async () => {
    const detail = expectSuccess(await json<EditionDetailDto>(await app.request(`/api/editions/${editionId}`)));
    const parsed = detail.chapters.filter((c) => c.segmentCount > 0).map((c) => c.index);
    expect(parsed).toEqual([1, 2]);
    expect(detail.chapters[1]?.latestRun).toMatchObject({ status: 'succeeded', attempt: 1 });
    expect(detail.chapters[1]?.latestRun?.workerId).toMatch(/:\d+$/);
  });

  it('lists entities with counts', async () => {
    const entities = expectSuccess(await json<EntityDto[]>(await app.request(`/api/editions/${editionId}/entities`)));
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((e) => typeof e.dialogueCount === 'number' && Array.isArray(e.aliases))).toBe(true);
  });

  it('serves a timeline and lets a reviewer resolve a low-confidence item', async () => {
    const books = expectSuccess(await json<BookDto[]>(await app.request('/api/books')));
    const bookId = books[0]!.id;
    const id = await enqueueEntityReview(handle.db, {
      bookId,
      editionId,
      kind: 'entity',
      targetId: 'ent_test',
      reason: '需复核',
      confidence: 0.4,
    });
    const reviews = expectSuccess(
      await json<{ id: string; status: string }[]>(await app.request(`/api/books/${bookId}/reviews`)),
    );
    expect(reviews.some((r) => r.id === id && r.status === 'pending')).toBe(true);
    const resolved = await app.request(`/api/books/${bookId}/reviews/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(resolved.status).toBe(200);
    expect(
      (
        await app.request(`/api/books/${bookId}/reviews/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'rejected' }),
        })
      ).status,
    ).toBe(409);
    const timeline = expectSuccess(
      await json<{ id: string }[]>(await app.request(`/api/editions/${editionId}/timeline`)),
    );
    expect(Array.isArray(timeline)).toBe(true);
    expect((await app.request('/api/editions/ed_missing/timeline')).status).toBe(404);
  });

  it('renders the HTML report', async () => {
    const response = await app.request(`/api/editions/${editionId}/report`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('示例小说');
  });

  it('indexes scenes and searches only explicitly selected books', async () => {
    const embedder: Embedder = { model: 'test', embed: async () => [1, ...Array<number>(1535).fill(0)] };
    const searchable = createApp({
      db: handle.db,
      databaseKind: 'pglite',
      llm: undefined,
      pricing: undefined,
      jobs,
      logger: silentLogger,
      embedder,
    });
    const books = expectSuccess(await json<BookDto[]>(await searchable.request('/api/books')));
    const bookId = books[0]!.id;
    const indexed = await searchable.request(`/api/search/editions/${editionId}/index`, { method: 'POST' });
    expect(indexed.status).toBe(200);
    const response = await searchable.request('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '断剑', bookIds: [bookId] }),
    });
    const hits = expectSuccess(await json<SceneSearchResultDto[]>(response));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.bookId === bookId)).toBe(true);
    expect(hits[0]?.excerpt.length).toBeGreaterThan(0);
    expect(
      (
        await searchable.request('/api/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '断剑', bookIds: [] }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '断剑', bookIds: [bookId] }),
        })
      ).status,
    ).toBe(400);
  });

  it('cancels a queued job', async () => {
    const first = expectSuccess(
      await json<JobDto>(
        await app.request(`/api/editions/${editionId}/parse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from: 3, to: 4, force: true }),
        }),
      ),
    );
    const second = expectSuccess(
      await json<JobDto>(
        await app.request(`/api/editions/${editionId}/parse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from: 0, to: 4, force: true }),
        }),
      ),
    );
    const cancelled = expectSuccess(
      await json<JobDto>(await app.request(`/api/jobs/${second.id}/cancel`, { method: 'POST' })),
    );
    expect(cancelled.status).toBe('cancelled');
    expect((await waitForJob(first.id)).status).toBe('succeeded');
  });
});

describe('delete', () => {
  async function importTitled(title: string): Promise<ImportResultDto> {
    const form = new FormData();
    form.set('file', new File([fixture], 'demo-novel.txt', { type: 'text/plain' }));
    form.set('title', title);
    return expectSuccess(
      await json<ImportResultDto>(await app.request('/api/books/import', { method: 'POST', body: form })),
    );
  }

  it('refuses while a parse job of the book is queued or running, then deletes once it is done', async () => {
    const imported = await importTitled('待删除');
    const job = expectSuccess(
      await json<JobDto>(
        await app.request(`/api/editions/${imported.editionId}/parse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from: 0, to: 4 }),
        }),
      ),
    );
    const refused = await app.request(`/api/books/${imported.bookId}`, { method: 'DELETE' });
    expect(refused.status).toBe(409);
    await waitForJob(job.id);

    const response = await app.request(`/api/books/${imported.bookId}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(expectSuccess(await json<DeleteBookResultDto>(response))).toEqual({
      bookId: imported.bookId,
      title: '待删除',
      editions: 1,
      chapters: 5,
    });
    const books = expectSuccess(await json<BookDto[]>(await app.request('/api/books')));
    expect(books.map((b) => b.id)).not.toContain(imported.bookId);
    expect((await app.request(`/api/editions/${imported.editionId}`)).status).toBe(404);
  });

  it('answers 404 for a missing book', async () => {
    expect((await app.request('/api/books/book_missing', { method: 'DELETE' })).status).toBe(404);
  });

  it('answers 409 while another process holds the book lock', async () => {
    const imported = await importTitled('被锁住');
    await acquireBookLock(handle.db, {
      bookId: imported.bookId,
      owner: 'other',
      workerId: 'far:1',
      staleAfterMs: 60_000,
    });
    const response = await app.request(`/api/books/${imported.bookId}`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    const body = await json<never>(response);
    expect(body.success === false && body.error).toContain('far:1');
    await releaseBookLock(handle.db, imported.bookId, 'other');
    expect((await app.request(`/api/books/${imported.bookId}`, { method: 'DELETE' })).status).toBe(200);
  });
});
