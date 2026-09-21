import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiFailure, ApiSuccess } from './contracts.js';

/** Every JSON endpoint answers with the same envelope so the client can narrow on `success`. */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200): Response {
  const body: ApiSuccess<T> = { success: true, data, error: null };
  return c.json(body, status);
}

export function fail(c: Context, message: string, status: ContentfulStatusCode): Response {
  const body: ApiFailure = { success: false, data: null, error: message };
  return c.json(body, status);
}
