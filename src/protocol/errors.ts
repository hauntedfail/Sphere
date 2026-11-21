/**
 * Error categories, mirroring the `iqos` crate so messages stay comparable
 * with the CLI: transport, protocol encode/decode, unsupported, plus `usage`
 * for console argument mistakes.
 */
import type { MessageRef } from '../i18n/message';

export type ErrorKind = 'transport' | 'encode' | 'decode' | 'unsupported' | 'usage';

export class SphereError extends Error {
  readonly kind: ErrorKind;
  /**
   * The same thing as `message`, as a message the page can put into its own
   * language. Only errors a control can run into carry one; `message` stays
   * English, for the console and the session log.
   */
  readonly ref?: MessageRef;

  constructor(kind: ErrorKind, message: string, cause?: unknown, ref?: MessageRef) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SphereError';
    this.kind = kind;
    if (ref !== undefined) this.ref = ref;
  }
}

export const transportError = (message: string, cause?: unknown): SphereError =>
  new SphereError('transport', message, cause);

export const encodeError = (message: string): SphereError => new SphereError('encode', message);

export const decodeError = (message: string): SphereError => new SphereError('decode', message);

export const unsupportedError = (message: string): SphereError =>
  new SphereError('unsupported', message);

export const usageError = (message: string, ref?: MessageRef): SphereError =>
  new SphereError('usage', message, undefined, ref);

const KIND_PREFIX: Record<ErrorKind, string> = {
  transport: 'transport error: ',
  encode: 'protocol encode error: ',
  decode: 'protocol decode error: ',
  unsupported: 'unsupported operation: ',
  usage: '',
};

/** Render any thrown value as one line of user-facing text. */
export function describeError(error: unknown): string {
  if (error instanceof SphereError) return `${KIND_PREFIX[error.kind]}${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
