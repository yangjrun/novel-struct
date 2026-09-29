import { getChapterById, getEdition, type Db } from '@novelstruct/db';
import {
  createEmbedder,
  parseEmbeddingConfig,
  parseWeKnoraConfig,
  WeKnoraClient,
  retrieveWeKnoraEvidence,
  type ContextSection,
  type Embedder,
} from '@novelstruct/knowledge';
import { createPostgresMemoryStore, type MemoryStore } from '@novelstruct/memory';

export interface ParserRetrieval {
  readonly weknora?: Pick<WeKnoraClient, 'search'>;
  readonly memory?: MemoryStore;
  readonly embedder?: Embedder;
  readonly budget?: number;
}

/** Called at process entry points only; credentials never enter queue payloads or prompts. */
export function createParserRetrieval(env: Readonly<Record<string, string | undefined>>): ParserRetrieval {
  const weknora = parseWeKnoraConfig(env);
  const embedding = parseEmbeddingConfig(env);
  return {
    ...(weknora ? { weknora: new WeKnoraClient(weknora) } : {}),
    ...(embedding ? { embedder: createEmbedder(embedding) } : {}),
  };
}

/** Uses historical scope for both memory and raw evidence. This function never writes. */
export async function recallParserContext(
  db: Db,
  chapterId: string,
  entities: readonly { id: string; canonicalName: string }[],
  retrieval: ParserRetrieval = {},
): Promise<Omit<ContextSection, 'estimatedTokens'>[]> {
  const chapter = await getChapterById(db, chapterId);
  if (!chapter) throw new Error('召回的章节不存在');
  const edition = await getEdition(db, chapter.editionId);
  if (!edition) throw new Error('召回的版本不存在');
  if (chapter.index === 0) return [];
  const memory = retrieval.memory ?? createPostgresMemoryStore(db);
  const involved = entities.filter((entity) => chapter.text.includes(entity.canonicalName)).slice(0, 30);
  const query = [...involved.flatMap((entity) => [entity.canonicalName, entity.id]), chapter.text.slice(0, 800)].join(
    ' ',
  );
  const [states, similar, evidence] = await Promise.all([
    Promise.all(
      involved.map((entity) => memory.recallState(edition.book.id, entity.id, chapter.index - 1, chapter.editionId)),
    ),
    memory.recallSimilar(edition.book.id, query, 20, chapter.editionId, chapter.index - 1),
    retrieval.weknora
      ? retrieveWeKnoraEvidence(db, {
          bookId: edition.book.id,
          editionId: chapter.editionId,
          beforeChapterIndex: chapter.index,
          query,
          client: retrieval.weknora,
        })
      : [],
  ]);
  const hits = new Map(
    [...states.flat(), ...similar].map((hit) => [`${hit.sourceFactTable}:${hit.sourceFactId}`, hit]),
  );
  return [
    ...[...hits.values()].map((hit) => ({
      kind: 'memory' as const,
      reference: hit.sourceFactId,
      content: `${hit.sourceFactTable} ${hit.entityId ?? ''}: ${hit.content}`,
    })),
    ...evidence.map((source) => ({
      kind: 'evidence' as const,
      reference: `${source.editionId}:${source.chapterId}:${source.charStart}:${source.charEnd}`,
      content: `第 ${source.chapterIndex} 章原文：${source.quote}`,
      evidence: source,
    })),
  ];
}
