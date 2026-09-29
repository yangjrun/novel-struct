import type { Command } from 'commander';
import {
  createEmbedder,
  indexEditionScenes,
  parseEmbeddingConfig,
  searchScenes,
  parseWeKnoraConfig,
  syncEditionToWeKnora,
  removeWeKnoraEdition,
  WeKnoraClient,
} from '@novelstruct/knowledge';
import { loadEnv } from '@novelstruct/pipeline';
import { withDatabase, fail } from '../context.js';
import { print } from '../output.js';

export function parseWeKnoraIndex(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    return fail(`章节 index 必须是非负安全整数，收到 ${value}`);
  return Number(value);
}

export function syncWeKnoraRange(options: { from?: number; to?: number }): { from: number; to: number } | undefined {
  if (options.from === undefined && options.to === undefined) return undefined;
  if (options.from === undefined || options.to === undefined || options.from > options.to)
    return fail('--from 和 --to 必须同时指定，且 from 不大于 to');
  return { from: options.from, to: options.to };
}

function embedder() {
  loadEnv();
  const config = parseEmbeddingConfig(process.env);
  if (config === undefined) return fail('先设置 EMBEDDING_API_KEY 和 EMBEDDING_MODEL');
  return createEmbedder(config);
}

export function registerSearch(program: Command): void {
  program
    .command('remove-weknora <editionId>')
    .description('删除该版本在 WeKnora 的派生 KB 与本地二级指针')
    .action(async (editionId: string) => {
      loadEnv();
      const config = parseWeKnoraConfig(process.env);
      if (!config) fail('先设置 WEKNORA_BASE_URL，并设置 WEKNORA_API_KEY 或 WEKNORA_BEARER_TOKEN');
      const removed = await withDatabase((db) => removeWeKnoraEdition(db, editionId, new WeKnoraClient(config)));
      print(removed ? 'WeKnora KB 已删除。' : '该版本没有 WeKnora KB。');
    });
  program
    .command('sync-weknora <editionId>')
    .description('同步一个版本到 WeKnora；--from/--to 限定章节范围并禁用远端孤儿文档清理')
    .option('--from <index>', '起始章节 index', parseWeKnoraIndex)
    .option('--to <index>', '结束章节 index（包含）', parseWeKnoraIndex)
    .action(async (editionId: string, options: { from?: number; to?: number }) => {
      const range = syncWeKnoraRange(options);
      loadEnv();
      const config = parseWeKnoraConfig(process.env);
      if (!config) fail('先设置 WEKNORA_BASE_URL，并设置 WEKNORA_API_KEY 或 WEKNORA_BEARER_TOKEN');
      let stopped = false;
      const onSignal = () => {
        stopped = true;
      };
      process.once('SIGINT', onSignal);
      try {
        const result = await withDatabase((db) =>
          syncEditionToWeKnora(db, editionId, new WeKnoraClient(config), {
            ...range,
            shouldStop: () => stopped,
            onChapter: (event) =>
              print(`[${event.index}] ${event.chapterId} ${event.status}，证据回填 ${event.linked}`),
          }),
        );
        print(`KB ${result.kbId}：新建 ${result.created}，更新 ${result.updated}，证据回填 ${result.linked}`);
      } finally {
        process.removeListener('SIGINT', onSignal);
      }
    });
  program
    .command('index <editionId>')
    .description('把已解析场景增量写入 pgvector（先配置 EMBEDDING_*）')
    .action(async (editionId: string) => {
      const result = await withDatabase((db) =>
        indexEditionScenes(db, {
          editionId,
          embedder: embedder(),
          onProgress: (done, total) => print(`已索引 ${done}/${total}`),
        }),
      );
      print(`索引完成：新增 ${result.indexed}，待检查 ${result.pending}`);
    });
  program
    .command('search <query>')
    .requiredOption('--book <id...>', '检索的书 ID（可多个，必须显式指定）')
    .option('--limit <number>', '最多返回结果数', '20')
    .description('按场景语义检索，结果带规范化原文偏移')
    .action(async (query: string, options: { book: string[]; limit: string }) => {
      const limit = Number(options.limit);
      const hits = await withDatabase((db) =>
        searchScenes(db, { query, bookIds: options.book, limit, embedder: embedder() }),
      );
      for (const hit of hits)
        print(
          `${hit.bookTitle} ${hit.editionLabel} 第 ${hit.chapterIndex} 章 场景 ${hit.sceneIndex} [${hit.charStart},${hit.charEnd}) 相似度 ${hit.similarity.toFixed(3)}\n${hit.excerpt}`,
        );
      if (hits.length === 0) print('没有索引结果。先运行 pnpm cli index <editionId>。');
    });
}
