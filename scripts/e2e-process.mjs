import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root } from './e2e-environment.mjs';
const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
export const viteCli = path.join(
  path.dirname(requireFrontend.resolve('vite/package.json')),
  'bin/vite.js',
);
export const playwrightCli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
export async function runNode(script, args = [], options = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
