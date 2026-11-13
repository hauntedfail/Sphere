/**
 * Error categories, mirroring the `iqos` crate so messages stay comparable
 * with the CLI: transport, protocol encode/decode, unsupported, plus `usage`
 * for console argument mistakes.
 */
export type ErrorKind = 'transport' | 'encode' | 'decode' | 'unsupported' | 'usage';

export class SphereError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SphereError';
    this.kind = kind;
  }
}

export const transportError = (message: string, cause?: unknown): SphereError =>
  new SphereError('transport', message, cause);

export const encodeError = (message: string): SphereError => new SphereError('encode', message);

export const decodeError = (message: string): SphereError => new SphereError('decode', message);

export const unsupportedError = (message: string): SphereError =>
  new SphereError('unsupported', message);

export const usageError = (message: string): SphereError => new SphereError('usage', message);

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
