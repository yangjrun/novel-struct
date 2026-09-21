import { type EntityIR, type EntityType, type KnownEntity, entityNames, newId } from '@novelstruct/core';
import type { ExtractedEntity } from './attribution/types.js';

export interface ResolvedEntities {
  /** Entities to emit in the IR: known ones observed this chapter plus new ones. */
  readonly entities: readonly EntityIR[];
  /** `entityKey(type, name)` → entity id, covering canonical names and aliases, known and new. */
  readonly idByKey: ReadonlyMap<string, string>;
}

/** Entity types never contain a space, so the space is a safe separator. */
export function entityKey(type: EntityType, name: string): string {
  return `${type} ${name}`;
}

/**
 * Entity resolution v1: exact match on canonical name or alias within the book, same type only.
 * Unmatched names become new entities; two extracted entries that share a name within the
 * chapter collapse into one. Nothing here merges or splits known entities; that is the
 * consistency pass.
 */
export function resolveEntities(
  known: readonly KnownEntity[],
  extracted: readonly ExtractedEntity[],
): ResolvedEntities {
  const idByKey = new Map<string, string>();
  const knownById = new Map(known.map((k) => [k.id, k] as const));
  for (const k of known) entityNames(k).forEach((n) => idByKey.set(entityKey(k.type, n), k.id));

  const emitted = new Map<string, EntityIR>();
  for (const e of extracted) {
    const names = dedupe([e.name, ...e.aliases]).filter((n) => n.length > 0);
    if (names.length === 0) continue;
    const existingId = names.map((n) => idByKey.get(entityKey(e.type, n))).find((id) => id !== undefined);
    const id = existingId ?? newId('entity');
    names.forEach((n) => idByKey.set(entityKey(e.type, n), id));

    const knownEntity = knownById.get(id);
    const previous = emitted.get(id);
    const canonicalName = previous?.canonicalName ?? knownEntity?.canonicalName ?? e.name;
    const alreadyKnown = new Set(knownEntity === undefined ? [] : entityNames(knownEntity));
    const aliases = dedupe([...(previous?.aliases ?? []), ...names]).filter(
      (n) => n !== canonicalName && !alreadyKnown.has(n),
    );
    emitted.set(id, {
      id,
      type: e.type,
      canonicalName,
      aliases,
      isNew: knownEntity === undefined,
      confidence: Math.max(previous?.confidence ?? 0, e.confidence),
      ...(e.description === undefined ? {} : { description: e.description }),
    });
  }
  return { entities: [...emitted.values()], idByKey };
}

/** Speaker surfaces resolve against characters only. */
export function resolveSpeaker(resolved: ResolvedEntities, surface: string): string | undefined {
  return resolved.idByKey.get(entityKey('character', surface));
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()))];
}
