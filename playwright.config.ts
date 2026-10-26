import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.local/playwright-browsers');
const artifacts = [process.env.E2E_PROJECT || 'browser', process.env.E2E_SCENARIO || 'all'].join(
  '/',
);
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  globalTimeout: 300_000,
  expect: { timeout: 10_000 },
  outputDir: `test-results/${artifacts}`,
  reporter: [['list'], ['html', { outputFolder: `playwright-report/${artifacts}`, open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-android', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs api',
      url: 'http://127.0.0.1:4100/api/v1/ready',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node scripts/e2e-server.mjs web',
      url: 'http://127.0.0.1:5180',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
