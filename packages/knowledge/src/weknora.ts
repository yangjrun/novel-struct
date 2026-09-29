import {
  clearWeKnoraEditionPointers,
  clearWeKnoraPointers,
  getEdition,
  getWeKnoraKb,
  linkWeKnoraChunks,
  listChaptersForWeKnora,
  saveWeKnoraDocument,
  saveWeKnoraKb,
  type Db,
} from '@novelstruct/db';

export type WeKnoraConfig = { readonly baseUrl: string; readonly embeddingModelId?: string } & (
  { readonly apiKey: string; readonly bearerToken?: never } | { readonly bearerToken: string; readonly apiKey?: never }
);

export function parseWeKnoraConfig(env: Readonly<Record<string, string | undefined>>): WeKnoraConfig | undefined {
  const baseUrl = env['WEKNORA_BASE_URL']?.trim();
  const apiKey = env['WEKNORA_API_KEY']?.trim();
  const bearerToken = env['WEKNORA_BEARER_TOKEN']?.trim();
  const embeddingModelId = env['WEKNORA_EMBEDDING_MODEL_ID']?.trim();
  if (!baseUrl && !apiKey && !bearerToken && !embeddingModelId) return undefined;
  if (apiKey && bearerToken) throw new Error('WEKNORA_API_KEY 与 WEKNORA_BEARER_TOKEN 只能配置一种');
  if (!baseUrl || (!apiKey && !bearerToken))
    throw new Error('WEKNORA_BASE_URL 和 WEKNORA_API_KEY 或 WEKNORA_BEARER_TOKEN 必须同时设置');
  const model = embeddingModelId === undefined ? {} : { embeddingModelId };
  if (!bearerToken) return { baseUrl, apiKey: apiKey!, ...model };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('WEKNORA_BASE_URL 不是有效的服务根路径');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new Error('WEKNORA_BASE_URL 必须是服务根路径，不能包含凭据、路径或查询参数');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('远程 WeKnora Bearer Token 必须使用 HTTPS（本机回环地址可用 HTTP）');
  const token = bearerToken.replace(/^Bearer\s+/i, '');
  if (!token || /^Bearer$/i.test(token) || /\s/.test(token)) throw new Error('WEKNORA_BEARER_TOKEN 的 Token 格式无效');
  return { baseUrl: url.origin, bearerToken: token, ...model };
}

interface WeKnoraEnvelope<T> {
  success: boolean;
  data: T;
  total?: number;
}
interface Knowledge {
  id: string;
  parse_status?: string;
}

export interface WeKnoraSearchHit {
  id: string;
  content: string;
  knowledge_id: string;
  knowledge_base_id?: string;
  score: number;
}

interface WeKnoraDocument {
  id: string;
  title: string;
  parse_status?: string;
}

type DataGuard<T> = (value: unknown) => value is T;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasId = (value: unknown): value is Record<string, unknown> & { id: string } =>
  isRecord(value) && typeof value['id'] === 'string';
const isKnowledge = (value: unknown): value is Knowledge =>
  hasId(value) && (value.parse_status === undefined || typeof value.parse_status === 'string');
const isKnowledgeBase = (value: unknown): value is { id: string; name: string } =>
  hasId(value) && typeof value['name'] === 'string';
const isDocument = (value: unknown): value is WeKnoraDocument =>
  isKnowledge(value) && 'title' in value && typeof value.title === 'string';
const isSearchHit = (value: unknown): value is WeKnoraSearchHit =>
  hasId(value) &&
  typeof value['content'] === 'string' &&
  typeof value['knowledge_id'] === 'string' &&
  typeof value['score'] === 'number' &&
  Number.isFinite(value['score']) &&
  (value['knowledge_base_id'] === undefined || typeof value['knowledge_base_id'] === 'string');
const isChunk = (value: unknown): value is { id: string; content: string } =>
  hasId(value) && typeof value['content'] === 'string';
const isList =
  <T>(item: DataGuard<T>): DataGuard<T[]> =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(item);
const isUnknown = (_value: unknown): _value is unknown => true;

/** API v1: KB per edition, manual knowledge per chapter, chunk IDs are secondary pointers. */
export class WeKnoraClient {
  private readonly config: WeKnoraConfig;
  constructor(
    config: WeKnoraConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (config.bearerToken) {
      const validated = parseWeKnoraConfig({
        WEKNORA_BASE_URL: config.baseUrl,
        WEKNORA_BEARER_TOKEN: config.bearerToken,
        WEKNORA_EMBEDDING_MODEL_ID: config.embeddingModelId,
      });
      if (!validated?.bearerToken) throw new Error('WeKnora Bearer 配置无效');
      this.config = validated;
    } else {
      this.config = config;
    }
  }

