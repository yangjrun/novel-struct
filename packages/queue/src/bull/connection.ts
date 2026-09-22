import IORedis from 'ioredis';

/**
 * One ioredis client from a `redis://` or `rediss://` URL. BullMQ needs `maxRetriesPerRequest`
 * unset so blocking commands are never abandoned; the URL carries host, port, password and db.
 */
export function createRedisConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

/** Resolves once the server answers PING, or rejects after `timeoutMs`. */
export async function probeRedis(redisUrl: string, timeoutMs = 2000): Promise<boolean> {
  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest: 0,
    connectTimeout: timeoutMs,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  // A refused connection is the expected negative answer here, not an event worth logging.
  client.on('error', () => undefined);
  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}
