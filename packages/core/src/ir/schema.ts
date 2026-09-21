import { z } from 'zod';
import { EMOTION_TYPES, ENTITY_TYPES, PARSE_PASSES, SEGMENT_KINDS } from '../domain.js';

export const IR_VERSION = '0.1';

const Confidence = z.number().min(0).max(1);
const Offset = z.number().int().nonnegative();
const Id = z.string().min(1);

const SpanSchema = z.object({
  charStart: Offset,
  charEnd: Offset,
});

export const SceneIRSchema = SpanSchema.extend({
  id: Id,
  index: z.number().int().nonnegative(),
  location: z.string().optional(),
  timeHint: z.string().optional(),
  summary: z.string().optional(),
  characterIds: z.array(Id).default([]),
});

export const SpeakerIRSchema = z
  .object({
    entityId: Id.optional(),
    surface: z.string().min(1).optional(),
    confidence: Confidence,
  })
  .refine((s) => s.entityId !== undefined || s.surface !== undefined, {
    message: 'speaker needs entityId or surface',
  });

export const EmotionIRSchema = z.object({
  type: z.enum(EMOTION_TYPES),
  intensity: Confidence,
});

export const SegmentIRSchema = SpanSchema.extend({
  id: Id,
  sceneId: Id,
  index: z.number().int().nonnegative(),
  kind: z.enum(SEGMENT_KINDS),
  speaker: SpeakerIRSchema.optional(),
  emotion: EmotionIRSchema.optional(),
});

export const EntityIRSchema = z.object({
  id: Id,
  type: z.enum(ENTITY_TYPES),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  description: z.string().optional(),
  isNew: z.boolean(),
  confidence: Confidence,
});

export const MentionIRSchema = SpanSchema.extend({
  entityId: Id,
  surface: z.string().min(1),
});

export const ProvenanceIRSchema = z.object({
  pass: z.enum(PARSE_PASSES),
  attributor: z.string().min(1),
  model: z.string().optional(),
  promptVersion: z.string().min(1),
  normalizerVersion: z.string().min(1),
  parseRunId: Id.optional(),
});

export const ChapterIRSchema = z.object({
  irVersion: z.literal(IR_VERSION),
  bookId: Id,
  editionId: Id,
  chapterId: Id,
  charCount: Offset,
  scenes: z.array(SceneIRSchema),
  segments: z.array(SegmentIRSchema),
  entities: z.array(EntityIRSchema),
  mentions: z.array(MentionIRSchema),
  provenance: ProvenanceIRSchema,
});

export type SceneIR = z.output<typeof SceneIRSchema>;
export type SpeakerIR = z.output<typeof SpeakerIRSchema>;
export type EmotionIR = z.output<typeof EmotionIRSchema>;
export type SegmentIR = z.output<typeof SegmentIRSchema>;
export type EntityIR = z.output<typeof EntityIRSchema>;
export type MentionIR = z.output<typeof MentionIRSchema>;
export type ProvenanceIR = z.output<typeof ProvenanceIRSchema>;
export type ChapterIR = z.output<typeof ChapterIRSchema>;
/** Shape accepted by `ChapterIRSchema.parse`; defaulted fields are optional here. */
export type ChapterIRInput = z.input<typeof ChapterIRSchema>;
