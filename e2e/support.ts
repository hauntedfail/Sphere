import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { liveTarget } from './target';

/** The already-served site under test, or null when the tests serve their own builds. */
export const live = liveTarget(process.env['SPHERE_URL']);

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

// A relative address of another script, as a bundler writes it into a chunk:
// `from"./session-abc.js"`, `import(\`./simulator-abc.js\`)`.
const CHUNK_REFERENCE = /["'`](\.{1,2}\/[\w./-]+\.js)["'`]/g;
const MOST_SCRIPTS = 50;

/**
 * All JavaScript a served site ships, fetched from its host: the scripts the
 * document names, and every chunk those refer to in turn. A chunk that is
 * only loaded on demand is named in the code that would load it, so it is
 * found without having to trigger it.
 */
export async function servedCode(page: Page): Promise<string> {
  const origin = new URL(page.url()).origin;
  const bodies = new Map<string, string>();
  let pending = await scriptUrls(page);

  while (pending.length > 0) {
    const found: string[] = [];
    for (const url of pending) {
      if (bodies.has(url) || new URL(url).origin !== origin) continue;
      expect(bodies.size, 'scripts fetched').toBeLessThan(MOST_SCRIPTS);
      const response = await page.request.get(url);
      expect(response.ok(), url).toBe(true);
      const body = await response.text();
      bodies.set(url, body);
      for (const [, reference] of body.matchAll(CHUNK_REFERENCE)) {
        if (reference !== undefined) found.push(new URL(reference, url).href);
      }
    }
    pending = found;
  }
  return [...bodies.values()].join('\n');
}

/** Absolute addresses of every script the document loads or preloads. */
export function scriptUrls(page: Page): Promise<string[]> {
  return page
    .locator('script[src], link[rel="modulepreload"]')
    .evaluateAll((elements) =>
      elements.map((element) =>
        element instanceof HTMLScriptElement ? element.src : (element as HTMLLinkElement).href,
      ),
    );
}

export type HeaderRule = readonly [name: string, value: string];

/**
 * `public/_headers`, parsed: each path pattern with the headers it asks for.
 * The file is the single statement of what a host must send.
 */
export function headerRules(): ReadonlyMap<string, readonly HeaderRule[]> {
  const rules = new Map<string, HeaderRule[]>();
  let current: HeaderRule[] | undefined;
  for (const line of readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8').split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = [];
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(':');
    if (current === undefined || colon < 0) throw new Error(`public/_headers: cannot read "${line}"`);
    current.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** The policy both builds must carry: the debug build is not a looser one. */
export async function expectSecurityPolicy(page: Page): Promise<void> {
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("require-trusted-types-for 'script'");
}
