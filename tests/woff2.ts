import { brotliDecompressSync } from 'node:zlib';

/**
 * Which characters a WOFF2 font holds, read from the file itself: its `cmap`
 * table, the one a browser consults to find a glyph for a character.
 *
 * Only what that takes is read. The layout is the W3C's "WOFF File Format
 * 2.0" for the container and OpenType's `cmap` formats 4 and 12 for the
 * table, which is all the fonts shipped here use.
 */

/** The tags a WOFF2 table directory abbreviates to a number. Only `cmap`, `glyf` and `loca` matter here. */
const CMAP = 0;
const GLYF = 10;
const LOCA = 11;
const ARBITRARY_TAG = 63;
const HEADER_LENGTH = 48;

class Reader {
  private readonly view: DataView;
  offset: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  /** WOFF2's variable-length number: seven bits a byte, the top bit saying more follow. */
  base128(): number {
    let value = 0;
    for (let index = 0; index < 5; index++) {
      const byte = this.u8();
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('not a WOFF2 font: a length runs past five bytes');
  }
}

/** The `cmap` table of a WOFF2 file, decompressed. */
function cmapTable(file: Uint8Array): Uint8Array {
  if (file.length < HEADER_LENGTH || new TextDecoder().decode(file.subarray(0, 4)) !== 'wOF2') {
    throw new Error('not a WOFF2 font');
  }
  const header = new Reader(file, 4);
  if (header.u32() === 0x74746366) throw new Error('a font collection is not supported');
  header.u32(); // length
  const tableCount = header.u16();
  header.u16(); // reserved
  header.u32(); // totalSfntSize
  const compressedLength = header.u32();

  // The directory lists the tables in the order their bytes follow one
  // another once decompressed, each with the length it has there.
  const directory = new Reader(file, HEADER_LENGTH);
  let position = 0;
  let found: { offset: number; length: number } | undefined;
  for (let index = 0; index < tableCount; index++) {
    const flags = directory.u8();
    const tag = flags & 0x3f;
    if (tag === ARBITRARY_TAG) directory.u32();
    const transform = flags >> 6;
    const originalLength = directory.base128();
    // `glyf` and `loca` are stored transformed when the version is 0; any other table when it is not.
    const transformed = tag === GLYF || tag === LOCA ? transform === 0 : transform !== 0;
    const length = transformed ? directory.base128() : originalLength;
    if (tag === CMAP) found = { offset: position, length };
    position += length;
  }
  if (found === undefined) throw new Error('the font has no cmap table');

  const data = brotliDecompressSync(file.subarray(directory.offset, directory.offset + compressedLength));
  return data.subarray(found.offset, found.offset + found.length);
}

/** Format 4: runs of characters in the Basic Multilingual Plane. */
function readSegments(table: Uint8Array, start: number, into: Set<number>): void {
  const reader = new Reader(table, start + 6);
  const segmentCount = reader.u16() / 2;
  const ends = start + 14;
  const starts = ends + segmentCount * 2 + 2;
  const deltas = starts + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  const at = (offset: number): number => new Reader(table, offset).u16();

  for (let segment = 0; segment < segmentCount; segment++) {
    const first = at(starts + segment * 2);
    const last = at(ends + segment * 2);
    const delta = at(deltas + segment * 2);
    const rangeOffset = at(rangeOffsets + segment * 2);
    for (let point = first; point <= last && point < 0xffff; point++) {
      // Glyph 0 is the "missing" glyph: a character mapped to it is not held.
      const glyph =
        rangeOffset === 0
          ? (point + delta) & 0xffff
          : at(rangeOffsets + segment * 2 + rangeOffset + (point - first) * 2);
      if (glyph !== 0) into.add(point);
    }
  }
}

/** Format 12: runs of characters anywhere in Unicode. */
function readGroups(table: Uint8Array, start: number, into: Set<number>): void {
  const reader = new Reader(table, start + 12);
  const groupCount = reader.u32();
  for (let group = 0; group < groupCount; group++) {
    const first = reader.u32();
    const last = reader.u32();
    const firstGlyph = reader.u32();
    for (let point = first; point <= last; point++) {
      if (firstGlyph + (point - first) !== 0) into.add(point);
    }
  }
}

/** Every code point `file`, the bytes of a WOFF2 font, has a glyph for. */
export function codePointsOf(file: Uint8Array): ReadonlySet<number> {
  const table = cmapTable(file);
  const header = new Reader(table, 2);
  const subtableCount = header.u16();
  const points = new Set<number>();
  let read = 0;
  for (let index = 0; index < subtableCount; index++) {
    const platform = header.u16();
    const encoding = header.u16();
    const offset = header.u32();
    // Unicode, or Windows with a Unicode encoding. Anything else is a legacy table no browser prefers.
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = new Reader(table, offset).u16();
    if (format === 4) readSegments(table, offset, points);
    else if (format === 12) readGroups(table, offset, points);
    // Format 14 lists variation selectors, which add no characters of their own.
    else if (format !== 14) throw new Error(`cmap format ${format} is not supported`);
    read++;
  }
  if (read === 0) throw new Error('the font has no Unicode cmap');
  return points;
}
