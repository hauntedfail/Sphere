import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The boundaries the README states about the source, checked in the source.
 * Each is a rule a change can break without any other test noticing, because
 * the page would still work.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Line {
  /** `src/ui/view.ts:99`, for the failure message. */
  readonly where: string;
  readonly file: string;
  readonly text: string;
}

/** Every line of code under src/. Comment lines are left out: they may name what the code must not use. */
function sourceLines(): Line[] {
  const files = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => `src/${path.split('\\').join('/')}`)
    .sort();
  return files.flatMap((file) =>
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .map((text, index) => ({ where: `${file}:${index + 1}`, file, text }))
      .filter(({ text }) => !/^\s*(\/\/|\/\*|\*)/.test(text)),
  );
}

const lines = sourceLines();

/** Where `pattern` appears outside the files allowed to use it. */
const uses = (pattern: RegExp, allowed: (file: string) => boolean = () => false): string[] =>
  lines.filter(({ file, text }) => !allowed(file) && pattern.test(text)).map(({ where }) => where);

describe('the source', () => {
  it('is read at all', () => {
    expect(lines.length).toBeGreaterThan(1000);
  });

  it('reaches Bluetooth from one file', () => {
    expect(uses(/navigator\s*\.\s*bluetooth\b/, (file) => file === 'src/transport/web-bluetooth.ts')).toEqual([]);
  });

  it('reads the simulator switch in one file, so the bundler can drop the simulator whole', () => {
    expect(uses(/__SIMULATOR__/, (file) => file === 'src/main.ts' || file === 'src/env.d.ts')).toEqual([]);
  });

  it('touches the page only from ui/ and the entry point', () => {
    const page = (file: string): boolean => file.startsWith('src/ui/') || file === 'src/main.ts';
    expect(uses(/\b(document|window)\s*\./, page)).toEqual([]);
  });

  it('never turns text into markup or sets a style inline', () => {
    expect(uses(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b|document\s*\.\s*write\b|\.style\s*\.|\bcssText\b/)).toEqual([]);
  });

  it('has no way to reach the network', () => {
    expect(uses(/\bfetch\s*\(|\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/)).toEqual([]);
  });
});

describe('what ships', () => {
  it("is this repository's code: no runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      expect(Object.keys((manifest[field] as object | undefined) ?? {}), field).toEqual([]);
    }
  });
});
