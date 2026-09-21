import { PipelineError, type PipelineErrorCode } from '@novelstruct/pipeline';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

/** A failure the handler wants reported with a specific status; the message is safe to show. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ErrorReply {
  readonly status: ContentfulStatusCode;
  readonly message: string;
  /** True when the cause is unexpected and should be logged with its stack. */
  readonly unexpected: boolean;
}

const PIPELINE_STATUS: Record<PipelineErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  invalid_input: 400,
  not_configured: 400,
};

const GENERIC_MESSAGE = '服务器内部错误';

/** Maps any thrown value to a status and a message that does not leak internals. */
export function toErrorReply(error: unknown): ErrorReply {
  if (error instanceof HttpError) return { status: error.status, message: error.message, unexpected: false };
  if (error instanceof PipelineError) {
    return { status: PIPELINE_STATUS[error.code], message: error.message, unexpected: false };
  }
  if (error instanceof ZodError) {
    const detail = error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { status: 400, message: `请求参数无效: ${detail}`, unexpected: false };
  }
  return { status: 500, message: GENERIC_MESSAGE, unexpected: true };
}
