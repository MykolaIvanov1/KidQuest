import path from 'node:path';
import { readdir } from 'node:fs/promises';
import {
  root,
  browserPath,
  loadE2EEnvironment,
  isolatedWebEnvironment,
} from './e2e-environment.mjs';
import { runNode, viteCli, playwrightCli } from './e2e-process.mjs';
await loadE2EEnvironment();
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const requested = args.find((arg) => arg.startsWith('--project='))?.slice(10);
const projects = requested ? [requested] : ['chromium-android', 'webkit-iphone'];
if (projects.some((project) => !['chromium-android', 'webkit-iphone'].includes(project)))
  throw new Error('Unknown E2E project.');
const extra = args.filter((arg) => !arg.startsWith('--project='));
const env = { ...process.env, ...isolatedWebEnvironment, PLAYWRIGHT_BROWSERS_PATH: browserPath };
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
for (const folder of [
  'packages/shared',
  'packages/types',
  'packages/validation',
  'backend',
  'frontend',
]) {
  const code = await runNode(tsc, ['-p', path.join(root, folder, 'tsconfig.json')], { env });
  if (code) process.exit(code);
}
let code = await runNode(viteCli, ['build'], { cwd: path.join(root, 'frontend'), env });
if (code) process.exit(code);
// Each scenario gets fresh real server rate-limit state and browser storage.
// Fast automation must not exhaust another family's shared loopback IP allowance.
const scenarios = (await readdir(path.join(root, 'e2e')))
  .filter((file) => file.endsWith('.spec.ts'))
  .sort();
if (!scenarios.length) throw new Error('No E2E scenario files found.');
projectsLoop: for (const project of projects) {
  for (const scenario of scenarios) {
    code = await runNode(
      playwrightCli,
      ['test', `e2e/${scenario}`, `--project=${project}`, '--pass-with-no-tests', ...extra],
      {
        env: { ...env, E2E_PROJECT: project, E2E_SCENARIO: scenario.replace('.spec.ts', '') },
      },
    );
    if (code) break projectsLoop;
  }
}
process.exitCode = code;
