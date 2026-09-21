import { z } from 'zod';
import type { LlmUsage } from '../attribution/types.js';

export interface LlmJsonRequest {
  readonly system: string;
  readonly user: string;
  readonly temperature?: number;
}

export interface LlmJsonResponse {
  readonly content: string;
  readonly usage?: LlmUsage;
}

/** Minimal chat client. Implementations must return the assistant's text; parsing happens upstream. */
export interface LlmClient {
  readonly model: string;
  completeJson(request: LlmJsonRequest): Promise<LlmJsonResponse>;
}

export interface OpenAICompatibleOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Send response_format json_object. Disable for servers that reject it. Default true. */
  readonly jsonMode?: boolean;
  /** Per-attempt timeout. Default 120 s. */
  readonly timeoutMs?: number;
  /** Retries after a timeout, a network error or a retryable status. Default 2. */
  readonly maxRetries?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

const ChatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().nullish(),
      completion_tokens: z.number().nonnegative().nullish(),
    })
    .nullish(),
});

const DEFAULT_TEMPERATURE = 0;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export function createOpenAICompatibleClient(options: OpenAICompatibleOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const attempt = async (request: LlmJsonRequest): Promise<LlmJsonResponse> => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(body(options, request)),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => {
      throw new RetryableError(`LLM request did not complete: ${describe(error)}`);
    });
    if (!response.ok) {
      const message = `LLM request failed with ${response.status}: ${(await response.text()).slice(0, 500)}`;
      throw RETRYABLE_STATUSES.has(response.status) ? new RetryableError(message) : new Error(message);
    }
    return parseCompletion(await response.json());
  };

  return {
    model: options.model,
    async completeJson(request) {
      for (let tries = 0; ; tries += 1) {
        try {
          return await attempt(request);
        } catch (error) {
          if (!(error instanceof RetryableError) || tries >= maxRetries) throw error;
          await sleep(BACKOFF_BASE_MS * 2 ** tries);
        }
      }
    },
  };
}

function body(options: OpenAICompatibleOptions, request: LlmJsonRequest): Record<string, unknown> {
  return {
    model: options.model,
    temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    ...(options.jsonMode === false ? {} : { response_format: { type: 'json_object' } }),
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  };
}

function parseCompletion(json: unknown): LlmJsonResponse {
  const parsed = ChatCompletionSchema.safeParse(json);
  if (!parsed.success) throw new Error(`LLM response has unexpected shape: ${parsed.error.message}`);
  const content = parsed.data.choices[0]?.message.content;
  if (content === null || content === undefined) throw new Error('LLM response has no content');
  const usage = parsed.data.usage;
  const inputTokens = usage?.prompt_tokens;
  const outputTokens = usage?.completion_tokens;
  return typeof inputTokens === 'number' && typeof outputTokens === 'number'
    ? { content, usage: { inputTokens, outputTokens } }
    : { content };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Test double that returns canned content and records the requests it received. */
export function createFakeLlmClient(
  content: string,
  model = 'fake',
): LlmClient & { readonly requests: readonly LlmJsonRequest[] } {
  const requests: LlmJsonRequest[] = [];
  return {
    model,
    requests,
    async completeJson(request) {
      requests.push(request);
      return { content, usage: { inputTokens: request.user.length, outputTokens: content.length } };
    },
  };
}
