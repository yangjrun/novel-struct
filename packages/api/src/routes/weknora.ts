import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  acquireBookLock,
  releaseBookLock,
  renewBookLock,
  getBook,
  getEdition,
  getWeKnoraKb,
  getWeKnoraLocalStatus,
  listChaptersForWeKnora,
  listWeKnoraEditions,
  listWeKnoraSources,
} from '@novelstruct/db';
import { syncEditionToWeKnora } from '@novelstruct/knowledge';
import { defaultWorkerId, STALE_RUN_AFTER_MS } from '@novelstruct/pipeline';
import type { AppContext } from '../context.js';
import type { WeKnoraStatusDto, WeKnoraSearchDto, WeKnoraSearchResultDto, WeKnoraSyncResultDto } from '../contracts.js';
import { HttpError } from '../errors.js';
import { ok } from '../respond.js';

const SyncRequest = z
  .object({ from: z.number().int().min(0), to: z.number().int().min(0) })
  .strict()
  .refine(({ from, to }) => to >= from && to - from < 10, '请选择连续章节，每次最多 10 章');
const SearchRequest = z
  .object({
    query: z.string().trim().min(1).max(500),
    bookIds: z.array(z.string().min(1)).min(1).max(100),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

function requireClient(ctx: AppContext) {
  if (!ctx.weknora) throw new HttpError(400, 'WeKnora 未配置，请在服务端设置地址和访问凭据后重启 API');
  return ctx.weknora;
}

/** Do not send upstream bodies or credentials to the browser. */
function upstreamMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/^WeKnora HTTP (401|403) /.test(message)) return 'WeKnora 鉴权失败，请检查服务端凭据或访问权限';
  if (/^WeKnora HTTP 404 /.test(message)) return 'WeKnora 知识库或文档不存在，请检查远端状态';
  if (/embedding_model_id 与配置不一致/.test(message)) return 'WeKnora 知识库的向量模型与服务端配置不一致，请检查配置';
  return 'WeKnora 请求失败或超时，请检查服务状态后重试';
}

