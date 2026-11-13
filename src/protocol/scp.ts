/**
 * SCP framing: the request/response protocol IQOS devices speak over their
 * control characteristic.
 *
 * A complete frame is `00 <address> <header> ...`:
 *
 * - classic:  `00 addr header id [payload] crc8`, where header bits 2-3 select
 *   a fixed payload length of 0, 4, 14 or 24 bytes;
 * - extended: `00 addr header len <len bytes> crc16-le`, flagged by header
 *   bit 4.
 *
 * Header bit 7 marks a response and bit 5 a device-reported error. The leading
 * `00` is the BLE fragment countdown of a frame that fits in one write; longer
 * frames are split into 20-byte writes whose first byte counts down to zero.
 *
 * Ported from `src/protocol/scp.rs` of the `iqos` crate.
 */
import { toHex } from './bytes';
import { decodeError, encodeError } from './errors';

const CRC8_POLYNOMIAL = 0x07;
const CRC16_OPENSAFETY_B_POLYNOMIAL = 0x755b;

const EXTENDED_FLAG = 0x10;
const RESPONSE_FLAG = 0x80;
const ERROR_FLAG = 0x20;

/** Classic payload length selected by header bits 2-3. */
const CLASSIC_PAYLOAD_LENGTHS = [0, 4, 14, 24] as const;

/** Largest frame the one-byte extended length field can describe. */
export const MAX_FRAME_LENGTH = 261;

const FRAGMENT_LENGTH = 20;

export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ CRC8_POLYNOMIAL) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc =
        crc & 0x8000 ? ((crc << 1) ^ CRC16_OPENSAFETY_B_POLYNOMIAL) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function classicPayloadLength(header: number): number {
  return CLASSIC_PAYLOAD_LENGTHS[(header >> 2) & 3] ?? 0;
}

/** Build a classic frame, computing the trailing CRC-8. */
export function classicFrame(
  address: number,
  header: number,
  id: number,
  payload: readonly number[] = [],
): Uint8Array {
  const expected = classicPayloadLength(header);
  if (header & EXTENDED_FLAG || payload.length !== expected) {
    throw encodeError(
      `classic header 0x${header.toString(16)} needs ${expected} payload bytes, got ${payload.length}`,
    );
  }
  const body = Uint8Array.from([header, id, ...payload]);
  return Uint8Array.from([0x00, address, ...body, crc8(body)]);
}

/** Build an extended frame, computing the length byte and trailing CRC-16. */
export function extendedFrame(
  address: number,
  header: number,
  payload: readonly number[],
): Uint8Array {
  if (!(header & EXTENDED_FLAG) || payload.length > 0xff) {
    throw encodeError(`invalid extended frame: header 0x${header.toString(16)}, ${payload.length} bytes`);
  }
  const body = Uint8Array.from([header, payload.length, ...payload]);
  const crc = crc16(body);
  return Uint8Array.from([0x00, address, ...body, crc & 0xff, crc >> 8]);
}

/** Whether a frame uses the length-delimited CRC-16 format. */
export function usesCrc16(frame: Uint8Array): boolean {
  const header = frame[2];
  return header !== undefined && (header & EXTENDED_FLAG) !== 0;
}

/** Return a length/checksum problem, or `null` for a well-formed frame. */
export function frameError(frame: Uint8Array): string | null {
  if (frame[0] !== 0x00) return 'SCP frame has not been reassembled';
  if (usesCrc16(frame)) return crc16Error(frame);

  if (frame.length < 5) return 'SCP frame is too short for CRC-8';

  const expectedLength = 5 + classicPayloadLength(frame[2] ?? 0);
  if (frame.length !== expectedLength) {
    return `invalid SCP classic frame length: expected ${expectedLength}, got ${frame.length}`;
  }

  const expected = frame[frame.length - 1] ?? 0;
  const actual = crc8(frame.subarray(2, frame.length - 1));
  return actual === expected
    ? null
    : `invalid SCP CRC-8: expected 0x${hexByte(expected)}, calculated 0x${hexByte(actual)}, frame ${toHex(frame)}`;
}

