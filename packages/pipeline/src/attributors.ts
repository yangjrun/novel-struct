import {
  createHeuristicAttributor,
  createLlmAttributor,
  createOpenAICompatibleClient,
  type SpeakerAttributor,
} from '@novelstruct/parser';
import type { LlmEnv } from './env.js';
import { PipelineError } from './errors.js';

export const ATTRIBUTOR_NAMES = ['heuristic', 'llm'] as const;
export type AttributorName = (typeof ATTRIBUTOR_NAMES)[number];

export interface AttributorChoice {
  readonly attributor: SpeakerAttributor;
  readonly model?: string;
}

export function isAttributorName(value: string): value is AttributorName {
  return (ATTRIBUTOR_NAMES as readonly string[]).includes(value);
}

/** Builds the attributor by name; `llm` needs a configured model or it fails with `not_configured`. */
export function chooseAttributor(name: AttributorName, llm: LlmEnv | undefined): AttributorChoice {
  if (name === 'heuristic') return { attributor: createHeuristicAttributor() };
  if (llm === undefined) {
    throw new PipelineError(
      'not_configured',
      'LLM 归属器需要在 .env 或环境变量中设置 LLM_API_KEY 和 LLM_MODEL，可选 LLM_BASE_URL',
    );
  }
  return { attributor: createLlmAttributor(createOpenAICompatibleClient(llm)), model: llm.model };
}
