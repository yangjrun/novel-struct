export type PipelineErrorCode = 'not_found' | 'invalid_input' | 'not_configured';

/** A user-facing failure of an orchestration step. Callers map `code` to an exit code or HTTP status. */
export class PipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}
