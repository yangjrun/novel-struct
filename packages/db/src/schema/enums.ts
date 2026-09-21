import { pgEnum } from 'drizzle-orm/pg-core';
import {
  CHAPTER_KINDS,
  ENTITY_STATUSES,
  ENTITY_TYPES,
  PARSE_PASSES,
  PARSE_RUN_STATUSES,
  SEGMENT_KINDS,
} from '@novelstruct/core';

export const chapterKindEnum = pgEnum('chapter_kind', CHAPTER_KINDS);
export const entityTypeEnum = pgEnum('entity_type', ENTITY_TYPES);
export const entityStatusEnum = pgEnum('entity_status', ENTITY_STATUSES);
export const segmentKindEnum = pgEnum('segment_kind', SEGMENT_KINDS);
export const parsePassEnum = pgEnum('parse_pass', PARSE_PASSES);
export const parseRunStatusEnum = pgEnum('parse_run_status', PARSE_RUN_STATUSES);
