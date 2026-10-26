import { browserPath } from './e2e-environment.mjs';
import { runNode, playwrightCli } from './e2e-process.mjs';
process.exitCode = await runNode(playwrightCli, ['install', '--no-remove', 'chromium', 'webkit'], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
});
