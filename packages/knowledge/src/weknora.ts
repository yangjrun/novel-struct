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

export interface WeKnoraConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export function parseWeKnoraConfig(env: Readonly<Record<string, string | undefined>>): WeKnoraConfig | undefined {
  const baseUrl = env['WEKNORA_BASE_URL']?.trim();
  const apiKey = env['WEKNORA_API_KEY']?.trim();
  if (!baseUrl && !apiKey) return undefined;
  if (!baseUrl || !apiKey) throw new Error('WEKNORA_BASE_URL 和 WEKNORA_API_KEY 必须同时设置');
  return { baseUrl, apiKey };
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

/** API v1: KB per edition, manual knowledge per chapter, chunk IDs are secondary pointers. */
export class WeKnoraClient {
  constructor(
    private readonly config: WeKnoraConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<WeKnoraEnvelope<T>> {
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
      method,
      headers: {
        'X-API-Key': this.config.apiKey,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`WeKnora HTTP ${response.status} at ${path}`);
    const envelope = (await response.json()) as WeKnoraEnvelope<T>;
    if (!envelope.success) throw new Error(`WeKnora rejected ${path}`);
    return envelope;
  }

  async createKnowledgeBase(name: string): Promise<{ id: string }> {
    return (await this.request<{ id: string }>('/knowledge-bases', 'POST', { name, type: 'document' })).data;
  }

  async createChapter(kbId: string, title: string, text: string): Promise<Knowledge> {
    return (
      await this.request<Knowledge>(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/manual`, 'POST', {
        title,
        content: text,
        channel: 'novelstruct',
      })
    ).data;
  }

  async updateChapter(id: string, title: string, text: string): Promise<Knowledge> {
    return (
      await this.request<Knowledge>(`/knowledge/manual/${encodeURIComponent(id)}`, 'PUT', { title, content: text })
    ).data;
  }

  async reparseChapter(id: string): Promise<Knowledge> {
    return (await this.request<Knowledge>(`/knowledge/${encodeURIComponent(id)}/reparse`, 'POST', {})).data;
  }

  async listChunks(id: string): Promise<{ id: string; content: string }[]> {
    const all: { id: string; content: string }[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.request<{ id: string; content: string }[]>(
        `/chunks/${encodeURIComponent(id)}?page=${page}&page_size=100`,
      );
      const chunks = result.data ?? [];
      all.push(...chunks);
      if (chunks.length < 100 || (result.total !== undefined && all.length >= result.total)) break;
    }
    return all;
  }

  async listKnowledgeBases(): Promise<{ id: string; name: string }[]> {
    return (await this.request<{ id: string; name: string }[]>('/knowledge-bases')).data;
  }

  async listDocuments(kbId: string): Promise<{ id: string; title: string }[]> {
    const all: { id: string; title: string }[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.request<{ id: string; title: string }[]>(
        `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge?page=${page}&page_size=100`,
      );
      const documents = result.data ?? [];
      all.push(...documents);
      if (documents.length < 100 || (result.total !== undefined && all.length >= result.total)) break;
    }
    return all;
  }

  async deleteChapter(id: string): Promise<void> {
    await this.request<unknown>(`/knowledge/${encodeURIComponent(id)}`, 'DELETE');
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    await this.request<unknown>(`/knowledge-bases/${encodeURIComponent(id)}`, 'DELETE');
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

export async function syncEditionToWeKnora(
  db: Db,
  editionId: string,
  client: WeKnoraClient,
): Promise<{ kbId: string; created: number; updated: number; linked: number }> {
  const found = await getEdition(db, editionId);
  if (!found) throw new Error(`版本 ${editionId} 不存在`);
  const kbName = `${found.book.title} · ${found.edition.label} [${editionId}]`;
  let kbId = await getWeKnoraKb(db, editionId);
  if (!kbId) {
    kbId =
      (await client.listKnowledgeBases()).find((kb) => kb.name === kbName)?.id ??
      (await client.createKnowledgeBase(kbName)).id;
    await saveWeKnoraKb(db, editionId, kbId);
  }
  let created = 0;
  let updated = 0;
  let linked = 0;
  const chapters = await listChaptersForWeKnora(db, editionId);
  const documents = await client.listDocuments(kbId);
  const currentIds = new Set(chapters.map((chapter) => chapter.id));
  for (const document of documents) {
    const chapterId = /\[(chp_[^\]]+)\]$/.exec(document.title)?.[1];
    if (chapterId && !currentIds.has(chapterId)) await client.deleteChapter(document.id);
  }
  for (const chapter of chapters) {
    if (!chapter.text.trim()) continue;
    let id = chapter.knowledgeId;
    const title = `${chapter.title ?? '章节'} [${chapter.id}]`;
    if (id === null) {
      const existing = documents.find((doc) => doc.title === title);
      id = existing?.id ?? (await client.createChapter(kbId, title, chapter.text)).id;
      if (!existing) {
        await client.reparseChapter(id);
        created += 1;
      } else {
        await client.updateChapter(id, title, chapter.text);
        await clearWeKnoraPointers(db, chapter.id);
        await client.reparseChapter(id);
        updated += 1;
      }
      await saveWeKnoraDocument(db, chapter.id, id, chapter.contentHash);
    } else if (chapter.indexedHash !== chapter.contentHash || documents.find((doc) => doc.id === id)?.title !== title) {
      await client.updateChapter(id, title, chapter.text);
      await clearWeKnoraPointers(db, chapter.id);
      await client.reparseChapter(id);
      await saveWeKnoraDocument(db, chapter.id, id, chapter.contentHash);
      updated += 1;
    }
    // Parsing is asynchronous; repeat sync after WeKnora finishes to backfill chunk IDs.
    linked += await linkWeKnoraChunks(db, chapter.id, await client.listChunks(id));
  }
  return { kbId, created, updated, linked };
}
