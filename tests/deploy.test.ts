import { readFileSync } from 'node:fs';
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

interface WranglerConfig {
  name?: string;
  main?: string;
  compatibility_date?: string;
  assets?: { directory?: string };
  routes?: { pattern?: string; custom_domain?: boolean }[];
  workers_dev?: boolean;
  preview_urls?: boolean;
}

/**
 * wrangler.jsonc is JSON plus comments. A JSON string cannot span lines, so
 * a line that starts with `//` is always a comment and never part of a value.
 */
function wrangler(): WranglerConfig {
  const json = read('wrangler.jsonc')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  return JSON.parse(json) as WranglerConfig;
}

function productionOutDir(): string | undefined {
  if (typeof viteConfig !== 'function') throw new Error('vite.config.ts must export a function');
  return (viteConfig({ command: 'build', mode: 'production' }) as UserConfig).build?.outDir;
}

describe('what gets deployed', () => {
  it('is the production build, never the debug one', () => {
    const directory = wrangler().assets?.directory?.replace(/^\.\//, '');
    expect(directory).toBe(productionOutDir());
    expect(directory).not.toBe('dist-debug');
  });

  it('is files only: no Worker script runs in front of them', () => {
    expect(wrangler().main).toBeUndefined();
  });

  it('pins a compatibility date', () => {
    expect(wrangler().compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('where it is served', () => {
  it('is one custom domain', () => {
    expect(wrangler().routes).toEqual([{ pattern: 'sphere.h1ka.ru', custom_domain: true }]);
  });

  it('has no second origin: no workers.dev address and no preview addresses', () => {
    // Saved devices and Bluetooth permissions belong to an origin. A second
    // address for the same site would be a second, separate copy of both.
    expect(wrangler().workers_dev).toBe(false);
    expect(wrangler().preview_urls).toBe(false);
  });
});

describe('the build environment', () => {
  it('pins the package manager to an exact version', () => {
    const { packageManager } = JSON.parse(read('package.json')) as { packageManager?: string };
    expect(packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it('pins the Node.js major version', () => {
    expect(read('.node-version').trim()).toMatch(/^\d+$/);
  });
});

describe('response headers', () => {
  const rules = read('public/_headers');

  it('lets browsers keep the fingerprinted files for good', () => {
    expect(rules).toMatch(/^\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m);
  });

  it('keeps the page itself revalidated, so a new build is picked up', () => {
    expect(rules).toMatch(/^\/\n {2}Cache-Control: public, max-age=0, must-revalidate, no-transform$/m);
  });

  it('tells the host not to rewrite the page on its way out', () => {
    // Cloudflare's bot detection adds an inline script to HTML it proxies.
    // The security policy refuses to run it, which shows as a console error
    // on every visit. A response marked no-transform is left as it was built.
    // Comments aside: only the lines that set a header.
    const headers = (block: string): string[] => block.split('\n').filter((line) => line.startsWith('  '));
    const split = rules.indexOf('\n/\n');
    expect(split).toBeGreaterThan(0);
    expect(headers(rules.slice(split)).join('\n')).toMatch(/no-transform/);
    // Only the page: compressing scripts and styles is a transformation too.
    expect(headers(rules.slice(0, split)).join('\n')).not.toMatch(/no-transform/);
  });
});
