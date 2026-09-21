import { describe, expect, it } from 'vitest';
import { createOpenAICompatibleClient, type FetchLike, parseStreamedCompletion } from '../src/index.js';

type FetchCall = { readonly url: string; readonly body: Record<string, unknown> };

function fakeFetch(responses: readonly (Response | Error)[]): { fetch: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    const next = queue.shift();
    if (next === undefined) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: impl, calls };
}

const ok = (content: string, usage?: unknown): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });

const sse = (...events: string[]): Response =>
  new Response(events.map((e) => `data: ${e}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });

/** A body that emits `chunks` on a timer and then stays open until cancelled. */
function trickle(chunks: readonly string[], everyMs: number): Response {
  let timer: NodeJS.Timeout | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pending = [...chunks];
      timer = setInterval(() => {
        const next = pending.shift();
        if (next !== undefined) controller.enqueue(new TextEncoder().encode(next));
      }, everyMs);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, { status: 200 });
}

const client = (fetchImpl: FetchLike, overrides: Partial<Parameters<typeof createOpenAICompatibleClient>[0]> = {}) =>
  createOpenAICompatibleClient({
    baseUrl: 'https://llm.example/v1/',
    apiKey: 'k',
    model: 'm',
    fetchImpl,
    maxRetries: 2,
    sleep: async () => {},
    ...overrides,
  });

describe('createOpenAICompatibleClient', () => {
  it('posts a streamed chat completion in json mode and returns content with usage', async () => {
    const { fetch, calls } = fakeFetch([ok('{"a":1}', { prompt_tokens: 12, completion_tokens: 3 })]);
    const result = await client(fetch).completeJson({ system: 's', user: 'u' });
    expect(result).toEqual({ content: '{"a":1}', usage: { inputTokens: 12, outputTokens: 3 } });
    expect(calls[0]?.url).toBe('https://llm.example/v1/chat/completions');
    expect(calls[0]?.body).toMatchObject({
      model: 'm',
      temperature: 0,
      response_format: { type: 'json_object' },
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('can be told not to stream and to cap output tokens', async () => {
    const { fetch, calls } = fakeFetch([ok('x')]);
    await client(fetch, { stream: false, maxTokens: 4096 }).completeJson({ system: 's', user: 'u' });
    expect(calls[0]?.body).not.toHaveProperty('stream');
    expect(calls[0]?.body).toMatchObject({ max_tokens: 4096 });
  });

  it('reassembles server-sent events, taking usage from the final chunk', async () => {
    const { fetch } = fakeFetch([
      sse(
        '{"choices":[{"delta":{"role":"assistant","content":""}}]}',
        '{"choices":[{"delta":{"content":"{\\"a\\""}}]}',
        '{"choices":[{"delta":{"content":":1}"}}]}',
        '{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}',
        '[DONE]',
      ),
    ]);
    expect(await client(fetch).completeJson({ system: 's', user: 'u' })).toEqual({
      content: '{"a":1}',
      usage: { inputTokens: 7, outputTokens: 2 },
    });
  });

  it('tolerates missing or null usage', async () => {
    const { fetch } = fakeFetch([ok('x', null)]);
    expect(await client(fetch).completeJson({ system: 's', user: 'u' })).toEqual({ content: 'x' });
  });

  it('retries retryable statuses and network errors, then succeeds', async () => {
    const { fetch, calls } = fakeFetch([
      new Response('busy', { status: 503 }),
      new TypeError('fetch failed'),
      ok('done'),
    ]);
    expect(await client(fetch).completeJson({ system: 's', user: 'u' })).toEqual({ content: 'done' });
    expect(calls).toHaveLength(3);
  });

  it('gives up after maxRetries and says how many attempts it made', async () => {
    const { fetch, calls } = fakeFetch([new Response('busy', { status: 429 }), new Response('busy', { status: 429 })]);
    await expect(client(fetch, { maxRetries: 1 }).completeJson({ system: 's', user: 'u' })).rejects.toThrow(
      /429.*gave up after 2 attempts/,
    );
    expect(calls).toHaveLength(2);
  });

  it('does not retry client errors', async () => {
    const { fetch, calls } = fakeFetch([new Response('bad key', { status: 401 })]);
    await expect(client(fetch).completeJson({ system: 's', user: 'u' })).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });

  it('rejects a response without content', async () => {
    const { fetch } = fakeFetch([ok(null as unknown as string)]);
    await expect(client(fetch).completeJson({ system: 's', user: 'u' })).rejects.toThrow(/no content/);
  });

  it('treats a stalled body as retryable and reports the stall', async () => {
    const { fetch, calls } = fakeFetch([trickle(['data: {"choices":[]}\n\n'], 5), trickle([], 5)]);
    await expect(
      client(fetch, { idleTimeoutMs: 40, maxRetries: 1 }).completeJson({ system: 's', user: 'u' }),
    ).rejects.toThrow(/stalled.*no data for 40 ms.*gave up after 2 attempts/);
    expect(calls).toHaveLength(2);
  });

  it('does not retry when the total budget runs out while data is still flowing', async () => {
    const forever = Array.from({ length: 1000 }, () => ': keep-alive\n\n');
    const { fetch, calls } = fakeFetch([trickle(forever, 5)]);
    await expect(
      client(fetch, { idleTimeoutMs: 1000, totalTimeoutMs: 60 }).completeJson({ system: 's', user: 'u' }),
    ).rejects.toThrow(/exceeded 60 ms/);
    expect(calls).toHaveLength(1);
  });
});

describe('parseStreamedCompletion', () => {
  it('joins deltas across events, ignoring comments and CRLF line endings', () => {
    const text =
      ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"b"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    expect(parseStreamedCompletion(text)).toEqual({ content: 'ab' });
  });

  it('accepts a whole message in the last chunk', () => {
    expect(parseStreamedCompletion('data: {"choices":[{"message":{"content":"whole"}}]}\n\n')).toEqual({
      content: 'whole',
    });
  });

  it('surfaces an in-stream error and rejects empty output', () => {
    expect(() => parseStreamedCompletion('data: {"error":{"message":"quota"}}\n\n')).toThrow(/quota/);
    expect(() => parseStreamedCompletion('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n')).toThrow(/no content/);
  });

  it('falls back to a plain completion body when the server ignored stream', () => {
    expect(parseStreamedCompletion('{"choices":[{"message":{"content":"plain"}}]}')).toEqual({ content: 'plain' });
  });
});
