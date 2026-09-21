/** A user-facing failure: printed as one line, exit code 1, no stack trace. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
