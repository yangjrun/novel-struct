/** The API's only stdout/stderr channel. */
export interface Logger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export const stdioLogger: Logger = {
  info: (message) => process.stdout.write(`${timestamp()} ${message}\n`),
  error: (message, error) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : error === undefined ? '' : String(error);
    process.stderr.write(`${timestamp()} ${message}${detail ? `\n${detail}` : ''}\n`);
  },
};

export const silentLogger: Logger = { info: () => undefined, error: () => undefined };

function timestamp(): string {
  return new Date().toISOString();
}
