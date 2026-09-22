import type { QueueLogger } from './types.js';

/** Timestamped lines on stdout and stderr; shared by the API and the worker process. */
export const stdioLogger: QueueLogger = {
  info: (message) => process.stdout.write(`${timestamp()} ${message}\n`),
  error: (message, error) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : error === undefined ? '' : String(error);
    process.stderr.write(`${timestamp()} ${message}${detail ? `\n${detail}` : ''}\n`);
  },
};

export const silentLogger: QueueLogger = { info: () => undefined, error: () => undefined };

function timestamp(): string {
  return new Date().toISOString();
}
