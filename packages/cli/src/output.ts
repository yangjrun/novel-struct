/** The CLI's only stdout/stderr channel, so command modules stay free of console calls. */
export function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function printError(line: string): void {
  process.stderr.write(`${line}\n`);
}
