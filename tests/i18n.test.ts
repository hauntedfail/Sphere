import { describe, expect, it, vi } from 'vitest';
import { ENGLISH, bootI18n, createI18n } from '../src/i18n/i18n';
import { resolveLocale } from '../src/i18n/locales';
import { render } from '../src/i18n/message';
import { type Messages, en } from '../src/i18n/messages/en';

describe('resolveLocale', () => {
  const pick = (query: string | null, saved: string | null, preferred: string[]) =>
    resolveLocale({ query, saved, preferred });

  it.each([
    [['ja'], 'ja'],
    [['ja-JP'], 'ja'],
    [['zh'], 'zh-Hans'],
    [['zh-CN'], 'zh-Hans'],
    [['zh-SG'], 'zh-Hans'],
    [['zh-Hans-HK'], 'zh-Hans'],
    [['zh-TW'], 'zh-Hant'],
    [['zh-HK'], 'zh-Hant'],
    [['zh-MO'], 'zh-Hant'],
    [['zh-Hant-CN'], 'zh-Hant'],
    [['ko-KR'], 'ko'],
    [['ru'], 'ru'],
    [['it-CH'], 'it'],
    [['en-GB'], 'en'],
    [['fr', 'de'], 'en'],
    [[], 'en'],
    [['C'], 'en'],
    [['', 'x-bad-', 'ko'], 'ko'],
    [['fr-FR', 'it'], 'it'],
    [['en-US-u-ca-gregory'], 'en'],
  ])('reads %j as %s', (preferred, expected) => {
    expect(pick(null, null, preferred)).toBe(expected);
  });

  it('lets ?lang= win over the saved choice, and the saved choice over the browser', () => {
    expect(pick('ko', 'ja', ['ru'])).toBe('ko');
    expect(pick(null, 'ja', ['ru'])).toBe('ja');
    expect(pick('ZH-hant', null, [])).toBe('zh-Hant');
  });

  it('ignores a ?lang= or a saved value it does not know', () => {
    expect(pick('xx', 'ja', ['ru'])).toBe('ja');
    // `?lang=` takes a code from the list, not any tag a browser might send.
    expect(pick('ja-JP', null, ['ru'])).toBe('ru');
    expect(pick(null, '{"x":1}', ['ru'])).toBe('ru');
  });
});

describe('createI18n', () => {
  it('fills a parameter without escaping it', () => {
    expect(ENGLISH.t('error.transport', { detail: 'a < b & "c"' })).toBe('transport error: a < b & "c"');
  });

  it('leaves braces and $t() in a parameter as text', () => {
    expect(ENGLISH.t('error.transport', { detail: '{{x}} $t(page.lede)' })).toBe(
      'transport error: {{x}} $t(page.lede)',
    );
  });

  it('falls back to English for a key the language lacks', () => {
    const partial = { ...en, page: { ...en.page, lede: undefined } } as unknown as Messages;
    expect(createI18n('ja', partial).t('page.lede')).toBe(en.page.lede);
  });

  it('says which language it speaks', () => {
    expect(ENGLISH.locale).toBe('en');
    expect(createI18n('ko', en).locale).toBe('ko');
  });

  it('writes nothing to the console', () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    createI18n('ja', en).t('page.lede');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('bootI18n', () => {
  it('loads the language the visitor asked for', async () => {
    const loaded = await bootI18n({ query: 'ja', saved: null, preferred: [] }, async (locale) => ({
      ...ENGLISH,
      locale,
    }));
    expect(loaded.locale).toBe('ja');
  });

  it('opens in English when the dictionary cannot be loaded', async () => {
    const loaded = await bootI18n({ query: 'ja', saved: null, preferred: [] }, () =>
      Promise.reject(new Error('offline')),
    );
    expect(loaded).toBe(ENGLISH);
  });
});

describe('render', () => {
  it('resolves a nested message before the outer one', () => {
    expect(render(ENGLISH.t, { key: 'error.transport', params: { detail: { key: 'page.lede' } } })).toBe(
      `transport error: ${en.page.lede}`,
    );
  });

  it('passes plain parameters through', () => {
    expect(render(ENGLISH.t, { key: 'error.transport', params: { detail: 'no answer' } })).toBe(
      'transport error: no answer',
    );
  });
});
