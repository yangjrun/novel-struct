import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbHandle, openDatabase } from '@novelstruct/db';
import type { Hono } from 'hono';
import { createApp } from '../src/app.js';
import type {
  ApiResponse,
  BookDto,
  ChapterDetailDto,
  ConfigDto,
  EditionDetailDto,
  EntityDto,
  ImportResultDto,
  JobDto,
} from '../src/contracts.js';
import { JobManager } from '../src/jobs/manager.js';
import { silentLogger } from '../src/log.js';

const fixture = readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url));

let handle: DbHandle;
let app: Hono;
let jobs: JobManager;

beforeAll(async () => {
  handle = await openDatabase({ inMemory: true });
  await handle.migrate();
  jobs = new JobManager({ db: handle.db, llm: undefined, logger: silentLogger });
  app = createApp({ db: handle.db, databaseKind: 'pglite', llm: undefined, jobs, logger: silentLogger });
});

afterAll(async () => {
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
    const job = jobs.get(id);
    if (job !== undefined && job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job ${id} did not finish`);
}

describe('config and errors', () => {
  it('reports the runtime configuration', async () => {
    const body = await json<ConfigDto>(await app.request('/api/config'));
    expect(expectSuccess(body)).toEqual({
      database: 'pglite',
      llmConfigured: false,
      llmModel: null,
      attributors: ['heuristic', 'llm'],
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

  it('serves parsed segments and neighbours for a chapter', async () => {
    const detail = expectSuccess(
      await json<ChapterDetailDto>(await app.request(`/api/editions/${editionId}/chapters/1`)),
    );
    expect(detail.chapter.title).toBe('断剑');
    expect(detail.segments.length).toBeGreaterThan(0);
    expect(detail.prevIndex).toBe(0);
    expect(detail.nextIndex).toBe(2);
  });

  it('rejects a non-numeric chapter index', async () => {
    const response = await app.request(`/api/editions/${editionId}/chapters/abc`);
    expect(response.status).toBe(400);
  });

  it('marks parsed chapters in the edition view', async () => {
    const detail = expectSuccess(await json<EditionDetailDto>(await app.request(`/api/editions/${editionId}`)));
    const parsed = detail.chapters.filter((c) => c.segmentCount > 0).map((c) => c.index);
    expect(parsed).toEqual([1, 2]);
    expect(detail.chapters[1]?.latestRun?.status).toBe('succeeded');
  });

  it('lists entities with counts', async () => {
    const entities = expectSuccess(await json<EntityDto[]>(await app.request(`/api/editions/${editionId}/entities`)));
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((e) => typeof e.dialogueCount === 'number' && Array.isArray(e.aliases))).toBe(true);
  });

  it('renders the HTML report', async () => {
    const response = await app.request(`/api/editions/${editionId}/report`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('示例小说');
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
