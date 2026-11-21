// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { type Messages, en } from '../src/i18n/messages/en';
import { applyStaticText } from '../src/ui/static';
import { BODY, connectedPage, openPage } from './ui-page';

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
