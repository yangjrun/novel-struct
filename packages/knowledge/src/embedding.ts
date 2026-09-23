import { EMBEDDING_DIMENSIONS } from '@novelstruct/db';

export interface EmbeddingConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface Embedder {
  readonly model: string;
  embed(input: string): Promise<number[]>;
}

/** OpenAI-compatible /embeddings endpoint, independent of the structure-pass LLM. */
export function createEmbedder(config: EmbeddingConfig, fetcher: typeof fetch = fetch): Embedder {
  return {
    model: config.model,
    async embed(input) {
      const response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: config.model, input, dimensions: EMBEDDING_DIMENSIONS }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`embedding request failed: HTTP ${response.status}`);
      const body: unknown = await response.json();
      const vector = (body as { data?: { embedding?: unknown }[] })?.data?.[0]?.embedding;
      if (
        !Array.isArray(vector) ||
        vector.length !== EMBEDDING_DIMENSIONS ||
        vector.some((n) => typeof n !== 'number' || !Number.isFinite(n))
      ) {
        throw new Error(`embedding endpoint must return ${EMBEDDING_DIMENSIONS} finite numbers`);
      }
      return vector as number[];
    },
  };
}

export function parseEmbeddingConfig(env: Readonly<Record<string, string | undefined>>): EmbeddingConfig | undefined {
  const apiKey = env['EMBEDDING_API_KEY']?.trim();
  const model = env['EMBEDDING_MODEL']?.trim();
  if (!apiKey && !model) return undefined;
  if (!apiKey || !model) throw new Error('EMBEDDING_API_KEY 和 EMBEDDING_MODEL 必须同时设置');
  return { apiKey, model, baseUrl: env['EMBEDDING_BASE_URL']?.trim() || 'https://api.openai.com/v1' };
}
