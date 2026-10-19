import { defineConfig, devices } from '@playwright/test';
// Set CHROMIUM_PATH to use a specific Chromium binary instead of Playwright's bundled browser.
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    acceptDownloads: true,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {}
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
