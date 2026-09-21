import type { EmotionIR, EntityType, KnownEntity } from '@novelstruct/core';
import type { NormalizedParagraph } from '@novelstruct/ingest';
import type { QuoteSpan } from '../quotes.js';

export interface QuoteAttribution {
  readonly quoteId: string;
  readonly kind: 'dialogue' | 'thought';
  /** Speaker as named in or near the text. Undefined when the attributor could not tell. */
  readonly speakerSurface?: string;
  readonly confidence: number;
  readonly emotion?: EmotionIR;
}

export interface ExtractedEntity {
  readonly type: EntityType;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly confidence: number;
  readonly description?: string;
}

/** Inclusive paragraph range; consecutive proposals must tile the chapter. */
export interface SceneProposal {
  readonly startParagraph: number;
  readonly endParagraph: number;
  readonly location?: string;
  readonly timeHint?: string;
  readonly summary?: string;
}

export interface AttributionInput {
  readonly text: string;
  readonly paragraphs: readonly NormalizedParagraph[];
  readonly quotes: readonly QuoteSpan[];
  readonly knownEntities: readonly KnownEntity[];
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AttributionResult {
  readonly attributions: readonly QuoteAttribution[];
  readonly entities: readonly ExtractedEntity[];
  readonly scenes: readonly SceneProposal[];
  readonly warnings: readonly string[];
  readonly usage?: LlmUsage;
  readonly model?: string;
}

/** The only LLM-facing step of the structure pass. Everything else is deterministic. */
export interface SpeakerAttributor {
  readonly name: string;
  readonly promptVersion: string;
  attribute(input: AttributionInput): Promise<AttributionResult>;
}
