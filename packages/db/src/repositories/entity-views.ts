import { and, asc, count, eq } from 'drizzle-orm';
import type { EntityType } from '@novelstruct/core';
import type { Db } from '../client.js';
import { entities, entityAliases, entityMentions, segments } from '../schema/index.js';

export interface EntityView {
  readonly id: string;
  readonly type: EntityType;
  readonly canonicalName: string;
  readonly description: string | null;
  readonly confidence: number;
  readonly aliases: readonly string[];
  readonly firstChapterId: string | null;
  readonly dialogueCount: number;
  readonly mentionCount: number;
}

/** Active entities of a book with aliases and how often each speaks or is mentioned. */
export async function listBookEntities(db: Db, bookId: string): Promise<EntityView[]> {
  const where = and(eq(entities.bookId, bookId), eq(entities.status, 'active'));
  const [rows, aliasRows, dialogueRows, mentionRows] = await Promise.all([
    db
      .select({
        id: entities.id,
        type: entities.type,
        canonicalName: entities.canonicalName,
        description: entities.description,
        confidence: entities.confidence,
        firstChapterId: entities.firstChapterId,
      })
      .from(entities)
      .where(where)
      .orderBy(asc(entities.createdAt), asc(entities.id)),
    db
      .select({ entityId: entityAliases.entityId, alias: entityAliases.alias })
      .from(entityAliases)
      .innerJoin(entities, eq(entities.id, entityAliases.entityId))
      .where(where)
      .orderBy(asc(entityAliases.alias)),
    db
      .select({ entityId: segments.speakerEntityId, count: count(segments.id) })
      .from(segments)
      .innerJoin(entities, eq(entities.id, segments.speakerEntityId))
      .where(where)
      .groupBy(segments.speakerEntityId),
    db
      .select({ entityId: entityMentions.entityId, count: count(entityMentions.id) })
      .from(entityMentions)
      .innerJoin(entities, eq(entities.id, entityMentions.entityId))
      .where(where)
      .groupBy(entityMentions.entityId),
  ]);

  const aliases = groupAliases(aliasRows);
  const dialogue = new Map(dialogueRows.flatMap((r) => (r.entityId === null ? [] : [[r.entityId, r.count] as const])));
  const mentions = new Map(mentionRows.map((r) => [r.entityId, r.count] as const));
  return rows.map((row) => ({
    ...row,
    aliases: aliases.get(row.id) ?? [],
    dialogueCount: dialogue.get(row.id) ?? 0,
    mentionCount: mentions.get(row.id) ?? 0,
  }));
}

function groupAliases(rows: readonly { entityId: string; alias: string }[]): Map<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.entityId) ?? [];
    list.push(row.alias);
    grouped.set(row.entityId, list);
  }
  return grouped;
}
