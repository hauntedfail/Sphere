import { describe, expect, it, vi } from 'vitest';
import { errorRef } from '../src/app/app';
import { parseCommand } from '../src/console/parse';
import { SphereError, describeError, usageError } from '../src/protocol/errors';
import { EMPTY_BOOK, normalizeLabel, validateLabel, withDevice } from '../src/storage/devices';
import { ENGLISH, bootI18n, createI18n } from '../src/i18n/i18n';
import { resolveLocale, withoutLanguageParameter } from '../src/i18n/locales';
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

describe('an error as a message', () => {
  it.each(['transport', 'encode', 'decode', 'unsupported'] as const)('reads like describeError for %s', (kind) => {
    const error = new SphereError(kind, 'detail text');
    expect(render(ENGLISH.t, errorRef(error))).toBe(describeError(error));
  });

  it('has no prefix for a mistake in a command', () => {
    expect(render(ENGLISH.t, errorRef(usageError('Usage: brightness [high|low]')))).toBe('Usage: brightness [high|low]');
  });

  it('is the message itself for any other error, and the value for anything else thrown', () => {
    expect(render(ENGLISH.t, errorRef(new Error('quota exceeded')))).toBe('quota exceeded');
    expect(render(ENGLISH.t, errorRef('odd'))).toBe('odd');
  });

  const full = Array.from({ length: 64 }, (_, index) => `d${index}`).reduce(
    (book, label) => withDevice(book, label, { id: label, name: label, model: 'iluma' }),
    EMPTY_BOOK,
  );

  it.each<[string, () => unknown]>([
    ['an empty label', () => normalizeLabel('  ')],
    ['a long label', () => validateLabel('x'.repeat(33))],
    ['a label with other characters', () => validateLabel('a!b')],
    ['a label that names a model', () => validateLabel('iluma-one')],
    ['one device too many', () => withDevice(full, 'more', { id: 'm', name: 'm', model: 'iluma' })],
    ['a label in two words', () => parseCommand('device save two words')],
  ])('says the same in English as the error it rides on: %s', (_name, act) => {
    let thrown: unknown;
    try {
      act();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SphereError);
    const error = thrown as SphereError;
    expect(error.ref).toBeDefined();
    expect(render(ENGLISH.t, errorRef(error))).toBe(error.message);
  });
});

describe('withoutLanguageParameter', () => {
  it('takes ?lang= off an address and leaves the rest', () => {
    expect(withoutLanguageParameter('https://sphere.test/?a=1&lang=ja#x')).toBe('https://sphere.test/?a=1#x');
    expect(withoutLanguageParameter('https://sphere.test/?lang=ja')).toBe('https://sphere.test/');
    expect(withoutLanguageParameter('https://sphere.test/dir/?lang=ko&b=2')).toBe('https://sphere.test/dir/?b=2');
  });

  it('returns an address without one unchanged', () => {
    expect(withoutLanguageParameter('https://sphere.test/?a=1#x')).toBe('https://sphere.test/?a=1#x');
    expect(withoutLanguageParameter('http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173/');
  });
});
