import { defineConfig, devices } from '@playwright/test';

const HOST = '127.0.0.1';
const RELEASE_PORT = 4173;
const DEBUG_PORT = 4174;

/**
 * End-to-end tests run against built sites, so they exercise the real
 * Content-Security-Policy. No Bluetooth hardware is involved.
 *
 * Two builds are served. `release` is the production build, which has no
 * simulator: it is checked for what needs no device, and for the simulator's
 * absence. `debug` is `pnpm build:debug`, which carries the simulated device
 * that the device flows run against.
 *
 * `PW_CHANNEL=chrome` uses the installed Google Chrome instead of
 * Playwright's own Chromium download.
 */
const channel = process.env['PW_CHANNEL'];
// Each run builds and serves its own copies. A server left on one of these
// ports is an error, not a shortcut: it could be serving an older build.
const reuseExistingServer = false;

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } };
const phone = { ...devices['Pixel 7'] };
const release = { baseURL: `http://${HOST}:${RELEASE_PORT}` };
const debug = { baseURL: `http://${HOST}:${DEBUG_PORT}` };

const preview = (port: number, mode: string): string =>
  `pnpm exec vite preview --mode ${mode} --port ${port} --strictPort --host ${HOST}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    ...(channel === undefined ? {} : { channel }),
  },
  projects: [
    { name: 'desktop', testMatch: 'release.spec.ts', use: { ...desktop, ...release } },
    { name: 'phone', testMatch: 'release.spec.ts', use: { ...phone, ...release } },
    { name: 'desktop-debug', testMatch: ['debug.spec.ts', 'shots.spec.ts'], use: { ...desktop, ...debug } },
    { name: 'phone-debug', testMatch: ['debug.spec.ts', 'shots.spec.ts'], use: { ...phone, ...debug } },
  ],
  webServer: [
    {
      command: `pnpm build && ${preview(RELEASE_PORT, 'production')}`,
      url: release.baseURL,
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      command: `pnpm build:debug && ${preview(DEBUG_PORT, 'debug')}`,
      url: debug.baseURL,
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
});
