/**
 * Single-frame settings: brightness, FlexPuff, FlexBattery, Pause Mode,
 * Smart Gesture, Auto Start and device lock.
 *
 * Addresses: `C0` is the charger (or the whole device on one-piece models),
 * `C9` the holder and `D2` the heating engine. Replies come back from `C0`,
 * `08` and `90` respectively.
 */
import { hasPrefix } from './bytes';
import { decodeError } from './errors';
import { classicFrame } from './scp';

// ── Brightness ──────────────────────────────────────────────────────────────

export type BrightnessLevel = 'high' | 'low';

const BRIGHTNESS_VALUE: Record<BrightnessLevel, number> = { high: 0x64, low: 0x1e };

export const LOAD_BRIGHTNESS = classicFrame(0xc0, 0x02, 0x23);

/** The three-frame write sequence for a brightness level. */
export function brightnessCommands(level: BrightnessLevel): Uint8Array[] {
  const value = BRIGHTNESS_VALUE[level];
  return [
    classicFrame(0xc0, 0x46, 0x23, [value, 0x00, 0x00, 0x00]),
    LOAD_BRIGHTNESS,
    classicFrame(0xc9, 0x44, 0x24, [value, 0x00, 0x00, 0x00]),
  ];
}

export function parseBrightness(frame: Uint8Array): BrightnessLevel {
  if (frame.length < 9) throw decodeError('invalid brightness response: frame too short');
  if (!hasPrefix(frame, [0x00, 0xc0, 0x86, 0x23])) {
    throw decodeError('invalid brightness response: header mismatch');
  }
  if (frame[4] === BRIGHTNESS_VALUE.high) return 'high';
  if (frame[4] === BRIGHTNESS_VALUE.low) return 'low';
  throw decodeError('invalid brightness response: unknown level flag');
}

export function parseBrightnessLevel(value: string): BrightnessLevel | null {
  const normalized = value.trim().toLowerCase();
  return normalized === 'high' || normalized === 'low' ? normalized : null;
}

// ── FlexPuff ────────────────────────────────────────────────────────────────

export const LOAD_FLEXPUFF = classicFrame(0xd2, 0x05, 0x22, [0x03, 0x00, 0x00, 0x00]);

export function flexpuffCommand(enabled: boolean): Uint8Array {
  return classicFrame(0xd2, 0x45, 0x22, [0x03, enabled ? 0x01 : 0x00, 0x00, 0x00]);
}

export function parseFlexpuff(frame: Uint8Array): boolean {
  if (frame.length < 9) throw decodeError('invalid FlexPuff response: frame too short');
  if (!hasPrefix(frame, [0x00, 0x90, 0x85, 0x22, 0x03])) {
    throw decodeError('invalid FlexPuff response: header mismatch');
  }
  return parseFlag(frame[5], 'FlexPuff');
}

// ── FlexBattery and Pause Mode ──────────────────────────────────────────────

export type FlexBatteryMode = 'performance' | 'eco';

export interface FlexBatterySettings {
  readonly mode: FlexBatteryMode;
  /** `undefined` leaves Pause Mode untouched on write. */
  readonly pause?: boolean;
}

export const LOAD_FLEXBATTERY = classicFrame(0xc9, 0x00, 0x25);
export const LOAD_PAUSEMODE = classicFrame(0xc9, 0x07, 0x24, [0x02, 0x00, 0x00, 0x00]);

export function flexbatteryModeCommand(mode: FlexBatteryMode): Uint8Array {
  return classicFrame(0xc9, 0x44, 0x25, [mode === 'eco' ? 0x01 : 0x00, 0x00, 0x00, 0x00]);
}

export function pauseModeCommand(enabled: boolean): Uint8Array {
  return classicFrame(0xc9, 0x47, 0x24, [0x02, enabled ? 0x01 : 0x00, 0x00, 0x00]);
}

export function parseFlexbatteryMode(frame: Uint8Array): FlexBatteryMode {
  if (frame.length < 9) throw decodeError('invalid FlexBattery response: frame too short');
  if (!hasPrefix(frame, [0x00, 0x08, 0x84, 0x25])) {
    throw decodeError('invalid FlexBattery response: header mismatch');
  }
  if (frame[4] === 0x00) return 'performance';
  if (frame[4] === 0x01) return 'eco';
  throw decodeError('invalid FlexBattery response: unknown mode byte');
}

export function parsePauseMode(frame: Uint8Array): boolean {
  return parseHolderSetting(frame, 0x02, 'Pause Mode');
}

// ── Smart Gesture and Auto Start ────────────────────────────────────────────

export function smartGestureCommand(enabled: boolean): Uint8Array {
  return classicFrame(0xc9, 0x47, 0x24, [0x04, enabled ? 0x01 : 0x00, 0x00, 0x00]);
}

export function autostartCommand(enabled: boolean): Uint8Array {
  return classicFrame(0xc9, 0x47, 0x24, [0x01, enabled ? 0x01 : 0x00, 0x00, 0x00]);
}

export const LOAD_AUTOSTART = classicFrame(0xc9, 0x07, 0x24, [0x01, 0x00, 0x00, 0x00]);

export function parseAutostart(frame: Uint8Array): boolean {
  return parseHolderSetting(frame, 0x01, 'Auto Start');
}

// ── Lock ────────────────────────────────────────────────────────────────────

const LOCK_READBACK = classicFrame(0xc9, 0x00, 0x04);
const CONFIRMATION = classicFrame(0xc0, 0x01, 0x00);

export function lockCommands(): Uint8Array[] {
  return [classicFrame(0xc9, 0x44, 0x04, [0x02, 0xff, 0x00, 0x00]), LOCK_READBACK, CONFIRMATION];
}

export function unlockCommands(): Uint8Array[] {
  return [classicFrame(0xc9, 0x44, 0x04, [0x00, 0x00, 0x00, 0x00]), LOCK_READBACK, CONFIRMATION];
}

// ── Shared parsers ──────────────────────────────────────────────────────────

/** Settings stored under identifier `24` on the holder: `00 08 87 24 <id> <flag>`. */
function parseHolderSetting(frame: Uint8Array, settingId: number, name: string): boolean {
  if (frame.length < 9) throw decodeError(`invalid ${name} response: frame too short`);
  if (!hasPrefix(frame, [0x00, 0x08, 0x87, 0x24])) {
    throw decodeError(`invalid ${name} response: header mismatch`);
  }
  if (frame[4] !== settingId) throw decodeError(`invalid ${name} response: setting ID mismatch`);
  return parseFlag(frame[5], name);
}

function parseFlag(value: number | undefined, name: string): boolean {
  if (value === 0x00) return false;
  if (value === 0x01) return true;
  throw decodeError(`invalid ${name} response: unknown flag byte`);
}
