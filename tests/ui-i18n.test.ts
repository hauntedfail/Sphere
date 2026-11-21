// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { LOCALES, LOCALE_NAMES, type Locale } from '../src/i18n/locales';
import { type Messages, en } from '../src/i18n/messages/en';
import { applyStaticText } from '../src/ui/static';
import { type I18n, loadI18n, loadMessages } from '../src/i18n/i18n';
import { sessionLog } from '../src/ui/log';
import { BODY, bluetoothPage, connectedPage, openPage } from './ui-page';

const keyed = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-i18n]')];
const squash = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The message at a dotted path, or `undefined` if the dictionary has none there. */
function lookup(messages: Messages, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined),
    messages,
  );
}

/** Names, which read the same in every language. */
const NAMES = /Sphere|iqos_cli|iqos|i One|i Prime|Iluma|One|Prime|\bi\b/g;

describe('the words in index.html', () => {
  it('marks only leaf elements, with keys the dictionary has', () => {
    document.body.innerHTML = BODY;
    expect(keyed().length).toBeGreaterThan(30);
    for (const element of keyed()) {
      const key = element.dataset['i18n'] ?? '';
      expect(element.childElementCount, key).toBe(0);
      expect(lookup(en, key), key).toBeTypeOf('string');
    }
  });

  it('are the same as the English dictionary', () => {
    document.body.innerHTML = BODY;
    for (const element of keyed()) {
      const key = element.dataset['i18n'] ?? '';
      expect(squash(element.textContent), key).toBe(squash(String(lookup(en, key))));
    }
  });

  it('all have a key, apart from names', () => {
    document.body.innerHTML = BODY;
    applyStaticText(document.body, () => '');
    document.querySelector('noscript')?.remove();
    expect(squash(squash(document.body.textContent).replace(NAMES, ''))).toBe('');
  });

  it('name what an element is called to a screen reader through the dictionary too', () => {
    document.body.innerHTML = BODY;
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
      const key = element.dataset['i18nAriaLabel'] ?? '';
      expect(lookup(en, key), key).toBeTypeOf('string');
    }
    applyStaticText(document.body, (key) => `<${key}>`);
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
      expect(element.getAttribute('aria-label')).toBe(`<${element.dataset['i18nAriaLabel']}>`);
    }
  });
});

describe('the page in English', () => {
  it('reads as it did before the words moved into the dictionary', async () => {
    const page = await connectedPage();
    expect(page.text('title-state')).toBe('ready');
    expect(page.buttonByKey('refresh').textContent).toBe('Refresh');
    expect(page.buttonByKey('disconnect').textContent).toBe('Disconnect');
    expect(document.querySelector('.lede')?.textContent).toBe(en.page.lede);
  });

  it('starts in the language the app was given', () => {
    const page = openPage();
    expect(page.app.store.get().i18n.locale).toBe('en');
    expect(page.text('title-device')).toBe('not connected');
  });
});

/** A language that shows each message as its key, so a test can tell where a word came from. */
const mirror: I18n = {
  locale: 'ja',
  t: (key, params) => `⟦${key}${params === undefined || Object.keys(params).length === 0 ? '' : ` ${JSON.stringify(params)}`}⟧`,
};

describe('what a control answers', () => {
  it('is shown through the dictionary', async () => {
    const page = await connectedPage({ i18n: mirror });
    page.buttonByKey('lock').click();
    await page.settle();
    expect(page.text('toasts')).toBe('⟦result.locked⟧');
  });

  it('is shown through the dictionary when it is a refusal, with what it is about', async () => {
    const page = await bluetoothPage({ i18n: mirror });
    const input = document.getElementById('save-label') as HTMLInputElement;
    input.value = 'a!b';
    input.form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await page.settle();
    expect(page.text('toasts')).toBe('⟦error.label.characters⟧');
  });

  it('puts a message inside a message into the language first', async () => {
    const page = await connectedPage({ i18n: mirror });
    page.buttonByKey('brightness-low').click();
    await page.settle();
    expect(page.text('toasts')).toBe('⟦result.brightnessSet {"level":"⟦value.low⟧"}⟧');
  });

  it('still reads in English as before', async () => {
    const page = await connectedPage();
    page.buttonByKey('lock').click();
    await page.settle();
    expect(page.text('toasts')).toBe('Device locked');
  });
});

