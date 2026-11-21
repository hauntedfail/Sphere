/**
 * A message that has not been put into a language yet: its key and what goes
 * into it. The app records these, and the page turns them into text in
 * whatever language is showing when it draws them.
 */
import type { Translate } from './i18n';
import type { MessageKey } from './messages/en';

export type MessageParams = Readonly<Record<string, string | number | MessageRef>>;

export interface MessageRef {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

/** A parameter that is itself a message is put into the language first. */
export function render(t: Translate, ref: MessageRef): string {
  const params = Object.fromEntries(
    Object.entries(ref.params ?? {}).map(([name, value]) => [
      name,
      typeof value === 'object' ? render(t, value) : value,
    ]),
  );
  return t(ref.key, params);
}
