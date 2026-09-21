import { and, eq } from 'drizzle-orm';
import type { KnownEntity } from '@novelstruct/core';
import type { Db } from '../client.js';
import { entities, entityAliases } from '../schema/index.js';

/** Active entities of a book with their aliases, in the shape the parser consumes. */
export async function listKnownEntities(db: Db, bookId: string): Promise<KnownEntity[]> {
  const rows = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
      alias: entityAliases.alias,
    })
    .from(entities)
    .leftJoin(entityAliases, eq(entityAliases.entityId, entities.id))
    .where(and(eq(entities.bookId, bookId), eq(entities.status, 'active')))
    .orderBy(entities.createdAt, entities.id);

  // Local accumulator: linear in rows, invisible to callers.
  const byId = new Map<string, { id: string; type: KnownEntity['type']; canonicalName: string; aliases: string[] }>();
  for (const row of rows) {
    const current = byId.get(row.id) ?? { id: row.id, type: row.type, canonicalName: row.canonicalName, aliases: [] };
    if (row.alias !== null) current.aliases.push(row.alias);
    byId.set(row.id, current);
  }
  return [...byId.values()].map((e) => ({ ...e, aliases: [...e.aliases] }));
}
