export { extractQuotes, type QuoteExtraction, type QuoteSpan } from './quotes.js';
export type {
  AttributionInput,
  AttributionResult,
  ExtractedEntity,
  LlmUsage,
  QuoteAttribution,
  SceneProposal,
  SpeakerAttributor,
} from './attribution/types.js';
export { createHeuristicAttributor, HEURISTIC_PROMPT_VERSION } from './attribution/heuristic.js';
export { createLlmAttributor } from './attribution/llm.js';
export { STRUCTURE_PROMPT_VERSION } from './prompts/structure-pass.js';
export {
  createOpenAICompatibleClient,
  createFakeLlmClient,
  type LlmClient,
  type LlmJsonRequest,
  type LlmJsonResponse,
} from './llm/client.js';
export { resolveEntities, resolveSpeaker, type ResolvedEntities } from './entity-resolver.js';
export { findMentions } from './mentions.js';
export { runStructurePass, type StructurePassInput, type StructurePassResult } from './structure-pass.js';
