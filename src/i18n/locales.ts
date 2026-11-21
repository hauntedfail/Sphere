/**
 * The languages the page speaks, and how one is chosen. Pure: the caller
 * reads the address, the storage and the browser, and passes what it found.
 */
export const LOCALES = ['en', 'ja', 'zh-Hans', 'zh-Hant', 'ko', 'ru', 'it'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'sphere.locale.v1';
/** The parameter of the address that opens the page in a language: `?lang=ja`. */
export const LOCALE_PARAMETER = 'lang';

/** Each language under its own name, for the switch. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  ja: '日本語',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ko: '한국어',
  ru: 'Русский',
  it: 'Italiano',
};

/** A code from the list, in any letter case. Nothing else: no regions, no guesses. */
export function parseLocale(value: string | null | undefined): Locale | null {
  if (typeof value !== 'string') return null;
  const wanted = value.trim().toLowerCase();
  return LOCALES.find((locale) => locale.toLowerCase() === wanted) ?? null;
}

const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]+)*$/;
/** Where Chinese is written in traditional characters. */
const TRADITIONAL_REGIONS: ReadonlySet<string> = new Set(['tw', 'hk', 'mo']);

/** The language a browser's BCP 47 tag asks for, or `null` if the page has none for it. */
export function matchLocale(tag: string): Locale | null {
  const lowered = tag.trim().toLowerCase();
  if (!LANGUAGE_TAG.test(lowered)) return null;
  const [language, ...rest] = lowered.split('-');
  if (language === 'zh') {
    // An explicit script wins over the region: zh-Hans-HK is simplified.
    if (rest.includes('hant')) return 'zh-Hant';
    if (rest.includes('hans')) return 'zh-Hans';
    return rest.some((part) => TRADITIONAL_REGIONS.has(part)) ? 'zh-Hant' : 'zh-Hans';
  }
  return LOCALES.find((locale) => locale === language) ?? null;
}

export interface LocaleInput {
  /** The `lang` parameter of the address, if any. */
  readonly query: string | null;
  /** What the visitor chose last time, as stored. */
  readonly saved: string | null;
  /** `navigator.languages`, most wanted first. */
  readonly preferred: readonly string[];
}

/** The address first, then the saved choice, then the browser, then English. */
export function resolveLocale(input: LocaleInput): Locale {
  const asked = parseLocale(input.query) ?? parseLocale(input.saved);
  if (asked !== null) return asked;
  for (const tag of input.preferred) {
    const match = matchLocale(tag);
    if (match !== null) return match;
  }
  return DEFAULT_LOCALE;
}

/**
 * `href` without its `lang` parameter. Once a visitor has chosen a language
 * on the page, the address must stop asking for another one.
 */
export function withoutLanguageParameter(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(LOCALE_PARAMETER);
  return url.href;
}
