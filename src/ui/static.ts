/**
 * The words written into index.html. Each element that carries one names its
 * message in an attribute, and this puts the message into the page as text.
 */
import type { Translate } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages/en';

/**
 * Fill every element under `root` that names a message: `data-i18n` for its
 * text, `data-i18n-aria-label` for the name a screen reader gives it.
 *
 * The keys come from markup, which the compiler cannot check. A test holds
 * each of them against the dictionary instead.
 */
export function applyStaticText(root: ParentNode, t: Translate): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset['i18n'] as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset['i18nAriaLabel'] as MessageKey));
  }
}
