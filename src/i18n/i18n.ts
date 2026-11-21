/**
 * One language, ready to use. i18next does the looking up; this file is the
 * only one that knows it is there.
 */
import { type Resource, createInstance } from 'i18next';
import { type Locale, type LocaleInput, resolveLocale } from './locales';
import { type MessageKey, type Messages, en } from './messages/en';

export type Translate = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;

export interface I18n {
  readonly locale: Locale;
  readonly t: Translate;
}

/**
 * Build a translator for `locale`. Text goes into the page as text nodes, so
 * parameters are not HTML-escaped. A key the language lacks reads in English.
 */
export function createI18n(locale: Locale, messages: Messages): I18n {
  const resources: Resource = { en: { translation: en }, [locale]: { translation: messages } };
  const instance = createInstance();
  // With the dictionaries handed in and `initAsync` off, this finishes before it returns.
  void instance.init({
    lng: locale,
    fallbackLng: 'en',
    load: 'currentOnly',
    resources,
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return {
    locale,
    t: (key, params) => String(instance.t(key, { ...params })),
  };
}

export const ENGLISH: I18n = createI18n('en', en);

/**
 * The dictionary for `locale`. Each language is imported by name, so the
 * bundler gives it a file of its own and English visitors never fetch it.
 */
export async function loadMessages(locale: Locale): Promise<Messages> {
  switch (locale) {
    case 'ja':
      return (await import('./messages/ja')).ja;
    default:
      // The languages without a dictionary yet are known by name and read in English.
      return en;
  }
}

/** The translator for `locale`, fetching its dictionary if it is not English. */
export async function loadI18n(locale: Locale): Promise<I18n> {
  return locale === 'en' ? ENGLISH : createI18n(locale, await loadMessages(locale));
}

/**
 * The translator to start the page with. A dictionary that cannot be fetched
 * must not leave the page blank, so the page opens in English instead.
 */
export async function bootI18n(
  input: LocaleInput,
  load: (locale: Locale) => Promise<I18n> = loadI18n,
): Promise<I18n> {
  try {
    return await load(resolveLocale(input));
  } catch {
    return ENGLISH;
  }
}
