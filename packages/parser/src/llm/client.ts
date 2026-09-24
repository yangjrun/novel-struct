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
  /** Provider stop reason, when supplied (e.g. `length` means the output was truncated). */
  readonly finishReason?: string;
}

/** Minimal chat client. Implementations must return the assistant's text; parsing happens upstream. */
export interface LlmClient {
  readonly model: string;
  completeJson(request: LlmJsonRequest): Promise<LlmJsonResponse>;
}

/** The slice of `fetch` this client uses, so tests and proxy-aware wrappers can substitute their own. */
export interface FetchInit {
  readonly method: 'POST';
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

export interface OpenAICompatibleOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Send response_format json_object. Disable for servers that reject it. Default true. */
  readonly jsonMode?: boolean;
  /**
   * Ask for server-sent events and reassemble them locally. Keeps bytes flowing while a slow
   * model generates, so the idle timeout can tell "still thinking" from "connection dead".
   * Disable for servers without SSE support. Default true.
   */
  readonly stream?: boolean;
  /** Cap on the model's output tokens. Unset leaves the server default. */
  readonly maxTokens?: number;
  /** Longest silence tolerated before the first byte or between two chunks. Retried. Default 120 s. */
  readonly idleTimeoutMs?: number;
  /** Hard cap on one attempt. Not retried: a model this slow will not get faster. Default 15 min. */
  readonly totalTimeoutMs?: number;
  /** Retries after a stall, a network error or a retryable status. Default 2. */
  readonly maxRetries?: number;
  readonly fetchImpl?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
}

const UsageSchema = z
  .object({
    prompt_tokens: z.number().nonnegative().nullish(),
    completion_tokens: z.number().nonnegative().nullish(),
  })
  .nullish();

const ChatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullish() }))
    .min(1),
  usage: UsageSchema,
});

const ContentDelta = z.object({ content: z.string().nullish() }).nullish();

/** One SSE chunk. `message` covers servers that send the whole message in the last chunk. */
const StreamChunkSchema = z.object({
  choices: z
    .array(z.object({ delta: ContentDelta, message: ContentDelta, finish_reason: z.string().nullish() }))
    .nullish(),
  usage: UsageSchema,
  error: z.looseObject({ message: z.string().nullish() }).nullish(),
});

const DEFAULT_TEMPERATURE = 0;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const ERROR_BODY_PREVIEW = 500;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const SSE_DONE = '[DONE]';

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

class LlmTimeoutError extends Error {
  constructor(
    readonly kind: 'idle' | 'total',
    readonly ms: number,
  ) {
    super(kind === 'idle' ? `no data for ${ms} ms` : `exceeded ${ms} ms`);
    this.name = 'LlmTimeoutError';
  }
}

export function createOpenAICompatibleClient(options: OpenAICompatibleOptions): LlmClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const stream = options.stream !== false;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const attempt = async (request: LlmJsonRequest): Promise<LlmJsonResponse> => {
    const deadline = startDeadline(idleTimeoutMs, totalTimeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(requestBody(options, request, stream)),
        signal: deadline.signal,
      }).catch((error: unknown) => {
        throw transportFailure(error, deadline);
      });
      if (!response.ok) {
        const detail = await readBody(response, deadline).catch(() => '');
        const message = `LLM request failed with ${response.status}: ${detail.slice(0, ERROR_BODY_PREVIEW)}`;
        throw RETRYABLE_STATUSES.has(response.status) ? new RetryableError(message) : new Error(message);
      }
      const text = await readBody(response, deadline).catch((error: unknown) => {
        throw transportFailure(error, deadline);
      });
      return stream ? parseStreamedCompletion(text) : parseCompletion(parseJson(text, 'LLM response'));
    } finally {
      deadline.clear();
    }
  };

  return {
    model: options.model,
    async completeJson(request) {
      for (let tries = 0; ; tries += 1) {
        try {
          return await attempt(request);
        } catch (error) {
          if (!(error instanceof RetryableError) || tries >= maxRetries) throw withAttempts(error, tries + 1);
          await sleep(BACKOFF_BASE_MS * 2 ** tries);
        }
      }
    },
  };
}

