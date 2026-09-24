import { z } from 'zod';
import { EMOTION_TYPES, type EmotionIR, type EmotionType, type EntityType, isEntityType } from '@novelstruct/core';
import type { LlmClient } from '../llm/client.js';
import { QUOTE_EXTRACTION_VERSION } from '../quotes.js';
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
const MAX_PROVIDER_REJECTION_RETRIES = 1;
const MAX_INVALID_JSON_RETRIES = 1;

class LlmInvalidJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmInvalidJsonError';
  }
}

/** A provider declined to answer; there is no attribution to score for this chapter. */
export class LlmRequestRejectedError extends Error {
  constructor(readonly preview: string) {
    super(`LLM provider rejected the request: ${preview}`);
    this.name = 'LlmRequestRejectedError';
  }
}

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
    promptVersion: `${STRUCTURE_PROMPT_VERSION}+${QUOTE_EXTRACTION_VERSION}`,
    async attribute(input) {
      const user = buildStructureUserPrompt({
        paragraphs: input.paragraphs.map((p) => input.text.slice(p.charStart, p.charEnd)),
        quotes: input.quotes,
        knownEntities: input.knownEntities,
      });
      let rejectionRetries = 0;
      let jsonRetries = 0;
      for (;;) {
        const response = await client.completeJson({ system: STRUCTURE_SYSTEM_PROMPT, user });
        try {
          const output = parseOutput(response.content, response.finishReason);
          return {
            ...toResult(output, input),
            model: client.model,
            ...(response.usage === undefined ? {} : { usage: response.usage }),
          };
        } catch (error) {
          if (error instanceof LlmRequestRejectedError && rejectionRetries < MAX_PROVIDER_REJECTION_RETRIES) {
            rejectionRetries += 1;
            continue;
          }
          if (error instanceof LlmInvalidJsonError) {
            if (jsonRetries >= MAX_INVALID_JSON_RETRIES) {
              throw new LlmInvalidJsonError(
                `${error.message} (gave up after ${jsonRetries + 1} malformed JSON attempts)`,
              );
            }
            jsonRetries += 1;
            continue;
          }
          throw error;
        }
      }
    },
  };
}

function parseOutput(content: string, finishReason?: string): z.output<typeof OutputSchema> {
  const json = stripCodeFence(content);
  if (/^The request was rejected because it was considered high risk\b/i.test(json)) {
    throw new LlmRequestRejectedError(json.replace(/\s+/g, ' ').slice(0, 180));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    const preview = json.replace(/\s+/g, ' ').slice(0, 180);
    const message = error instanceof Error ? error.message : String(error);
    const positionText = /\bposition (\d+)\b/.exec(message)?.[1];
    const position =
      positionText === undefined ? (/Unexpected end/i.test(message) ? json.length : undefined) : Number(positionText);
    const nearby =
      position === undefined
        ? ''
        : `; near position ${position}: ${JSON.stringify(json.slice(Math.max(0, position - 60), position + 60))}`;
    const reason = finishReason === undefined ? '' : `; finish_reason: ${finishReason}`;
    throw new LlmInvalidJsonError(
      `LLM output is not JSON: ${message}; response length: ${json.length} characters${nearby}${reason}; response preview: ${preview}`,
    );
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
