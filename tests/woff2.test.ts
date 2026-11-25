import { describe, expect, it } from 'vitest';
import { cmapCodePoints } from './woff2';

/**
 * The `cmap` reader behind tests/fonts.test.ts, on tables made by hand, for
 * the cases the shipped fonts do not happen to contain.
 */

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number): number[] => [...u16(value >>> 16), ...u16(value & 0xffff)];

interface Segment {
  readonly first: number;
  readonly last: number;
  readonly delta: number;
  /** Raw `idRangeOffset`; 0 maps by `delta` alone. */
  readonly rangeOffset: number;
}

/** A format 4 subtable: the segments, the closing 0xFFFF one, then `glyphs`. */
function format4(segments: readonly Segment[], glyphs: readonly number[] = []): number[] {
  const all = [...segments, { first: 0xffff, last: 0xffff, delta: 1, rangeOffset: 0 }];
  const body = [
    ...u16(all.length * 2),
    ...u16(0), // searchRange, entrySelector, rangeShift: not read
    ...u16(0),
    ...u16(0),
    ...all.flatMap((segment) => u16(segment.last)),
    ...u16(0),
    ...all.flatMap((segment) => u16(segment.first)),
    ...all.flatMap((segment) => u16(segment.delta & 0xffff)),
    ...all.flatMap((segment) => u16(segment.rangeOffset)),
    ...glyphs.flatMap(u16),
  ];
  return [...u16(4), ...u16(body.length + 6), ...u16(0), ...body];
}

/** A format 12 subtable with no groups. */
const emptyFormat12 = (): number[] => [...u16(12), ...u16(0), ...u32(16), ...u32(0), ...u32(0)];

/** A `cmap` table holding `subtables`, each under Windows Unicode BMP. */
function cmap(...subtables: number[][]): Uint8Array {
  let offset = 4 + subtables.length * 8;
  const records: number[] = [];
  for (const subtable of subtables) {
    records.push(...u16(3), ...u16(1), ...u32(offset));
    offset += subtable.length;
  }
  return new Uint8Array([...u16(0), ...u16(subtables.length), ...records, ...subtables.flat()]);
}

describe('cmap format 4', () => {
  it('maps a run by its delta, and leaves out what lands on glyph 0', () => {
    const table = cmap(format4([{ first: 0x41, last: 0x43, delta: -0x42, rangeOffset: 0 }]));
    expect([...cmapCodePoints(table)]).toEqual([0x41, 0x43]);
  });

  it('adds the delta to a glyph from the array, but leaves a 0 there missing', () => {
    // Two segments then the closing one: the array starts 6 bytes after the first idRangeOffset.
    const table = cmap(
      format4(
        [
          { first: 0x41, last: 0x43, delta: -1, rangeOffset: 6 },
          { first: 0x61, last: 0x61, delta: 5, rangeOffset: 0 },
        ],
        // 1 - 1 is glyph 0; 0 stays missing whatever the delta; 3 - 1 is glyph 2.
        [1, 0, 3],
      ),
    );
    expect([...cmapCodePoints(table)].sort((a, b) => a - b)).toEqual([0x43, 0x61]);
  });

  it('reads nothing past the end of its own subtable', () => {
    // One segment and the closing one make 32 bytes with no glyph array. An
    // idRangeOffset of 4 points at byte 32: the format of the next subtable.
    const table = cmap(format4([{ first: 0x41, last: 0x41, delta: 0, rangeOffset: 4 }]), emptyFormat12());
    expect(() => cmapCodePoints(table)).toThrow(/past its subtable/);
  });
});