  private async request<T>(
    path: string,
    guard: DataGuard<T>,
    method = 'GET',
    body?: unknown,
  ): Promise<WeKnoraEnvelope<T>> {
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
      method,
      headers: {
        ...(this.config.bearerToken
          ? { authorization: `Bearer ${this.config.bearerToken}` }
          : { 'X-API-Key': this.config.apiKey! }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`WeKnora HTTP ${response.status} at ${path}`);
    const envelope: unknown = await response.json();
    if (!isRecord(envelope) || envelope['success'] !== true) throw new Error(`WeKnora rejected ${path}`);
    const data: unknown = envelope['data'] === null && envelope['total'] === 0 && guard([]) ? [] : envelope['data'];
    if (
      !guard(data) ||
      (envelope['total'] !== undefined && (!Number.isSafeInteger(envelope['total']) || Number(envelope['total']) < 0))
    )
      throw new Error(`WeKnora returned invalid data at ${path}`);
    return {
      success: true,
      data,
      ...(envelope['total'] === undefined ? {} : { total: envelope['total'] as number }),
    };
  }

  async createKnowledgeBase(name: string): Promise<{ id: string }> {
    return (
      await this.request('/knowledge-bases', hasId, 'POST', {
        name,
        type: 'document',
        ...(this.config.embeddingModelId ? { embedding_model_id: this.config.embeddingModelId } : {}),
      })
    ).data;
  }

  async verifyEmbeddingModel(kbId: string): Promise<void> {
    if (!this.config.embeddingModelId) return;
    const { data } = await this.request(`/knowledge-bases/${encodeURIComponent(kbId)}`, hasId);
    if (data.id !== kbId || data['embedding_model_id'] !== this.config.embeddingModelId)
      throw new Error(`WeKnora KB ${kbId} 的 embedding_model_id 与配置不一致；请确认并显式重建该版本的派生 KB`);
  }

  async createChapter(kbId: string, title: string, text: string): Promise<Knowledge> {
    return (
      await this.request(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/manual`, isKnowledge, 'POST', {
        title,
        content: text,
        channel: 'novelstruct',
      })
    ).data;
  }

  async updateChapter(id: string, title: string, text: string): Promise<Knowledge> {
    return (
      await this.request(`/knowledge/manual/${encodeURIComponent(id)}`, isKnowledge, 'PUT', { title, content: text })
    ).data;
  }

  async reparseChapter(id: string): Promise<Knowledge> {
    return (await this.request(`/knowledge/${encodeURIComponent(id)}/reparse`, isKnowledge, 'POST', {})).data;
  }

  async listChunks(id: string): Promise<{ id: string; content: string }[]> {
    const all: { id: string; content: string }[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.request(
        `/chunks/${encodeURIComponent(id)}?page=${page}&page_size=100`,
        isList(isChunk),
      );
      const chunks = result.data ?? [];
      all.push(...chunks);
      if (chunks.length < 100 || (result.total !== undefined && all.length >= result.total)) break;
    }
    return all;
  }

  async listKnowledgeBases(): Promise<{ id: string; name: string }[]> {
    return (await this.request('/knowledge-bases', isList(isKnowledgeBase))).data;
  }

  async search(kbId: string, query: string, limit: number): Promise<WeKnoraSearchHit[]> {
    const guard = (value: unknown): value is WeKnoraSearchHit[] | null => value === null || isList(isSearchHit)(value);
    return (
      (
        await this.request(`/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`, guard, 'POST', {
          query_text: query,
          match_count: limit,
          vector_threshold: 0.2,
          keyword_threshold: 0,
        })
      ).data ?? []
    );
  }

  async listDocuments(kbId: string): Promise<WeKnoraDocument[]> {
    const all: WeKnoraDocument[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.request(
        `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge?page=${page}&page_size=100`,
        isList(isDocument),
      );
      const documents = result.data ?? [];
      all.push(...documents);
      if (documents.length < 100 || (result.total !== undefined && all.length >= result.total)) break;
    }
    return all;
  }

  async deleteChapter(id: string): Promise<void> {
    await this.request(`/knowledge/${encodeURIComponent(id)}`, isUnknown, 'DELETE');
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    await this.request(`/knowledge-bases/${encodeURIComponent(id)}`, isUnknown, 'DELETE');
  }
}

/** Remove a derived KB before dropping its local mapping; the original evidence remains. */
export async function removeWeKnoraEdition(db: Db, editionId: string, client: WeKnoraClient): Promise<boolean> {
  const kbId = await getWeKnoraKb(db, editionId);
  if (!kbId) return false;
  await client.deleteKnowledgeBase(kbId);
  await clearWeKnoraEditionPointers(db, editionId);
  return true;
}

export interface WeKnoraSyncOptions {
  readonly from?: number;
  readonly to?: number;
  readonly onChapter?: (event: {
    index: number;
    chapterId: string;
    status: 'created' | 'updated' | 'skipped';
    linked: number;
  }) => void | Promise<void>;
  readonly shouldStop?: () => boolean | Promise<boolean>;
}

const MAX_SCOPED_CHAPTERS = 10;

export async function syncEditionToWeKnora(
  db: Db,
  editionId: string,
  client: WeKnoraClient,
  options: WeKnoraSyncOptions = {},
): Promise<{ kbId: string; created: number; updated: number; linked: number }> {
  const { from, to } = options;
  if (
    (from === undefined) !== (to === undefined) ||
    (from !== undefined &&
      to !== undefined &&
      (!Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 0 ||
        to < from ||
        to - from + 1 > MAX_SCOPED_CHAPTERS))
  )
    throw new Error(`章节范围无效；--from/--to 须同时指定，且最多 ${MAX_SCOPED_CHAPTERS} 章`);
  const range = from === undefined || to === undefined ? undefined : { from, to };
  const found = await getEdition(db, editionId);
  if (!found) throw new Error(`版本 ${editionId} 不存在`);
  const chapters = await listChaptersForWeKnora(db, editionId, range);
  if (
    range &&
    (chapters.length !== range.to - range.from + 1 ||
      chapters.some(
        (chapter, offset) =>
          chapter.index !== range.from + offset || chapter.kind !== 'chapter' || !chapter.text.trim(),
      ))
  )
    throw new Error('章节范围包含缺失、非正文章节或空正文，未调用 WeKnora');
  const checkStop = async (stage: string): Promise<void> => {
    if (await options.shouldStop?.()) throw new Error(`WeKnora 同步在${stage}前取消`);
  };
  await checkStop('外部写入');
  const kbName = `${found.book.title} · ${found.edition.label} [${editionId}]`;
  let kbId = await getWeKnoraKb(db, editionId);
  if (kbId) {
    await client.verifyEmbeddingModel(kbId);
  } else {
    const existing = (await client.listKnowledgeBases()).find((kb) => kb.name === kbName);
    if (existing) {
      await client.verifyEmbeddingModel(existing.id);
      kbId = existing.id;
    } else {
      await checkStop('创建 KB');
      kbId = (await client.createKnowledgeBase(kbName)).id;
      await client.verifyEmbeddingModel(kbId);
    }
    await saveWeKnoraKb(db, editionId, kbId);
  }
  let created = 0;
  let updated = 0;
  let linked = 0;
  const documents = await client.listDocuments(kbId);
  if (!range) {
    const currentIds = new Set(chapters.map((chapter) => chapter.id));
    for (const document of documents) {
      if (await options.shouldStop?.()) throw new Error('WeKnora 同步在远端删除前取消');
      const chapterId = /\[(chp_[^\]]+)\]$/.exec(document.title)?.[1];
      if (chapterId && !currentIds.has(chapterId)) await client.deleteChapter(document.id);
    }
  }
  for (const chapter of chapters) {
    await checkStop(`章节 ${chapter.index} `);
    if (!chapter.text.trim()) continue;
    let status: 'created' | 'updated' | 'skipped' = 'skipped';
    let id = chapter.knowledgeId;
    const remoteDocument = documents.find((doc) => doc.id === id);
    if (id !== null && !remoteDocument) {
      // A document removed remotely can be recreated by repeating this explicit range.
      await clearWeKnoraPointers(db, chapter.id);
      id = null;
    }
    const title = `${chapter.title ?? '章节'} [${chapter.id}]`;
    if (id === null) {
      const existing = documents.find((doc) => doc.title === title);
      if (!existing) {
        await checkStop(`创建章节 ${chapter.index} `);
        id = (await client.createChapter(kbId, title, chapter.text)).id;
        await checkStop(`解析章节 ${chapter.index} `);
        await client.reparseChapter(id);
        created += 1;
        status = 'created';
      } else {
        id = existing.id;
        await checkStop(`更新章节 ${chapter.index} `);
        await client.updateChapter(id, title, chapter.text);
        await clearWeKnoraPointers(db, chapter.id);
        await checkStop(`解析章节 ${chapter.index} `);
        await client.reparseChapter(id);
        updated += 1;
        status = 'updated';
      }
      await saveWeKnoraDocument(db, chapter.id, id, chapter.contentHash);
    } else if (
      chapter.indexedHash !== chapter.contentHash ||
      remoteDocument?.title !== title ||
      remoteDocument.parse_status === 'failed' ||
      remoteDocument.parse_status === 'cancelled'
    ) {
      await checkStop(`更新章节 ${chapter.index} `);
      await client.updateChapter(id, title, chapter.text);
      await clearWeKnoraPointers(db, chapter.id);
      await checkStop(`解析章节 ${chapter.index} `);
      await client.reparseChapter(id);
      await saveWeKnoraDocument(db, chapter.id, id, chapter.contentHash);
      updated += 1;
      status = 'updated';
    }
    // Parsing is asynchronous; repeat sync after WeKnora finishes to backfill chunk IDs.
    const chapterLinked = await linkWeKnoraChunks(db, chapter.id, await client.listChunks(id));
    linked += chapterLinked;
    await options.onChapter?.({ index: chapter.index, chapterId: chapter.id, status, linked: chapterLinked });
  }
  await checkStop('结束报告');
  return { kbId, created, updated, linked };
}
