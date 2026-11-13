import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from '../src/protocol/bytes';
import { SphereError } from '../src/protocol/errors';
import {
  FrameAssembler,
  classicFrame,
  crc16,
  crc8,
  extendedFrame,
  fragment,
  frameError,
  headersMatch,
  responseError,
  usesCrc16,
} from '../src/protocol/scp';

describe('checksums', () => {
  it('computes CRC-8 (poly 0x07, init 0x00) over the frame body', () => {
    expect(crc8(fromHex('02 23'))).toBe(0xc3);
    expect(crc8(fromHex('01 00'))).toBe(0x15);
    expect(crc8(fromHex('47 24 04 01 00 00'))).toBe(0x71);
    expect(crc8(new Uint8Array())).toBe(0);
  });

  it('computes CRC-16/OPENSAFETY-B over extended frames', () => {
    expect(crc16(fromHex('10 02 01 01'))).toBe(0xd675);
    expect(crc16(fromHex('10 02 00 04'))).toBe(0xef38);
  });
});

describe('frame builders', () => {
  it('builds classic frames with a trailing CRC-8', () => {
    expect(toHex(classicFrame(0xc0, 0x02, 0x23))).toBe('00 C0 02 23 C3');
    expect(toHex(classicFrame(0xc9, 0x47, 0x24, [0x04, 0x01, 0x00, 0x00]))).toBe(
      '00 C9 47 24 04 01 00 00 71',
    );
  });

  it('builds extended frames with a little-endian CRC-16', () => {
    expect(toHex(extendedFrame(0xc9, 0x10, [0x01, 0x01]))).toBe('00 C9 10 02 01 01 75 D6');
    expect(toHex(extendedFrame(0xc0, 0x10, [0x00, 0x04]))).toBe('00 C0 10 02 00 04 38 EF');
  });

  it('rejects a payload whose length disagrees with the header', () => {
    expect(() => classicFrame(0xc0, 0x02, 0x23, [0x01])).toThrow(SphereError);
    expect(() => extendedFrame(0xc0, 0x10, new Array<number>(256).fill(0))).toThrow(SphereError);
  });
});

describe('frameError', () => {
  it('accepts valid classic and extended frames', () => {
    expect(frameError(fromHex('00 C0 02 23 C3'))).toBeNull();
    expect(frameError(fromHex('00 08 87 24 01 01 00 00 A5'))).toBeNull();
    expect(frameError(fromHex('00 08 D0 02 00 04 E6 19'))).toBeNull();
    expect(frameError(fromHex('00 08 90 0A 00 04 DA 07 01 01 56 D8 FF 1C C5 7C'))).toBeNull();
  });

  it('rejects frames that were not reassembled', () => {
    expect(frameError(fromHex('01 C9 4F 04 5B'))).toMatch(/reassembled/);
    expect(frameError(new Uint8Array())).toMatch(/reassembled/);
  });

  it('rejects a wrong CRC-8', () => {
    expect(frameError(fromHex('00 C0 01 00 F6'))).toMatch(/CRC-8/);
  });

  it('rejects a classic frame whose length disagrees with its header', () => {
    expect(frameError(fromHex('00 C0 00 00 00 00 00'))).toMatch(/length/);
    expect(frameError(fromHex('00 C0 02'))).toMatch(/too short/);
  });

  it('rejects extended frames with a bad length or CRC-16', () => {
    expect(frameError(fromHex('00 C9 10 02 01 01 75'))).toMatch(/length/);
    expect(frameError(fromHex('00 C9 10 02 01 01 75 D7'))).toMatch(/CRC-16/);
    expect(frameError(fromHex('00 C9 10 02 01'))).toMatch(/too short/);
  });
});

describe('usesCrc16', () => {
  it('follows header bit 4', () => {
    expect(usesCrc16(fromHex('00 C9 10 02 01 01 75 D6'))).toBe(true);
    expect(usesCrc16(fromHex('00 08 D0 02 00 04 E6 19'))).toBe(true);
    expect(usesCrc16(fromHex('00 C0 02 23 C3'))).toBe(false);
    expect(usesCrc16(fromHex('00 C0'))).toBe(false);
  });
});

describe('responseError', () => {
  it('accepts a valid response', () => {
    expect(responseError(fromHex('00 C0 86 23 64 00 00 00 D5'))).toBeNull();
  });

  it('rejects a frame without the response bit', () => {
    expect(responseError(fromHex('00 C0 02 23 C3'))).toMatch(/not a response/);
  });

  it('reports a device error flag', () => {
    const frame = classicFrame(0x08, 0xa4, 0x23, [0x01, 0x00, 0x00, 0x00]);
    expect(responseError(frame)).toMatch(/device error/i);
  });

  it('reports checksum problems first', () => {
    expect(responseError(fromHex('00 C0 86 23 64 00 00 00 D6'))).toMatch(/CRC-8/);
  });
});

