import { PipelineError } from './errors.js';

export interface LlmEnv {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Longest silence before the first byte or between two streamed chunks; that attempt is retried. */
  readonly idleTimeoutMs?: number;
  /** Hard cap on one attempt; not retried. */
  readonly totalTimeoutMs?: number;
  /** False when the server cannot stream server-sent events. */
  readonly stream?: boolean;
  readonly maxTokens?: number;
}

export interface ShadowEnv {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

/** Prices per million tokens, in whatever currency the operator bills in. Display only; never converted. */
export interface LlmPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly currency: string;
}

export interface AppEnv {
  readonly databaseUrl?: string;
  readonly dataDir?: string;
  readonly llm?: LlmEnv;
  readonly shadow?: ShadowEnv;
  readonly pricing?: LlmPricing;
}

const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_SHADOW_BASE_URL = 'https://api.typesafe.ai/v1';
const DEFAULT_PRICE_CURRENCY = 'USD';
const FALSE_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off']);

/** Reads .env from the working directory when present, then the process environment. */
export function loadEnv(): AppEnv {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env file; rely on the process environment
  }
  const env = process.env;
  const databaseUrl = nonEmpty(env['DATABASE_URL']);
  const dataDir = nonEmpty(env['NOVELSTRUCT_DATA_DIR']);
  const llm = parseLlmEnv(env);
  const shadow = parseShadowEnv(env);
  const pricing = parsePricingEnv(env);
  return {
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(llm === undefined ? {} : { llm }),
    ...(shadow === undefined ? {} : { shadow }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

export function parseShadowEnv(env: Readonly<Record<string, string | undefined>>): ShadowEnv | undefined {
  const apiKey = nonEmpty(env['TYPESAFE_API_KEY']);
  if (apiKey === undefined) return undefined;
  return {
    apiKey,
    baseUrl: nonEmpty(env['TYPESAFE_BASE_URL']) ?? DEFAULT_SHADOW_BASE_URL,
    model: nonEmpty(env['TYPESAFE_MODEL']) ?? 'jev-1.13.0',
  };
}

/**
 * LLM settings from environment-shaped input. Undefined until both LLM_API_KEY and LLM_MODEL are
 * set; the tuning variables are validated so a typo fails here instead of as a silent default.
 */
export function parseLlmEnv(env: Readonly<Record<string, string | undefined>>): LlmEnv | undefined {
  const apiKey = nonEmpty(env['LLM_API_KEY']);
  const model = nonEmpty(env['LLM_MODEL']);
  if (apiKey === undefined || model === undefined) return undefined;
  const idleTimeoutMs = positiveInt(env, 'LLM_IDLE_TIMEOUT_MS');
  const totalTimeoutMs = positiveInt(env, 'LLM_TIMEOUT_MS');
  const maxTokens = positiveInt(env, 'LLM_MAX_TOKENS');
  const stream = nonEmpty(env['LLM_STREAM']);
  return {
    baseUrl: nonEmpty(env['LLM_BASE_URL']) ?? DEFAULT_LLM_BASE_URL,
    apiKey,
    model,
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    ...(totalTimeoutMs === undefined ? {} : { totalTimeoutMs }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(stream !== undefined && FALSE_VALUES.has(stream.toLowerCase()) ? { stream: false } : {}),
  };
}

/**
 * Token prices from LLM_PRICE_INPUT and LLM_PRICE_OUTPUT (per million tokens) plus the
 * LLM_PRICE_CURRENCY label. Undefined until both prices are set; a lone price is an error.
 */
export function parsePricingEnv(env: Readonly<Record<string, string | undefined>>): LlmPricing | undefined {
  const inputPerMillion = nonNegativeNumber(env, 'LLM_PRICE_INPUT');
  const outputPerMillion = nonNegativeNumber(env, 'LLM_PRICE_OUTPUT');
  if (inputPerMillion === undefined && outputPerMillion === undefined) return undefined;
  if (inputPerMillion === undefined || outputPerMillion === undefined) {
    throw new PipelineError(
      'invalid_input',
      'LLM_PRICE_INPUT 和 LLM_PRICE_OUTPUT 要同时设置，单位是每百万 token 的价格',
    );
  }
  return {
    inputPerMillion,
    outputPerMillion,
    currency: nonEmpty(env['LLM_PRICE_CURRENCY']) ?? DEFAULT_PRICE_CURRENCY,
  };
}

export function requireLlm(env: AppEnv): LlmEnv {
  if (env.llm === undefined) {
    throw new PipelineError(
      'not_configured',
      'LLM 归属器需要在 .env 或环境变量中设置 LLM_API_KEY 和 LLM_MODEL，可选 LLM_BASE_URL',
    );
  }
  return env.llm;
}

function positiveInt(env: Readonly<Record<string, string | undefined>>, name: string): number | undefined {
  const raw = nonEmpty(env[name]);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new PipelineError('invalid_input', `${name} 必须是正整数，收到 ${raw}`);
  }
  return value;
}

function nonNegativeNumber(env: Readonly<Record<string, string | undefined>>, name: string): number | undefined {
  const raw = nonEmpty(env[name]);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new PipelineError('invalid_input', `${name} 必须是非负数字，收到 ${raw}`);
  }
  return value;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
