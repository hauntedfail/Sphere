import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Content-Security-Policy for the built site. Everything the page needs is
 * served from its own origin, and `connect-src 'none'` makes the "no network"
 * promise enforceable by the browser rather than by convention.
 *
 * The dev server is exempt: Vite's HMR needs a websocket and inline styles.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'sphere-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '<meta charset="utf-8" />',
          `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        ),
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspMeta()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/env.d.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
