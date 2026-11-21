import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { forbiddenTrackedPaths, headingAnchors, localLinks, namedPaths, pnpmCommands } from './harness-guards';

/**
 * The agent harness, held to what it says about itself: the files exist,
 * the documents name things that are there, and one command means "done"
 * for a developer, an agent and CI alike. `docs/agent-harness.md` gives the
 * reasons.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const exists = (path: string): boolean => existsSync(join(ROOT, path));

const INDEX = 'docs/INDEX.md';
const ENTRY_LINE_BUDGET = 80;

const HARNESS_FILES = ['AGENTS.md', 'CLAUDE.md', 'Backlog.md', INDEX, 'docs/agent-harness.md', '.github/workflows/ci.yml'];

/** Every Markdown file under docs/, as a path from the repository root. */
function docsFiles(): string[] {
  if (!exists('docs')) return [];
  return readdirSync(join(ROOT, 'docs'), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => `docs/${path.split('\\').join('/')}`)
    .sort();
}

/** The documents an agent is sent to. CLAUDE.md is an import line, not a document. */
const documents = (): string[] => ['AGENTS.md', 'Backlog.md', 'README.md', ...docsFiles()].filter(exists);

/** Where a link in `from` leads, as a path from the repository root. */
const target = (from: string, path: string): string =>
  path === '' ? from : relative(ROOT, resolve(ROOT, dirname(from), path));

const scripts = (): Record<string, string> =>
  (JSON.parse(read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {};

describe('the checks themselves', () => {
  it('pick out build output, local state and secrets among tracked files', () => {
    const tracked = [
      'src/main.ts',
      'dist/index.html',
      'dist-debug/index.html',
      'coverage/lcov.info',
      'e2e/.results/trace.zip',
      'e2e/release.spec.ts',
      '_before-gui-redesign/src/main.ts',
      '.env',
      '.env.production',
      '.env.example',
      'notes.local',
      'public/.DS_Store',
    ];
    expect(forbiddenTrackedPaths(tracked)).toEqual([
      'dist/index.html',
      'dist-debug/index.html',
      'coverage/lcov.info',
      'e2e/.results/trace.zip',
      '_before-gui-redesign/src/main.ts',
      '.env',
      '.env.production',
      'notes.local',
      'public/.DS_Store',
    ]);
  });

  it('read local links and leave out other sites, pictures and code blocks', () => {
    const markdown = [
      'See [the index](docs/INDEX.md), [a heading](../README.md#Run-It) and [here](#below).',
      'Not [elsewhere](https://example.com/a.md) or ![a picture](shot.png).',
      '```',
      '[inside a fence](missing.md)',
      '```',
    ].join('\n');
    expect(localLinks(markdown)).toEqual([
      { path: 'docs/INDEX.md', anchor: null },
      { path: '../README.md', anchor: 'run-it' },
      { path: '', anchor: 'below' },
    ]);
  });

  it('name headings the way GitHub does', () => {
    const markdown = ['# Run it', '## Differences from the `CLI`', '## What it is, and is not', '## Run it', '```', '# a comment', '```'];
    expect([...headingAnchors(markdown.join('\n'))]).toEqual([
      'run-it',
      'differences-from-the-cli',
      'what-it-is-and-is-not',
      'run-it-1',
    ]);
  });

  it('find the pnpm commands a document shows, in code only', () => {
    const markdown = ['Run `pnpm check`, then `pnpm exec playwright install`.', 'Node.js and pnpm for the build.', '```bash', 'pnpm build:debug', '```'];
    expect(pnpmCommands(markdown.join('\n')).sort()).toEqual(['build:debug', 'check', 'exec']);
  });

  it('find the paths a document names under the committed directories', () => {
    const markdown = 'The policy is in `public/_headers` and `src/ui/`; `dist/` is built, `app.run(line)` is code.';
    expect(namedPaths(markdown)).toEqual(['public/_headers', 'src/ui/']);
  });
});

describe('the harness files', () => {
  it.each(HARNESS_FILES)('%s exists', (path) => {
    expect(exists(path), path).toBe(true);
  });

  it('keeps AGENTS.md short enough to be read in full every session', () => {
    expect(read('AGENTS.md').trimEnd().split('\n').length).toBeLessThanOrEqual(ENTRY_LINE_BUDGET);
  });

  it('gives Claude Code the same instructions instead of a second copy', () => {
    expect(read('CLAUDE.md').trim()).toBe('@AGENTS.md');
  });
});

describe('one definition of done', () => {
  it('is pnpm check: typecheck, tests with coverage, then end-to-end tests', () => {
    const check = scripts()['check'] ?? '';
    for (const step of ['pnpm typecheck', 'pnpm coverage', 'pnpm e2e']) expect(check, step).toContain(step);
  });

  it('is what CI runs, and what a release waits for', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^\s+run: pnpm check$/m);
    expect(read('.github/workflows/release.yml')).toMatch(/^\s+uses: \.\/\.github\/workflows\/ci\.yml$/m);
  });
});

describe('what is committed', () => {
  it('has no build output, local state or secrets in it', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    expect(tracked.length).toBeGreaterThan(0);
    expect(forbiddenTrackedPaths(tracked)).toEqual([]);
  });
});

describe('the documents', () => {
  it('link only to files and headings that exist', () => {
    const broken: string[] = [];
    for (const document of documents()) {
      for (const link of localLinks(read(document))) {
        const path = target(document, link.path);
        if (path.startsWith('..') || !exists(path)) {
          broken.push(`${document}: ${link.path}`);
        } else if (link.anchor !== null && path.endsWith('.md') && !headingAnchors(read(path)).has(link.anchor)) {
          broken.push(`${document}: ${link.path}#${link.anchor}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('can all be reached from the index', () => {
    const reached = new Set<string>();
    const queue = [INDEX];
    for (let document = queue.shift(); document !== undefined; document = queue.shift()) {
      if (reached.has(document) || !exists(document)) continue;
      reached.add(document);
      for (const link of localLinks(read(document))) {
        const path = target(document, link.path);
        if (path.startsWith('docs/') && path.endsWith('.md')) queue.push(path);
      }
    }
    expect(docsFiles().filter((document) => !reached.has(document))).toEqual([]);
  });

  it('show only pnpm commands that package.json has', () => {
    const known = new Set([...Object.keys(scripts()), 'install', 'exec', 'dlx']);
    const unknown = documents().flatMap((document) =>
      pnpmCommands(read(document))
        .filter((name) => !known.has(name))
        .map((name) => `${document}: pnpm ${name}`),
    );
    expect(unknown).toEqual([]);
  });

  it('name only files and directories that are there', () => {
    const missing = documents().flatMap((document) =>
      namedPaths(read(document))
        .filter((path) => !exists(path))
        .map((path) => `${document}: ${path}`),
    );
    expect(missing).toEqual([]);
  });
});
