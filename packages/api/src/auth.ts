import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { fail } from './respond.js';

/** Compare fixed-length digests to avoid leaking a token through comparison timing. */
export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function requireApiToken(expected: string) {
  return async (c: Context, next: Next) => {
    if (c.req.method === 'OPTIONS') return next();
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!tokenMatches(token, expected)) {
      c.header('WWW-Authenticate', 'Bearer');
      return fail(c, '请提供有效的 API 访问令牌', 401);
    }
    return next();
  };
}
