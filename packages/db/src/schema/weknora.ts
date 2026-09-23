import { pgTable, text } from 'drizzle-orm/pg-core';
import { bookEditions, chapters } from './hierarchy.js';

/** External index pointers. Deleting and rebuilding WeKnora never deletes fact-layer evidence. */
export const weknoraKnowledgeBases = pgTable('weknora_knowledge_bases', {
  editionId: text('edition_id')
    .primaryKey()
    .references(() => bookEditions.id),
  knowledgeBaseId: text('knowledge_base_id').notNull(),
});

export const weknoraDocuments = pgTable('weknora_documents', {
  chapterId: text('chapter_id')
    .primaryKey()
    .references(() => chapters.id),
  knowledgeId: text('knowledge_id').notNull(),
  contentHash: text('content_hash').notNull(),
});
