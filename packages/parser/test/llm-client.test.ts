import { describe, expect, it } from 'vitest';
import { createOpenAICompatibleClient } from '../src/index.js';

type FetchCall = { readonly url: string; readonly body: Record<string, unknown> };

function fakeFetch(responses: readonly (Response | Error)[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = queue.shift();
    if (next === undefined) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: impl, calls };
}

const ok = (content: string, usage?: unknown): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });

const client = (fetchImpl: typeof fetch, maxRetries = 2) =>
  createOpenAICompatibleClient({
    baseUrl: 'https://llm.example/v1/',
    apiKey: 'k',
    model: 'm',
    fetchImpl,
    maxRetries,
    sleep: async () => {},
  });

describe('createOpenAICompatibleClient', () => {
  it('posts a chat completion in json mode and returns content with usage', async () => {
    const { fetch, calls } = fakeFetch([ok('{"a":1}', { prompt_tokens: 12, completion_tokens: 3 })]);
    const result = await client(fetch).completeJson({ system: 's', user: 'u' });
    expect(result).toEqual({ content: '{"a":1}', usage: { inputTokens: 12, outputTokens: 3 } });
    expect(calls[0]?.url).toBe('https://llm.example/v1/chat/completions');
    expect(calls[0]?.body).toMatchObject({ model: 'm', temperature: 0, response_format: { type: 'json_object' } });
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

  it('gives up after maxRetries', async () => {
    const { fetch, calls } = fakeFetch([new Response('busy', { status: 429 }), new Response('busy', { status: 429 })]);
    await expect(client(fetch, 1).completeJson({ system: 's', user: 'u' })).rejects.toThrow(/429/);
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
});
