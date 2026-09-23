import {
  getBook,
  getEdition,
  listEditionIds,
  listScenesToIndex,
  saveSceneEmbedding,
  searchSceneEmbeddings,
  type Db,
  type SceneSearchHit,
} from '@novelstruct/db';
import type { Embedder } from './embedding.js';

export interface IndexScenesInput {
  readonly editionId: string;
  readonly embedder: Embedder;
  readonly onProgress?: (done: number, total: number) => void;
}

/** Explicit, resumable indexing: repeated calls only embed new/changed scenes. */
export async function indexEditionScenes(
  db: Db,
  input: IndexScenesInput,
): Promise<{ indexed: number; pending: number }> {
  if ((await getEdition(db, input.editionId)) === undefined) throw new Error(`版本 ${input.editionId} 不存在`);
  const scenes = await listScenesToIndex(db, [input.editionId], input.embedder.model);
  let indexed = 0;
  for (const scene of scenes) {
    const embedding = await input.embedder.embed(scene.text);
    if (await saveSceneEmbedding(db, scene, input.embedder.model, embedding)) indexed += 1;
    input.onProgress?.(indexed, scenes.length);
  }
  return { indexed, pending: scenes.length };
}

export interface SearchInput {
  readonly query: string;
  /** Explicit scope, even when searching across multiple books. */
  readonly bookIds: readonly string[];
  readonly limit?: number;
  readonly embedder: Embedder;
}

export async function searchScenes(db: Db, input: SearchInput): Promise<SceneSearchHit[]> {
  if (!input.query.trim()) throw new Error('检索词不能为空');
  if (input.bookIds.length === 0) throw new Error('请至少指定一本书');
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)) {
    throw new Error('limit 必须在 1 到 50 之间');
  }
  for (const id of input.bookIds) if ((await getBook(db, id)) === undefined) throw new Error(`书 ${id} 不存在`);
  const embedding = await input.embedder.embed(input.query.trim());
  return searchSceneEmbeddings(db, {
    embedding,
    model: input.embedder.model,
    bookIds: input.bookIds,
    limit: input.limit ?? 20,
  });
}

export async function indexBookScenes(db: Db, bookId: string, embedder: Embedder): Promise<number> {
  if ((await getBook(db, bookId)) === undefined) throw new Error(`书 ${bookId} 不存在`);
  let indexed = 0;
  for (const editionId of await listEditionIds(db, bookId))
    indexed += (await indexEditionScenes(db, { editionId, embedder })).indexed;
  return indexed;
}
