/** The control that chooses the page's language, and the address it leaves behind. */
import { LOCALES, LOCALE_NAMES, type Locale, parseLocale, withoutLanguageParameter } from '../i18n/locales';
import { h } from './dom';

/**
 * Fill `select` with every language under its own name, and call `choose`
 * when one is picked. While a choice is being carried out the element says
 * so in `data-busy`.
 */
export function bindLanguage(select: HTMLSelectElement, choose: (locale: Locale) => Promise<void>): void {
  select.replaceChildren(
    ...LOCALES.map((locale) => h('option', { attrs: { value: locale, lang: locale } }, LOCALE_NAMES[locale])),
  );
  select.addEventListener('change', () => {
    const locale = parseLocale(select.value);
    if (locale === null) return;
    select.dataset['busy'] = '';
    void choose(locale).finally(() => {
      delete select.dataset['busy'];
    });
  });
}

/**
 * Take `?lang=` off the address in the address bar, without a navigation.
 * A link that opened the page in one language must not undo a choice the
 * visitor made on the page when it is reloaded.
 */
export function dropLanguageParameter(): void {
  const here = window.location.href;
  const next = withoutLanguageParameter(here);
  if (next !== here) window.history.replaceState(window.history.state, '', next);
}
