/**
 * Errors and answers that the page can say in its own language. The text an
 * error or a console line carries is always English, made here from the
 * English dictionary, so the two cannot drift apart.
 */
import { ENGLISH } from '../i18n/i18n';
import { type MessageRef, render } from '../i18n/message';
import { type ErrorKind, SphereError } from '../protocol/errors';

/** The English for a message, as the console and the session log show it. */
export const english = (ref: MessageRef): string => render(ENGLISH.t, ref);

/** An error raised here, in the app, with its message. */
export function appError(kind: ErrorKind, ref: MessageRef, cause?: unknown): SphereError {
  return new SphereError(kind, english(ref), cause, ref);
}

/**
 * Any thrown value as a message, reading in English as `describeError` reads.
 * The kind of failure is always put into the language. What failed is too
 * when the error says so; the layers under the app describe it in English.
 */
export function errorRef(error: unknown): MessageRef {
  if (!(error instanceof SphereError)) {
    return { key: 'error.plain', params: { detail: error instanceof Error ? error.message : String(error) } };
  }
  if (error.kind === 'usage') return error.ref ?? { key: 'error.plain', params: { detail: error.message } };
  return { key: `error.${error.kind}`, params: { detail: error.ref ?? error.message } };
}
