import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../src/i18n/i18n';
import { LOCALES, type Locale } from '../src/i18n/locales';

/**
 * The fonts shipped for each language are cut down to the characters its
 * dictionary uses (tools/fonts). So a translation that uses a new character
 * needs the fonts built again, and this is what says so.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FONTS = join(ROOT, 'src/assets/fonts');

/** Languages written in what Doto and Instrument Sans already hold. */
const LATIN_LOCALES: readonly Locale[] = ['en'];
/** Languages that ship a dot font and a text font of their own. */
const FONT_LOCALES: readonly Locale[] = ['ja'];

/** Characters above U+00FF that both Doto and Instrument Sans hold, as shipped. */
const LATIN_COVERED: ReadonlySet<number> = new Set(
  [
    [0x131, 0x131],
    [0x152, 0x153],
    [0x2c6, 0x2c6],
    [0x2da, 0x2da],
    [0x2dc, 0x2dc],
    [0x2013, 0x2014],
    [0x2018, 0x201a],
    [0x201c, 0x201e],
    [0x2022, 0x2022],
    [0x2026, 0x2026],
    [0x2039, 0x203a],
    [0x20ac, 0x20ac],
    [0x2122, 0x2122],
    [0x2212, 0x2212],
  ].flatMap(([from, to]) => Array.from({ length: (to ?? 0) - (from ?? 0) + 1 }, (_, index) => (from ?? 0) + index)),
);

function texts(node: unknown): string[] {
  return Object.values(node as Record<string, unknown>).flatMap((value) =>
    typeof value === 'string' ? [value] : texts(value),
  );
}

/**
 * Every character a language's fonts must hold: what its dictionary says,
 * and the same in capitals, because labels are set in capitals. Latin-1 is
 * left to Doto and Instrument Sans, which come first in every font stack.
 */
async function requiredCodePoints(locale: Locale): Promise<number[]> {
  const words = texts(await loadMessages(locale));
  const found = new Set<number>();
  for (const word of [...words, ...words.map((text) => text.toUpperCase())]) {
    for (const character of word) {
      const point = character.codePointAt(0) ?? 0;
      if (point > 0xff && !LATIN_COVERED.has(point)) found.add(point);
    }
  }
  return [...found].sort((a, b) => a - b);
}

const fileName = (kind: 'dots' | 'text', locale: Locale): string => `${kind}-${locale.toLowerCase()}.woff2`;

const coverage = (): Record<string, number[]> =>
  JSON.parse(readFileSync(join(FONTS, 'coverage.json'), 'utf8')) as Record<string, number[]>;

const stylesheet = (): string => readFileSync(join(ROOT, 'src/styles.css'), 'utf8');

// `pnpm fonts:chars` runs this file with the switch on, to hand the font tool its input.
if (process.env['FONT_CHARS_WRITE'] !== undefined) {
  const wanted: Record<string, string> = {};
  for (const locale of FONT_LOCALES) wanted[locale] = String.fromCodePoint(...(await requiredCodePoints(locale)));
  writeFileSync(join(ROOT, 'tools/fonts/chars.json'), `${JSON.stringify(wanted, null, 2)}\n`);
}

describe('the fonts', () => {
  it.each(FONT_LOCALES)('hold every character %s uses, in dots and in text', async (locale) => {
    const need = await requiredCodePoints(locale);
    expect(need.length).toBeGreaterThan(50);
    for (const kind of ['dots', 'text'] as const) {
      const have = new Set(coverage()[fileName(kind, locale)] ?? []);
      const missing = need.filter((point) => !have.has(point)).map((point) => String.fromCodePoint(point));
      expect(missing, `${fileName(kind, locale)}: run pnpm fonts:chars && pnpm fonts:build`).toEqual([]);
    }
  });

  it.each(LATIN_LOCALES)('are not needed for %s: Doto and Instrument Sans hold all of it', async (locale) => {
    expect((await requiredCodePoints(locale)).map((point) => String.fromCodePoint(point))).toEqual([]);
  });

  it('account for every language', () => {
    // Until its dictionary is written, a language has no characters to hold and is on neither list.
    const dictionaries = readdirSync(join(ROOT, 'src/i18n/messages')).map((name) => name.replace(/\.ts$/, ''));
    expect([...LATIN_LOCALES, ...FONT_LOCALES].sort()).toEqual(dictionaries.sort());
    for (const locale of [...LATIN_LOCALES, ...FONT_LOCALES]) expect(LOCALES).toContain(locale);
  });

  it('are the files the stylesheet loads, no more and no fewer', () => {
    const loaded = [...stylesheet().matchAll(/url\('\.\/assets\/fonts\/([^']+)'\)/g)].map((match) => match[1]).sort();
    const shipped = readdirSync(FONTS)
      .filter((name) => name.endsWith('.woff2'))
      .sort();
    expect(loaded).toEqual(shipped);
    for (const name of Object.keys(coverage())) expect(existsSync(join(FONTS, name)), name).toBe(true);
  });

  it.each(FONT_LOCALES)('are chosen by the language of the page, after the Latin faces: %s', (locale) => {
    const tag = locale.toUpperCase();
    const rule = new RegExp(`:root:lang\\(${locale}\\)\\s*\\{([^}]*)\\}`).exec(stylesheet())?.[1] ?? '';
    expect(rule).toMatch(new RegExp(`--dots:\\s*'Doto',\\s*'Sphere Dots ${tag}'`));
    expect(rule).toMatch(new RegExp(`--sans:\\s*'Instrument Sans',\\s*'Sphere Text ${tag}'`));
  });

  it('are never thickened by the browser to fake a weight they lack', () => {
    const labels = /\.dot-text,[^{]*\{([^}]*)\}/.exec(stylesheet())?.[1] ?? '';
    expect(labels).toMatch(/font-synthesis:\s*none/);
  });
});
