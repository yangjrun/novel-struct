import { PipelineError } from './errors.js';

export interface LlmEnv {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface AppEnv {
  readonly databaseUrl?: string;
  readonly dataDir?: string;
  readonly llm?: LlmEnv;
}

const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';

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
  const apiKey = nonEmpty(env['LLM_API_KEY']);
  const model = nonEmpty(env['LLM_MODEL']);
  return {
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(apiKey === undefined || model === undefined
      ? {}
      : { llm: { baseUrl: nonEmpty(env['LLM_BASE_URL']) ?? DEFAULT_LLM_BASE_URL, apiKey, model } }),
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

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
