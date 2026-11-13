import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * End-to-end tests run against the production build, so they exercise the
 * real Content-Security-Policy. They use the simulated device: no Bluetooth
 * hardware is involved.
 *
 * `PW_CHANNEL=chrome` uses the installed Google Chrome instead of
 * Playwright's own Chromium download.
 */
const channel = process.env['PW_CHANNEL'];

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...(channel === undefined ? {} : { channel }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 60_000,
  },
});