describe('headersMatch', () => {
  it('matches a classic response to its request regardless of the reply address', () => {
    expect(headersMatch(fromHex('00 C0 02 23 C3'), fromHex('00 C0 86 23 64 00 00 00 D5'))).toBe(true);
    expect(headersMatch(fromHex('00 C9 00 25 FB'), fromHex('00 08 84 25 00 00 00 00 C1'))).toBe(true);
    expect(
      headersMatch(fromHex('00 C9 07 24 01 00 00 00 22'), fromHex('00 08 87 24 01 01 00 00 A5')),
    ).toBe(true);
  });

  it('rejects a response to a different command', () => {
    expect(headersMatch(fromHex('00 C0 02 23 C3'), fromHex('00 08 84 23 10 00 01 11 8F'))).toBe(false);
    expect(headersMatch(fromHex('00 C9 00 25 FB'), fromHex('00 08 84 24 64 00 00 00 AE'))).toBe(false);
  });

  it('rejects frames that are not responses', () => {
    expect(headersMatch(fromHex('00 C0 02 23 C3'), fromHex('00 C0 02 23 C3'))).toBe(false);
    expect(headersMatch(fromHex('00 C0 02 23 C3'), fromHex('00 C0'))).toBe(false);
  });

  it('matches extended frames on header bits and data identifier', () => {
    const request = fromHex('00 C9 10 02 00 04 38 EF');
    expect(headersMatch(request, fromHex('00 08 90 0A 00 04 DA 07 01 01 56 D8 FF 1C C5 7C'))).toBe(true);
    expect(headersMatch(request, fromHex('00 08 90 0B 00 01 02 00 00 01 01 02 00 01 00 DC 23'))).toBe(false);
    expect(headersMatch(request, fromHex('00 08 84 25 00 00 00 00 C1'))).toBe(false);
  });
});

describe('fragment', () => {
  it('sends a short frame as one write', () => {
    const chunks = fragment(fromHex('00 C0 02 23 C3'));
    expect(chunks.map(toHex)).toEqual(['00 C0 02 23 C3']);
  });

  it('splits long frames into 20-byte writes with a countdown prefix', () => {
    const frame = classicFrame(0xc9, 0x4f, 0x04, [0x5b, 0x04, 0x00, 0xff, 0xff, 0xff, ...new Array<number>(18).fill(0)]);
    const chunks = fragment(frame);
    expect(chunks.map(toHex)).toEqual([
      '01 C9 4F 04 5B 04 00 FF FF FF 00 00 00 00 00 00 00 00 00 00',
      '00 00 00 00 00 00 00 00 00 06',
    ]);
  });

  it('refuses to send an invalid frame', () => {
    expect(() => fragment(fromHex('00 C0 01 00 F6'))).toThrow(SphereError);
  });
});

describe('FrameAssembler', () => {
  it('passes through an atomic notification', () => {
    const assembler = new FrameAssembler();
    const frame = fromHex('00 C0 86 23 64 00 00 00 D5');
    expect(toHex(assembler.push(frame)!)).toBe(toHex(frame));
  });

  it('reassembles countdown fragments', () => {
    const assembler = new FrameAssembler();
    expect(assembler.push(fromHex('01 C9 4F 04 5B 04 00 FF FF FF 00 00 00 00 00 00 00 00 00 00'))).toBeNull();
    const frame = assembler.push(fromHex('00 00 00 00 00 00 00 00 00 06'));
    expect(frame).not.toBeNull();
    expect(frame!.length).toBe(29);
    expect(frameError(frame!)).toBeNull();
  });

  it('round-trips fragment output', () => {
    const frame = extendedFrame(0x08, 0x90, new Array<number>(62).fill(0x5a));
    const assembler = new FrameAssembler();
    let out: Uint8Array | null = null;
    for (const chunk of fragment(frame)) out = assembler.push(chunk);
    expect(toHex(out!)).toBe(toHex(frame));
  });

  it('rejects empty, oversized and out-of-order fragments', () => {
    expect(() => new FrameAssembler().push(new Uint8Array())).toThrow(SphereError);
    expect(() => new FrameAssembler().push(new Uint8Array(262))).toThrow(SphereError);
    expect(() => new FrameAssembler().push(fromHex('02 01'))).toThrow(SphereError);

    const assembler = new FrameAssembler();
    assembler.push(new Uint8Array(20).fill(0x03, 0, 1));
    expect(() => assembler.push(new Uint8Array(20).fill(0x01, 0, 1))).toThrow(SphereError);
  });

  it('starts clean after reset', () => {
    const assembler = new FrameAssembler();
    assembler.push(new Uint8Array(20).fill(0x01, 0, 1));
    assembler.reset();
    const frame = fromHex('00 C0 86 23 64 00 00 00 D5');
    expect(toHex(assembler.push(frame)!)).toBe(toHex(frame));
  });
});
