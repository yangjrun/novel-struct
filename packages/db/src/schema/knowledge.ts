import { index, pgTable, text, vector } from 'drizzle-orm/pg-core';
import { books, bookEditions } from './hierarchy.js';
import { scenes } from './structure.js';

/** Rebuildable retrieval data. The scene and its chapter offsets remain the source of truth. */
export const sceneEmbeddings = pgTable(
  'scene_embeddings',
  {
    sceneId: text('scene_id')
      .primaryKey()
      .references(() => scenes.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id),
    editionId: text('edition_id')
      .notNull()
      .references(() => bookEditions.id),
    model: text('model').notNull(),
    contentHash: text('content_hash').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  },
  (t) => [
    index('scene_embeddings_book_model_idx').on(t.bookId, t.model),
    index('scene_embeddings_cosine_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);