describe('the language switch', () => {
  /** Every language is the mirror, under its own name. */
  const loadMirror = async (locale: Locale): Promise<I18n> => ({ locale, t: mirror.t });
  const select = (): HTMLSelectElement => document.getElementById('language') as HTMLSelectElement;

  async function choose(locale: Locale): Promise<void> {
    select().value = locale;
    select().dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(select().dataset['busy']).toBeUndefined());
  }

  it('offers every language under its own name, with the one in use chosen', () => {
    openPage();
    expect([...select().options].map((option) => option.value)).toEqual([...LOCALES]);
    expect([...select().options].map((option) => option.textContent)).toEqual(LOCALES.map((l) => LOCALE_NAMES[l]));
    expect(select().value).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('opens in the language the app was given', () => {
    openPage({ i18n: mirror });
    expect(select().value).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    expect(select().getAttribute('aria-label')).toBe('⟦bar.language⟧');
  });

  it('redraws everything and sets the language of the document', async () => {
    const page = openPage({ loadI18n: loadMirror });
    await choose('ja');
    expect(page.app.store.get().i18n.locale).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    expect(page.text('title-state')).toBe('⟦bar.state.idle⟧');
    expect(page.text('title-device')).toBe('⟦bar.notConnected⟧');
    expect(page.text('connect-button')).toBe('⟦page.connect⟧');
    expect(page.text('demo-button')).toBe('⟦page.demo⟧');
    expect(document.querySelector('.lede')?.textContent).toBe('⟦page.lede⟧');
    expect(select().value).toBe('ja');
  });

  it('stays connected and keeps what was read', async () => {
    const page = await connectedPage({ loadI18n: loadMirror });
    const level = page.text('battery-level');
    expect(level).toMatch(/^\d+%$/);
    await choose('ko');
    expect(page.app.store.get().phase).toBe('connected');
    expect(page.text('battery-level')).toBe(level);
    expect(page.buttonByKey('refresh').textContent).toBe('⟦device.refresh⟧');
    expect(document.querySelector('.feature-title .dot-text')?.textContent).toMatch(/^⟦settings\./);
  });

  it('keeps a label that is being typed', async () => {
    await bluetoothPage({ loadI18n: loadMirror });
    (document.getElementById('save-label') as HTMLInputElement).value = 'desk';
    await choose('ru');
    expect((document.getElementById('save-label') as HTMLInputElement).value).toBe('desk');
  });

  it('switches without a toast and without making a control wait', async () => {
    const page = await connectedPage({ loadI18n: loadMirror });
    await choose('it');
    expect(page.text('toasts')).toBe('');
    expect(document.querySelectorAll('.is-waiting').length).toBe(0);
  });

  it('follows a language chosen any other way', async () => {
    const page = openPage({ loadI18n: loadMirror });
    await page.run('lang zh-Hant');
    expect(select().value).toBe('zh-Hant');
    expect(document.documentElement.lang).toBe('zh-Hant');
  });

  it('goes back to the language in use, and says why, when another cannot be loaded', async () => {
    const page = openPage({ loadI18n: () => Promise.reject(new Error('offline')) });
    await choose('ja');
    expect(select().value).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(page.text('toasts')).toBe('transport error: could not load 日本語. The page stays as it is.');
  });

  it('uncovers the page once it is drawn', () => {
    document.documentElement.setAttribute('data-boot', '');
    openPage();
    expect(document.documentElement.hasAttribute('data-boot')).toBe(false);
  });
});

describe.each(['ja', 'zh-Hans', 'zh-Hant', 'ko', 'ru', 'it'] as const)('the page in %s', (locale) => {
  /** English sentences: any message of two words or more. Names and single words can coincide. */
  const sentences = (messages: Messages): string[] =>
    [...new Set(collect(messages))].filter((text) => /\S\s+\S/.test(text.trim())).map((text) => text.trim());

  function collect(node: unknown): string[] {
    return Object.values(node as Record<string, unknown>).flatMap((value) =>
      typeof value === 'string' ? [value] : collect(value),
    );
  }

  it('fills every keyed element from its own dictionary', async () => {
    openPage({ i18n: await loadI18n(locale) });
    const own = await loadMessages(locale);
    expect(document.documentElement.lang).toBe(locale);
    for (const element of keyed()) {
      const key = element.dataset['i18n'] ?? '';
      if (element.id === 'title-device' || element.id === 'title-state' || element.id === 'connect-button') continue;
      expect(element.textContent, key).toBe(lookup(own, key));
    }
  });

  it('leaves no English sentence on the page, before or after connecting', async () => {
    const page = await connectedPage({ i18n: await loadI18n(locale) });
    // A message the language keeps as it is in English (a pair of names, say) is its own, not a leftover.
    const own = new Set(collect(await loadMessages(locale)).map((text) => text.trim()));
    const foreign = sentences(en).filter((sentence) => !own.has(sentence));
    expect(foreign.length).toBeGreaterThan(100);
    const shown = (): string => squash(document.querySelector('.shell')?.textContent ?? '');
    for (const sentence of foreign) expect(shown(), sentence).not.toContain(sentence);
    await page.run('disconnect');
    for (const sentence of foreign) expect(shown(), sentence).not.toContain(sentence);
  });

  it('keeps the session log in English', async () => {
    const steps = ['lock', 'brightness low', 'device save a!b', 'unlock'];
    const logOf = async (i18n: I18n): Promise<string> => {
      const page = await connectedPage({ i18n });
      for (const step of steps) await page.run(step);
      return sessionLog({ console: page.app.store.get().console, wire: [] }, '1.2.3');
    };
    expect(await logOf(await loadI18n(locale))).toBe(await logOf(await loadI18n('en')));
  });

  it('answers a control in its own words', async () => {
    const page = await connectedPage({ i18n: await loadI18n(locale) });
    const own = await loadMessages(locale);
    page.buttonByKey('lock').click();
    await page.settle();
    expect(page.text('toasts')).toBe(own.result.locked);
  });
});
