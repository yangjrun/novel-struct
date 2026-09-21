/**
 * Runs the API (tsx watch) and the Vite dev server side by side from the workspace root,
 * so both see the root .env and the same ./data directory. No extra dependency needed.
 */
import { spawn } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const children = [
  start('api', ['api:dev']),
  start('web', ['web:dev']),
];

function start(name, args) {
  const child = spawn(pnpm, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  prefix(child.stdout, process.stdout, name);
  prefix(child.stderr, process.stderr, name);
  child.on('exit', (code) => {
    process.stderr.write(`[${name}] 退出，代码 ${code ?? 'null'}\n`);
  });
  return child;
}

function prefix(source, target, name) {
  let rest = '';
  source.setEncoding('utf8');
  source.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) target.write(`[${name}] ${line}\n`);
  });
  source.on('end', () => {
    if (rest.length > 0) target.write(`[${name}] ${rest}\n`);
  });
}

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});