function crc16Error(frame: Uint8Array): string | null {
  if (frame.length < 6) return 'SCP CRC-16 frame is too short';

  const payloadLength = frame[3] ?? 0;
  const checksumOffset = 4 + payloadLength;
  const expectedLength = checksumOffset + 2;
  if (frame.length !== expectedLength) {
    return `invalid SCP CRC-16 frame length: header declares ${payloadLength} payload bytes, expected ${expectedLength} total bytes, got ${frame.length}`;
  }

  const expected = (frame[checksumOffset] ?? 0) | ((frame[checksumOffset + 1] ?? 0) << 8);
  const actual = crc16(frame.subarray(2, checksumOffset));
  return actual === expected
    ? null
    : `invalid SCP CRC-16: expected 0x${hexWord(expected)}, calculated 0x${hexWord(actual)}, frame ${toHex(frame)}`;
}

/** Validate a complete response before anything interprets its payload. */
export function responseError(frame: Uint8Array): string | null {
  const error = frameError(frame);
  if (error !== null) return error;

  const header = frame[2] ?? 0;
  if (!(header & RESPONSE_FLAG)) return 'SCP frame is not a response';
  if (header & ERROR_FLAG) {
    const trailer = usesCrc16(frame) ? 2 : 1;
    return `SCP device error: ${toHex(frame.subarray(4, frame.length - trailer))}`;
  }
  return null;
}

function classicIdentity(frame: Uint8Array): number | null {
  if (frame.length < 4) return null;
  return ((frame[2] ?? 0) & 3) | ((frame[3] ?? 0) << 2);
}

/**
 * Compare the command identity shared by a request and its response.
 *
 * The reply address differs from the request address (`C9` answers as `08`),
 * so only the header and identifier bits take part.
 */
export function headersMatch(command: Uint8Array, response: Uint8Array): boolean {
  const responseHeader = response[2];
  if (responseHeader === undefined || !(responseHeader & RESPONSE_FLAG)) return false;
  if (usesCrc16(command) !== usesCrc16(response)) return false;

  if (usesCrc16(command)) {
    return (
      command.length >= 8 &&
      response.length >= 8 &&
      ((command[2] ?? 0) & 0x1f) === (responseHeader & 0x1f) &&
      command[4] === response[4] &&
      command[5] === response[5]
    );
  }

  const request = classicIdentity(command);
  return request !== null && request === classicIdentity(response);
}

/** Split a validated frame into the GATT writes that carry it. */
export function fragment(command: Uint8Array): Uint8Array[] {
  const error = frameError(command);
  if (error !== null) throw encodeError(error);

  const body = command.subarray(1);
  const chunkSize = FRAGMENT_LENGTH - 1;
  const count = Math.ceil(body.length / chunkSize);
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const part = body.subarray(index * chunkSize, (index + 1) * chunkSize);
    chunks.push(Uint8Array.from([count - index - 1, ...part]));
  }
  return chunks;
}

/**
 * Reassemble countdown-prefixed notifications into complete frames.
 *
 * A notification that starts with `00` outside a countdown is already a whole
 * frame (devices that negotiate a large MTU send those). Discard or `reset()`
 * the instance after an error.
 */
export class FrameAssembler {
  private parts: number[] = [];
  private remaining: number | null = null;

  push(chunk: Uint8Array): Uint8Array | null {
    const countdown = chunk[0];
    if (countdown === undefined) throw decodeError('empty BLE fragment');

    if (this.remaining === null && countdown === 0) {
      if (chunk.length > MAX_FRAME_LENGTH) throw decodeError('oversized BLE frame');
      return Uint8Array.from(chunk);
    }

    const outOfOrder = this.remaining !== null && this.remaining - 1 !== countdown;
    if (
      chunk.length < 2 ||
      chunk.length > FRAGMENT_LENGTH ||
      (countdown > 0 && chunk.length !== FRAGMENT_LENGTH) ||
      outOfOrder
    ) {
      this.reset();
      throw decodeError('invalid BLE fragment length or countdown');
    }

    if (this.parts.length === 0) this.parts.push(0x00);
    for (let i = 1; i < chunk.length; i++) this.parts.push(chunk[i] ?? 0);
    if (this.parts.length > MAX_FRAME_LENGTH) {
      this.reset();
      throw decodeError('oversized BLE frame');
    }

    if (countdown > 0) {
      this.remaining = countdown;
      return null;
    }

    const frame = Uint8Array.from(this.parts);
    this.reset();
    return frame;
  }

  reset(): void {
    this.parts = [];
    this.remaining = null;
  }
}

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');
const hexWord = (value: number): string => value.toString(16).padStart(4, '0');
