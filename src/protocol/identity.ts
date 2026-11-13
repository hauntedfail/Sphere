/**
 * Read-only identity and health data: firmware versions, product numbers,
 * diagnostic telemetry, and the vendor battery characteristic.
 */
import { hasPrefix, printableAscii, u16le } from './bytes';
import { decodeError } from './errors';
import { classicFrame, extendedFrame, usesCrc16 } from './scp';

/** `stick` is the charger or one-piece device (`C0`); `holder` is `C9`. */
export type ComponentKind = 'stick' | 'holder';

const REPLY_ADDRESS: Record<ComponentKind, number> = { stick: 0xc0, holder: 0x08 };

// ── Firmware ────────────────────────────────────────────────────────────────

export interface FirmwareVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly year: number;
}

export const LOAD_STICK_FIRMWARE = classicFrame(0xc0, 0x00, 0x00);
export const LOAD_HOLDER_FIRMWARE = classicFrame(0xc9, 0x00, 0x00);

export function firmwareCommand(kind: ComponentKind): Uint8Array {
  return kind === 'stick' ? LOAD_STICK_FIRMWARE : LOAD_HOLDER_FIRMWARE;
}

export function parseFirmware(frame: Uint8Array, kind: ComponentKind): FirmwareVersion {
  if (frame.length < 10) throw decodeError('invalid firmware response: frame too short');
  if (!hasPrefix(frame, [0x00, REPLY_ADDRESS[kind], 0x88, 0x00])) {
    throw decodeError('invalid firmware response: header mismatch');
  }
  return {
    major: frame[6] ?? 0,
    minor: frame[7] ?? 0,
    patch: frame[8] ?? 0,
    year: frame[9] ?? 0,
  };
}

export function formatFirmware(version: FirmwareVersion): string {
  return `v${version.major}.${version.minor}.${version.patch}.${version.year}`;
}

// ── Product number ──────────────────────────────────────────────────────────

export const LOAD_PRODUCT_NUMBER = classicFrame(0xc0, 0x00, 0x03);
export const LOAD_HOLDER_PRODUCT_NUMBER = classicFrame(0xc9, 0x00, 0x03);

export function productNumberCommand(kind: ComponentKind): Uint8Array {
  return kind === 'stick' ? LOAD_PRODUCT_NUMBER : LOAD_HOLDER_PRODUCT_NUMBER;
}

/** Decode a product number; the trailing CRC byte is not part of it. */
export function parseProductNumber(frame: Uint8Array, kind: ComponentKind): string {
  const prefix = [0x00, REPLY_ADDRESS[kind], 0x88, 0x03];
  if (frame.length < prefix.length) {
    throw decodeError('invalid product number response: frame too short');
  }
  if (!hasPrefix(frame, prefix)) {
    throw decodeError('invalid product number response: header mismatch');
  }
  if (frame.length <= prefix.length + 1) {
    throw decodeError('invalid product number response: missing payload');
  }
  return printableAscii(frame.subarray(prefix.length, frame.length - 1));
}

// ── Diagnosis ───────────────────────────────────────────────────────────────

/** Extended read of the `01 01` telemetry records, addressed to the holder. */
export const LOAD_TELEMETRY = extendedFrame(0xc9, 0x10, [0x01, 0x01]);
/** Extended read of the raw device clock. */
export const LOAD_DEVICE_TIME = extendedFrame(0xc0, 0x10, [0x00, 0x04]);
/** Classic read `0x084`, the frame the CLI decodes as battery voltage. */
export const LOAD_LIFE_DATA = classicFrame(0xc0, 0x00, 0x21);

/** The diagnostic read sequence, in the order the CLI sends it. */
export const DIAGNOSIS_COMMANDS: readonly Uint8Array[] = [
  LOAD_TELEMETRY,
  LOAD_DEVICE_TIME,
  LOAD_TELEMETRY,
  LOAD_LIFE_DATA,
];

const TELEMETRY_RECORD_SIZE = 8;
const TAG_PUFF_COUNT = 0x8e;
const TAG_DAY_COUNTER = 0x17;

/**
 * Diagnostic data.
 *
 * `puffCount`, `daysUsed` and `batteryVoltage` use the CLI's decoding of
 * these frames. Upstream treats that interpretation as unverified, so the raw
 * records are kept alongside for anyone who wants to check.
 */
export interface Diagnosis {
  readonly puffCount?: number;
  readonly daysUsed?: number;
  readonly batteryVoltage?: number;
  readonly telemetryRecords: readonly Uint8Array[];
  readonly deviceTimeRaw?: Uint8Array;
}

export const EMPTY_DIAGNOSIS: Diagnosis = { telemetryRecords: [] };

/** Fold one validated response frame into the diagnosis collected so far. */
export function applyDiagnosisFrame(current: Diagnosis, frame: Uint8Array): Diagnosis {
  if (frame.length < 4) throw decodeError('diagnosis response too short for header');

  if (usesCrc16(frame)) {
    if (frame.length < 8) throw decodeError('missing extended data identifier');
    const payload = frame.subarray(6, frame.length - 2);
    if (frame[4] === 0x01 && frame[5] === 0x01) return applyTelemetry(current, payload);
    if (frame[4] === 0x00 && frame[5] === 0x04) {
      return { ...current, deviceTimeRaw: Uint8Array.from(payload) };
    }
    return current;
  }

  if (isLifeData(frame)) return { ...current, batteryVoltage: parseBatteryVoltage(frame) };
  return current;
}

function applyTelemetry(current: Diagnosis, payload: Uint8Array): Diagnosis {
  if (payload.length % TELEMETRY_RECORD_SIZE !== 0) throw decodeError('partial telemetry record');

  const records: Uint8Array[] = [];
  let { puffCount, daysUsed } = current;
  for (let offset = 0; offset < payload.length; offset += TELEMETRY_RECORD_SIZE) {
    const record = Uint8Array.from(payload.subarray(offset, offset + TELEMETRY_RECORD_SIZE));
    records.push(record);
    const value = u16le(record, 4);
    if (record[7] === TAG_PUFF_COUNT) puffCount = value;
    if (record[7] === TAG_DAY_COUNTER) daysUsed = value;
  }

  return {
    ...current,
    telemetryRecords: records,
    ...(puffCount === undefined ? {} : { puffCount }),
    ...(daysUsed === undefined ? {} : { daysUsed }),
  };
}

function isLifeData(frame: Uint8Array): boolean {
  return ((frame[2] ?? 0) & 3) === 0 && frame[3] === 0x21;
}

/** Decode the life-data frame as volts, the way the CLI does. */
export function parseBatteryVoltage(frame: Uint8Array): number {
  if (frame.length < 7 || !isLifeData(frame)) {
    throw decodeError('invalid battery voltage frame');
  }
  return u16le(frame, 5) / 1000;
}

// ── Battery characteristic ──────────────────────────────────────────────────

/** Charge percentage from the vendor battery characteristic. */
export function parseBatteryLevel(value: Uint8Array): number {
  const level = value[2];
  if (level === undefined || level > 100) throw decodeError('invalid battery percentage');
  return level;
}