function requestBody(
  options: OpenAICompatibleOptions,
  request: LlmJsonRequest,
  stream: boolean,
): Record<string, unknown> {
  return {
    model: options.model,
    temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    ...(options.jsonMode === false ? {} : { response_format: { type: 'json_object' } }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  };
}

interface Deadline {
  readonly signal: AbortSignal;
  /** Call whenever data arrives; restarts the idle timer. */
  touch(): void;
  clear(): void;
}

/** One AbortSignal driven by two timers: idle (restarted on every chunk) and total (fixed). */
function startDeadline(idleMs: number, totalMs: number): Deadline {
  const controller = new AbortController();
  const arm = (): NodeJS.Timeout => setTimeout(() => controller.abort(new LlmTimeoutError('idle', idleMs)), idleMs);
  const total = setTimeout(() => controller.abort(new LlmTimeoutError('total', totalMs)), totalMs);
  let idle = arm();
  return {
    signal: controller.signal,
    touch() {
      clearTimeout(idle);
      idle = arm();
    },
    clear() {
      clearTimeout(idle);
      clearTimeout(total);
    },
  };
}

/**
 * Reads the whole body, touching the deadline on every chunk. Races each read against the
 * abort signal so the timers work even when the fetch implementation ignores `signal`.
 */
async function readBody(response: FetchResponseLike, deadline: Deadline): Promise<string> {
  if (response.body === null) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const aborted = new Promise<never>((_, reject) => {
    const fail = (): void => reject(deadline.signal.reason);
    if (deadline.signal.aborted) fail();
    else deadline.signal.addEventListener('abort', fail, { once: true });
  });
  aborted.catch(() => undefined);

  const parts: string[] = [];
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      deadline.touch();
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  parts.push(decoder.decode());
  return parts.join('');
}

function transportFailure(error: unknown, deadline: Deadline): Error {
  const reason: unknown = deadline.signal.aborted ? deadline.signal.reason : undefined;
  if (reason instanceof LlmTimeoutError) {
    return reason.kind === 'idle'
      ? new RetryableError(
          `LLM request stalled: ${reason.message} (raise LLM_IDLE_TIMEOUT_MS if the server is just slow)`,
        )
      : new Error(`LLM request ${reason.message} (LLM_TIMEOUT_MS); the model is too slow for this chapter`);
  }
  return new RetryableError(`LLM request did not complete: ${describe(error)}`);
}

function withAttempts(error: unknown, attempts: number): unknown {
  if (attempts <= 1 || !(error instanceof Error)) return error;
  return new Error(`${error.message} (gave up after ${attempts} attempts)`);
}

/** Reassembles an SSE chat completion. Falls back to a plain completion when the server ignored `stream`. */
export function parseStreamedCompletion(text: string): LlmJsonResponse {
  const events = sseDataEvents(text);
  if (events.length === 0) return parseCompletion(parseJson(text, 'LLM response'));

  const parts: string[] = [];
  let usage: LlmUsage | undefined;
  let finishReason: string | undefined;
  for (const data of events) {
    if (data === SSE_DONE) break;
    const chunk = StreamChunkSchema.safeParse(parseJson(data, 'LLM stream chunk'));
    if (!chunk.success) throw new Error(`LLM stream chunk has unexpected shape: ${chunk.error.message}`);
    if (chunk.data.error) {
      throw new Error(`LLM stream reported an error: ${chunk.data.error.message ?? JSON.stringify(chunk.data.error)}`);
    }
    for (const choice of chunk.data.choices ?? []) {
      const piece = choice.delta?.content ?? choice.message?.content;
      if (piece) parts.push(piece);
      finishReason = choice.finish_reason ?? finishReason;
    }
    usage = toUsage(chunk.data.usage) ?? usage;
  }
  const content = parts.join('');
  if (content.length === 0) throw new Error('LLM response has no content');
  return {
    content,
    ...(usage === undefined ? {} : { usage }),
    ...(finishReason === undefined ? {} : { finishReason }),
  };
}

/** `data:` payloads of an SSE body, one string per event; comments and other fields are dropped. */
function sseDataEvents(text: string): string[] {
  const events: string[] = [];
  let pending: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      if (pending.length > 0) events.push(pending.join('\n'));
      pending = [];
    } else if (line.startsWith('data:')) {
      pending.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (pending.length > 0) events.push(pending.join('\n'));
  return events;
}

function parseCompletion(json: unknown): LlmJsonResponse {
  const parsed = ChatCompletionSchema.safeParse(json);
  if (!parsed.success) throw new Error(`LLM response has unexpected shape: ${parsed.error.message}`);
  const content = parsed.data.choices[0]?.message.content;
  if (content === null || content === undefined) throw new Error('LLM response has no content');
  const usage = toUsage(parsed.data.usage);
  const finishReason = parsed.data.choices[0]?.finish_reason ?? undefined;
  return {
    content,
    ...(usage === undefined ? {} : { usage }),
    ...(finishReason === undefined ? {} : { finishReason }),
  };
}

function toUsage(usage: z.output<typeof UsageSchema>): LlmUsage | undefined {
  const inputTokens = usage?.prompt_tokens;
  const outputTokens = usage?.completion_tokens;
  return typeof inputTokens === 'number' && typeof outputTokens === 'number'
    ? { inputTokens, outputTokens }
    : undefined;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} is not JSON: ${describe(error)}`);
  }
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
