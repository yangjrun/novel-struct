import { getEdition, getWeKnoraKb, listWeKnoraSources, type Db } from '@novelstruct/db';
import type { WeKnoraClient } from './weknora.js';

export interface RetrievedEvidence {
  readonly editionId: string;
  readonly chapterId: string;
  readonly chapterIndex: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly quote: string;
  readonly chunkId: string;
}

/** Remote hits are hints until uniquely located in the current, locally owned text. */
export async function retrieveWeKnoraEvidence(
  db: Db,
  input: {
    readonly bookId: string;
    readonly editionId: string;
    readonly beforeChapterIndex: number;
    readonly query: string;
    readonly client: Pick<WeKnoraClient, 'search'>;
  },
): Promise<RetrievedEvidence[]> {
  if (!Number.isSafeInteger(input.beforeChapterIndex) || input.beforeChapterIndex < 0)
    throw new Error('检索章节 index 必须是非负整数');
  const edition = await getEdition(db, input.editionId);
  if (edition?.book.id !== input.bookId) throw new Error('证据检索的书与版本不匹配');
  if (input.beforeChapterIndex === 0 || !input.query.trim()) return [];
  const kbId = await getWeKnoraKb(db, input.editionId);
  if (!kbId) return [];
  const hits = await input.client.search(kbId, input.query.slice(0, 1200), 50);
  const sources = await listWeKnoraSources(
    db,
    input.editionId,
    hits.map((hit) => hit.knowledge_id),
  );
  const byId = new Map(sources.map((source) => [source.knowledgeId, source]));
  const seen = new Set<string>();
  const evidence: RetrievedEvidence[] = [];
  for (const hit of [...hits].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))) {
    if (hit.knowledge_base_id !== undefined && hit.knowledge_base_id !== kbId) continue;
    const source = byId.get(hit.knowledge_id);
    if (!source || source.chapterIndex >= input.beforeChapterIndex || source.contentHash !== source.indexedHash)
      continue;
    if (!hit.content.trim()) continue;
    const start = source.text.indexOf(hit.content);
    if (start < 0 || source.text.indexOf(hit.content, start + 1) >= 0) continue;
    const end = start + hit.content.length;
    const key = `${source.chapterId}:${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({
      editionId: input.editionId,
      chapterId: source.chapterId,
      chapterIndex: source.chapterIndex,
      charStart: start,
      charEnd: end,
      quote: source.text.slice(start, end),
      chunkId: hit.id,
    });
    if (evidence.length >= 10) break;
  }
  return evidence;
}
