import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../src/i18n/i18n';
import { LOCALES, type Locale } from '../src/i18n/locales';
import { codePointsOf } from './woff2';

/**
 * The fonts shipped for each language are cut down to the characters its
 * dictionary uses (docs/fonts.md). So a translation that uses a new character
 * needs the fonts built again, and this is what says so.
 *
 * What a font holds is read from the font file itself, the one a browser
 * will be given, and not from anything written down beside it.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FONTS = join(ROOT, 'src/assets/fonts');

/** Languages written in what Doto and Instrument Sans already hold. */
const LATIN_LOCALES: readonly Locale[] = ['en', 'it'];
/** Languages that ship a dot font and a text font of their own. */
const FONT_LOCALES: readonly Locale[] = ['ja', 'zh-Hans', 'zh-Hant', 'ko', 'ru'];

const held = (name: string): ReadonlySet<number> => codePointsOf(readFileSync(join(FONTS, name)));

const DOTO = held('doto-latin-full.woff2');
const INSTRUMENT_SANS = held('instrument-sans-latin-wght.woff2');
/**
 * What both Latin faces hold. They come first in every font stack, so a
 * character in here never reaches a language's own fonts; any other has to
 * be in both of them, since a word may be set as a label or as a sentence.
 */
const LATIN: ReadonlySet<number> = new Set([...DOTO].filter((point) => INSTRUMENT_SANS.has(point)));

function texts(node: unknown): string[] {
  return Object.values(node as Record<string, unknown>).flatMap((value) =>
    typeof value === 'string' ? [value] : texts(value),
  );
}

/**
 * Every character a language's own fonts must hold: what its dictionary
 * says, and the same in capitals, because labels are set in capitals, less
 * what the Latin faces hold.
 */
async function requiredCodePoints(locale: Locale): Promise<number[]> {
  const words = texts(await loadMessages(locale));
  const found = new Set<number>();
  for (const word of [...words, ...words.map((text) => text.toUpperCase())]) {
    for (const character of word) {
      const point = character.codePointAt(0) ?? 0;
      if (!LATIN.has(point)) found.add(point);
    }
  }
  return [...found].sort((a, b) => a - b);
}

const fileName = (kind: 'dots' | 'text', locale: Locale): string => `${kind}-${locale.toLowerCase()}.woff2`;
const characters = (points: readonly number[]): string[] => points.map((point) => String.fromCodePoint(point));
const stylesheet = (): string => readFileSync(join(ROOT, 'src/styles.css'), 'utf8');

if (process.env['FONT_CHARS_WRITE'] !== undefined) {
  // `pnpm fonts:chars`: hand the font tool its input, and check nothing. The
  // fonts are expected to be behind the dictionaries at this point.
  it('writes the characters each language needs to tools/fonts/chars.json', async () => {
    const wanted: Record<string, string> = {};
    for (const locale of FONT_LOCALES) wanted[locale] = characters(await requiredCodePoints(locale)).join('');
    writeFileSync(join(ROOT, 'tools/fonts/chars.json'), `${JSON.stringify(wanted, null, 2)}\n`);
    for (const locale of FONT_LOCALES) expect(wanted[locale]?.length, locale).toBeGreaterThan(50);
  });
} else {
  describe('reading a font file', () => {
    it('finds the Latin letters, figures and accents in Doto, and nothing of other scripts', () => {
      for (const character of 'AZaz09%.,:;!?-ÀÈÉÌÒÙàèéìòù’“”…') {
        expect(DOTO.has(character.codePointAt(0) ?? 0), character).toBe(true);
      }
      for (const character of 'あ接电電한Я') expect(DOTO.has(character.codePointAt(0) ?? 0), character).toBe(false);
    });

    it('finds each script in the font made for it', () => {
      const has = (name: string, character: string): boolean => held(name).has(character.codePointAt(0) ?? 0);
      expect(has('dots-ja.woff2', 'あ') && has('text-ja.woff2', '接')).toBe(true);
      expect(has('dots-ko.woff2', '한') && has('text-ko.woff2', '한')).toBe(true);
      expect(has('dots-ru.woff2', 'Я') && has('text-ru.woff2', 'я')).toBe(true);
      expect(has('dots-zh-hans.woff2', '电') && has('dots-zh-hant.woff2', '電')).toBe(true);
      expect(has('dots-zh-hans.woff2', '電') || has('dots-ja.woff2', '한')).toBe(false);
    });

    it('refuses a file that is not a WOFF2 font', () => {
      expect(() => codePointsOf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a WOFF2 font/);
    });
  });

  describe('the fonts', () => {
    it.each(FONT_LOCALES)('hold every character %s uses, in dots and in text', async (locale) => {
      const need = await requiredCodePoints(locale);
      expect(need.length).toBeGreaterThan(50);
      for (const kind of ['dots', 'text'] as const) {
        const have = held(fileName(kind, locale));
        const missing = characters(need.filter((point) => !have.has(point)));
        expect(missing, `${fileName(kind, locale)}: run pnpm fonts:chars && pnpm fonts:build`).toEqual([]);
      }
    });

    it.each(LATIN_LOCALES)('are not needed for %s: Doto and Instrument Sans hold all of it', async (locale) => {
      expect(characters(await requiredCodePoints(locale))).toEqual([]);
    });

    it('account for every language', () => {
      const dictionaries = readdirSync(join(ROOT, 'src/i18n/messages')).map((name) => name.replace(/\.ts$/, ''));
      expect([...LATIN_LOCALES, ...FONT_LOCALES].sort()).toEqual(dictionaries.sort());
      expect([...LATIN_LOCALES, ...FONT_LOCALES].sort()).toEqual([...LOCALES].sort());
    });

    it('are the files the stylesheet loads, no more and no fewer', () => {
      const loaded = [...stylesheet().matchAll(/url\('\.\/assets\/fonts\/([^']+)'\)/g)].map((match) => match[1]).sort();
      expect(loaded).toEqual(readdirSync(FONTS).sort());
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
}
