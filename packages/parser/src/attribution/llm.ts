import { z } from 'zod';
import { EMOTION_TYPES, type EmotionIR, type EmotionType, type EntityType, isEntityType } from '@novelstruct/core';
import type { LlmClient } from '../llm/client.js';
import {
  buildStructureUserPrompt,
  STRUCTURE_PROMPT_VERSION,
  STRUCTURE_SYSTEM_PROMPT,
} from '../prompts/structure-pass.js';
import type {
  AttributionInput,
  AttributionResult,
  ExtractedEntity,
  QuoteAttribution,
  SpeakerAttributor,
} from './types.js';

const Unit = z.number().min(0).max(1);
const DEFAULT_CONFIDENCE = 0.5;
const DEFAULT_EMOTION_INTENSITY = 0.5;

/**
 * One boundary policy for model output: a missing or null optional field takes its default,
 * an unparsable enum takes its default, and ids are coerced to strings. Structural breakage
 * (a quote that is not an object, a scene without paragraph numbers) still fails the chapter.
 */
const OutputSchema = z.object({
  quotes: z
    .array(
      z.object({
        id: z.coerce.string(),
        speaker: z.string().nullish(),
        kind: z.enum(['dialogue', 'thought']).catch('dialogue'),
        confidence: Unit.catch(DEFAULT_CONFIDENCE),
        emotion: z.string().nullish(),
        intensity: Unit.nullish().catch(null),
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string().nullish(),
        aliases: z
          .array(z.string())
          .nullish()
          .transform((v) => v ?? []),
        confidence: Unit.catch(DEFAULT_CONFIDENCE),
        description: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
  scenes: z
    .array(
      z.object({
        startParagraph: z.number().int().nonnegative(),
        endParagraph: z.number().int().nonnegative(),
        location: z.string().nullish(),
        timeHint: z.string().nullish(),
        summary: z.string().nullish(),
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
});

/** Common ways a model names an entity type in Chinese or English, mapped to the closed vocabulary. */
const ENTITY_TYPE_SYNONYMS: Readonly<Record<string, EntityType>> = {
  人物: 'character',
  角色: 'character',
  人: 'character',
  person: 'character',
  people: 'character',
  char: 'character',
  地点: 'location',
  地名: 'location',
  场所: 'location',
  地方: 'location',
  place: 'location',
  组织: 'organization',
  势力: 'organization',
  宗门: 'organization',
  门派: 'organization',
  org: 'organization',
  物品: 'item',
  道具: 'item',
  武器: 'item',
  object: 'item',
  技能: 'skill',
  功法: 'skill',
  招式: 'skill',
  ability: 'skill',
  境界: 'realm',
  等级: 'realm',
  level: 'realm',
  种族: 'species',
  race: 'species',
  概念: 'concept',
  术语: 'concept',
  事件: 'event',
};

/** Structure-pass attributor backed by any OpenAI-compatible chat model. */
export function createLlmAttributor(client: LlmClient): SpeakerAttributor {
  return {
    name: 'llm',
    promptVersion: STRUCTURE_PROMPT_VERSION,
    async attribute(input) {
      const user = buildStructureUserPrompt({
        paragraphs: input.paragraphs.map((p) => input.text.slice(p.charStart, p.charEnd)),
        quotes: input.quotes,
        knownEntities: input.knownEntities,
      });
      const response = await client.completeJson({ system: STRUCTURE_SYSTEM_PROMPT, user });
      const output = parseOutput(response.content);
      return {
        ...toResult(output, input),
        model: client.model,
        ...(response.usage === undefined ? {} : { usage: response.usage }),
      };
    },
  };
}

function parseOutput(content: string): z.output<typeof OutputSchema> {
  const json = stripCodeFence(content);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`LLM output is not JSON: ${(error as Error).message}`);
  }
  const parsed = OutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`LLM output failed schema validation: ${parsed.error.message}`);
  return parsed.data;
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function toResult(
  output: z.output<typeof OutputSchema>,
  input: AttributionInput,
): Omit<AttributionResult, 'model' | 'usage'> {
  const quoteIds = new Set(input.quotes.map((q) => q.id));
  const warnings: string[] = [];
  const attributions: QuoteAttribution[] = [];
  for (const q of output.quotes) {
    if (!quoteIds.has(q.id)) {
      warnings.push(`llm returned unknown quote id ${q.id}`);
      continue;
    }
    const emotion = toEmotion(q.emotion ?? undefined, q.intensity ?? undefined);
    const surface = q.speaker?.trim();
    attributions.push({
      quoteId: q.id,
      kind: q.kind,
      confidence: surface ? q.confidence : 0,
      ...(surface ? { speakerSurface: surface } : {}),
      ...(emotion === undefined ? {} : { emotion }),
    });
  }
  const missing = input.quotes.filter((q) => !attributions.some((a) => a.quoteId === q.id));
  if (missing.length > 0) warnings.push(`llm left ${missing.length} quotes unattributed`);

  const entities: ExtractedEntity[] = [];
  for (const e of output.entities) {
    const type = normalizeEntityType(e.type);
    if (type === undefined) {
      warnings.push(`llm entity ${e.name} has unknown type ${String(e.type)}, skipped`);
      continue;
    }
    entities.push({
      type,
      name: e.name.trim(),
      aliases: e.aliases.map((a) => a.trim()).filter((a) => a.length > 0),
      confidence: e.confidence,
      ...(e.description ? { description: e.description } : {}),
    });
  }

  return {
    attributions,
    entities,
    scenes: output.scenes.map((s) => ({
      startParagraph: s.startParagraph,
      endParagraph: s.endParagraph,
      ...(s.location ? { location: s.location } : {}),
      ...(s.timeHint ? { timeHint: s.timeHint } : {}),
      ...(s.summary ? { summary: s.summary } : {}),
    })),
    warnings,
  };
}

export function normalizeEntityType(raw: string | null | undefined): EntityType | undefined {
  const key = raw?.trim().toLowerCase() ?? '';
  if (key.length === 0) return undefined;
  return isEntityType(key) ? key : ENTITY_TYPE_SYNONYMS[key];
}

function toEmotion(type: string | undefined, intensity: number | undefined): EmotionIR | undefined {
  if (type === undefined || !(EMOTION_TYPES as readonly string[]).includes(type)) return undefined;
  return { type: type as EmotionType, intensity: intensity ?? DEFAULT_EMOTION_INTENSITY };
}