export function weknoraRoutes(ctx: AppContext): Hono {
  return new Hono()
    .get('/editions/:id', async (c) => {
      const editionId = c.req.param('id');
      if (!(await getEdition(ctx.db, editionId))) throw new HttpError(404, '版本不存在');
      const kbId = await getWeKnoraKb(ctx.db, editionId);
      const local = await getWeKnoraLocalStatus(ctx.db, editionId);
      let remoteError: string | null = null;
      let documents: Awaited<ReturnType<NonNullable<AppContext['weknora']>['listDocuments']>> | undefined;
      if (ctx.weknora && kbId) {
        try {
          documents = await ctx.weknora.listDocuments(kbId);
        } catch (error) {
          remoteError = upstreamMessage(error);
        }
      }
      const byId = new Map(documents?.map((document) => [document.id, document]));
      const dto: WeKnoraStatusDto = {
        configured: ctx.weknora !== undefined,
        kbId: kbId ?? null,
        remoteError,
        evidenceTotal: local.evidenceTotal,
        evidenceLinked: local.evidenceLinked,
        chapters: local.chapters.map((chapter) => ({
          chapterId: chapter.chapterId,
          index: chapter.index,
          title: chapter.title,
          knowledgeId: chapter.knowledgeId,
          needsSync:
            chapter.knowledgeId === null ||
            chapter.contentHash !== chapter.indexedHash ||
            (documents !== undefined && !byId.has(chapter.knowledgeId)),
          parseStatus:
            chapter.knowledgeId === null || !documents
              ? null
              : (byId.get(chapter.knowledgeId)?.parse_status ??
                (byId.has(chapter.knowledgeId) ? 'unknown' : 'missing')),
        })),
      };
      return ok(c, dto);
    })
    .post('/editions/:id/sync', async (c) => {
      const client = requireClient(ctx);
      const range = SyncRequest.parse(await c.req.json());
      const editionId = c.req.param('id');
      const found = await getEdition(ctx.db, editionId);
      if (!found) throw new HttpError(404, '版本不存在');
      const bookId = found.book.id;
      const workerId = defaultWorkerId();
      const owner = `weknora:${workerId}#${randomUUID()}`;
      const lock = await acquireBookLock(ctx.db, { bookId, owner, workerId, staleAfterMs: STALE_RUN_AFTER_MS });
      if (!lock.acquired) throw new HttpError(409, '这本书正在解析或同步，请等待当前操作完成后重试');
      let lost = false;
      let renewing = Promise.resolve();
      const timer = setInterval(() => {
        renewing = renewing
          .then(async () => {
            if (!(await renewBookLock(ctx.db, bookId, owner))) lost = true;
          })
          .catch(() => {
            lost = true;
          });
      }, 10_000);
      const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(600_000)]);
      try {
        const chapters = await listChaptersForWeKnora(ctx.db, editionId, range);
        if (
          chapters.length !== range.to - range.from + 1 ||
          chapters.some(
            (chapter, i) => chapter.index !== range.from + i || chapter.kind !== 'chapter' || !chapter.text.trim(),
          )
        ) {
          throw new HttpError(400, '请选择连续的非空正文章节；范围不能包含前言、留言或缺失章节');
        }
        const progress: WeKnoraSyncResultDto['chapters'][number][] = [];
        try {
          const result = await syncEditionToWeKnora(ctx.db, editionId, client, {
            ...range,
            shouldStop: () => lost || signal.aborted,
            onChapter: (event) => {
              progress.push(event);
            },
          });
          return ok(c, { ...result, chapters: progress } satisfies WeKnoraSyncResultDto);
        } catch (error) {
          const message = lost || signal.aborted ? '同步已中断' : upstreamMessage(error);
          throw new HttpError(502, `${message}。部分章节可能已提交，请刷新状态；可用相同范围重试。`);
        }
      } finally {
        clearInterval(timer);
        await renewing;
        await releaseBookLock(ctx.db, bookId, owner);
      }
    })
    .post('/search', async (c) => {
      const client = requireClient(ctx);
      const input = SearchRequest.parse(await c.req.json());
      const bookIds = [...new Set(input.bookIds)];
      for (const bookId of bookIds) {
        if (!(await getBook(ctx.db, bookId))) throw new HttpError(404, '所选书籍不存在');
      }
      const editions = await listWeKnoraEditions(ctx.db, bookIds);
      const indexed = editions.filter((edition) => edition.kbId !== null);
      const results: WeKnoraSearchResultDto[] = [];
      // Limit upstream concurrency, and never let the browser supply arbitrary remote KB IDs.
      for (let offset = 0; offset < indexed.length; offset += 4) {
        const batches = await Promise.all(
          indexed.slice(offset, offset + 4).map(async (edition) => {
            let hits;
            try {
              hits = await client.search(edition.kbId!, input.query, input.limit);
            } catch (error) {
              throw new HttpError(502, upstreamMessage(error));
            }
            const sources = await listWeKnoraSources(
              ctx.db,
              edition.editionId,
              hits.map((hit) => hit.knowledge_id),
            );
            const byId = new Map(sources.map((source) => [source.knowledgeId, source]));
            const mapped: WeKnoraSearchResultDto[] = [];
            const seen = new Set<string>();
            for (const hit of hits) {
              const source = byId.get(hit.knowledge_id);
              if (
                !source ||
                source.indexedHash !== source.contentHash ||
                seen.has(hit.id) ||
                (hit.knowledge_base_id && hit.knowledge_base_id !== edition.kbId)
              )
                continue;
              seen.add(hit.id);
              const start = hit.content ? source.text.indexOf(hit.content) : -1;
              const exact = start >= 0 && source.text.indexOf(hit.content, start + 1) === -1;
              mapped.push({
                chunkId: hit.id,
                bookId: edition.bookId,
                bookTitle: edition.bookTitle,
                editionId: edition.editionId,
                editionLabel: edition.editionLabel,
                chapterIndex: source.chapterIndex,
                chapterTitle: source.chapterTitle,
                charStart: exact ? start : null,
                charEnd: exact ? start + hit.content.length : null,
                excerpt: hit.content,
                score: hit.score,
              });
            }
            return mapped;
          }),
        );
        results.push(...batches.flat());
      }
      return ok(c, {
        results: results.sort((a, b) => b.score - a.score).slice(0, input.limit),
        skippedEditions: editions
          .filter((edition) => !edition.kbId)
          .map(({ editionId, bookTitle, editionLabel }) => ({ editionId, bookTitle, editionLabel })),
      } satisfies WeKnoraSearchDto);
    });
}
