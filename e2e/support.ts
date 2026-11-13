import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';

/**
 * Shared by every spec: a test fails on a console error, a console warning
 * or a Content-Security-Policy violation, whatever else it was checking.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const seen: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') seen.push(message.text());
      });
      page.on('pageerror', (error) => seen.push(error.message));
      await use(seen);
      expect(seen, 'console errors and CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const toasts = (page: Page) => page.locator('#toasts');

export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

/**
 * Strings that only the simulated device's own code contains. The production
 * bundle must have none of them and the debug bundle all of them: the second
 * half is what keeps the first from passing by accident after a rename.
 */
export const SIMULATOR_MARKERS = ['Sphere simulator', 'SIM-0001', 'SIMCHARGER', '0.0.0-sim'] as const;

/** All JavaScript a build ships, every chunk, read from its output directory. */
export function bundleCode(outDir: string): string {
  const assets = join(process.cwd(), outDir, 'assets');
  return readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(assets, name), 'utf8'))
    .join('\n');
}

/** The policy both builds must carry: the debug build is not a looser one. */
export async function expectSecurityPolicy(page: Page): Promise<void> {
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("require-trusted-types-for 'script'");
}
