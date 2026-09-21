/**
 * Closed vocabularies shared by the IR schema, the database enums and the parser prompts.
 * Adding a value here is a schema change: bump IR_VERSION and add a migration.
 */

/** `note` is an author's note between chapters (请假、上架感言), not story text. */
export const CHAPTER_KINDS = ['chapter', 'prologue', 'extra', 'front_matter', 'note'] as const;
export type ChapterKind = (typeof CHAPTER_KINDS)[number];

export const ENTITY_TYPES = [
  'character',
  'location',
  'organization',
  'item',
  'skill',
  'realm',
  'species',
  'concept',
  'event',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_STATUSES = ['active', 'merged'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const SEGMENT_KINDS = ['narration', 'dialogue', 'thought'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const EMOTION_TYPES = [
  'calm',
  'happy',
  'angry',
  'sad',
  'fear',
  'surprise',
  'teasing',
  'contempt',
  'anxious',
  'tender',
  'cold',
  'excited',
] as const;
export type EmotionType = (typeof EMOTION_TYPES)[number];

export const PARSE_PASSES = ['structure', 'consistency'] as const;
export type ParsePass = (typeof PARSE_PASSES)[number];

export const PARSE_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type ParseRunStatus = (typeof PARSE_RUN_STATUSES)[number];

/** Surface stored when no attributor could name the speaker. Never resolves to an entity. */
export const UNKNOWN_SPEAKER_SURFACE = '[unknown]';

/** An entity already in the fact layer, as the parser sees it. */
export interface KnownEntity {
  readonly id: string;
  readonly type: EntityType;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
}

/** Every surface an entity can be referred to by: canonical name first, then aliases. */
export function entityNames(entity: Pick<KnownEntity, 'canonicalName' | 'aliases'>): string[] {
  return [entity.canonicalName, ...entity.aliases];
}

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}
