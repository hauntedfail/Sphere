/** Build a byte array from literal values. */
export const u8 = (...values: number[]): Uint8Array => Uint8Array.from(values);

/** Format bytes as upper-case hex pairs: `00 C0 02 23 C3`. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0) out += ' ';
    out += (bytes[i] ?? 0).toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** Parse whitespace-separated hex pairs. Throws on anything else. */
export function fromHex(text: string): Uint8Array {
  const trimmed = text.trim();
  if (trimmed === '') return new Uint8Array();
  return Uint8Array.from(
    trimmed.split(/\s+/).map((pair) => {
      if (!/^[0-9a-fA-F]{2}$/.test(pair)) throw new RangeError(`not a hex byte: ${pair}`);
      return Number.parseInt(pair, 16);
    }),
  );
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

/** Read a little-endian u16. The caller has already checked the length. */
export function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

/** Printable ASCII with every other byte shown as `.`, as the CLI does. */
export function printableAscii(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
  }
  return out;
}

/** Copy into a fresh ArrayBuffer-backed array (what Web Bluetooth writes expect). */
export function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}
