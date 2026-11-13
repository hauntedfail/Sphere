import { bytesEqual, hasPrefix } from './bytes';
import { decodeError, encodeError, unsupportedError } from './errors';
import { type DeviceModel, modelLabel, supports } from './model';
import { classicFrame } from './scp';

/**
 * Which events make the device vibrate.
 *
 * `charge` (vibrate when the holder starts charging) exists only on holder
 * models; it is `undefined` on one-piece devices.
 */
export interface VibrationSettings {
  readonly heating: boolean;
  readonly starting: boolean;
  readonly puffEnd: boolean;
  readonly terminated: boolean;
  readonly charge?: boolean;
}

export const LOAD_VIBRATION = classicFrame(0xc9, 0x00, 0x23);
export const LOAD_CHARGE_VIBRATION = classicFrame(0xc9, 0x07, 0x04, [0x04, 0x00, 0x00, 0x00]);

/** Start a vibration burst (Find My IQOS). Stop it with `STOP_VIBRATE`. */
export const START_VIBRATE = classicFrame(0xc0, 0x45, 0x22, [0x01, 0x1e, 0x00, 0x00]);
export const STOP_VIBRATE = classicFrame(0xc0, 0x45, 0x22, [0x00, 0x1e, 0x00, 0x00]);

const CHARGE_ON_RESPONSE = classicFrame(0x08, 0x8b, 0x04, [0x04, ...zeros(13)]);
const CHARGE_OFF_RESPONSE = classicFrame(0x08, 0x8b, 0x04, [0x04, ...zeros(4), 0x09, ...zeros(8)]);

function zeros(count: number): number[] {
  return new Array<number>(count).fill(0x00);
}

/**
 * Frames that follow the main vibration write on holder models. `marker` is
 * `00` to enable charge-start vibration and `09` to disable it; the two slot
 * bytes differ between the states exactly as captured from the official app.
 */
function chargeVibrationCommands(enabled: boolean): Uint8Array[] {
  const marker = enabled ? 0x00 : 0x09;
  const [slot4, slot5] = enabled ? [0x5b, 0x72] : [0x64, 0x4d];
  const record = (slot: number, index: number): Uint8Array =>
    classicFrame(0xc9, 0x4f, 0x04, [slot, index, 0x00, 0xff, 0xff, 0xff, marker, ...zeros(17)]);
  return [
    record(slot4, 0x04),
    record(slot5, 0x05),
    classicFrame(0xc9, 0x47, 0x04, [0x00, 0xff, 0xff, 0x00]),
    LOAD_CHARGE_VIBRATION,
    classicFrame(0xc9, 0x07, 0x04, [0x05, 0x00, 0x00, 0x00]),
  ];
}

/** Parse the main vibration response. `charge` is not part of this frame. */
export function parseVibration(frame: Uint8Array, model: DeviceModel): VibrationSettings {
  if (frame.length < 9) throw decodeError('invalid vibration response: frame too short');
  if (!hasPrefix(frame, [0x00, 0x08, 0x84, 0x23])) {
    throw decodeError('invalid vibration response: header mismatch');
  }
  const variant = frame[4];
  const holderVariant = supports(model, 'charge-vibration') && variant === 0x03;
  if (variant !== 0x10 && !holderVariant) {
    throw decodeError('invalid vibration response: header mismatch');
  }

  const heatUse = frame[6] ?? 0;
  const endTerminated = frame[7] ?? 0;
  return {
    heating: (heatUse & 0x01) !== 0,
    starting: (heatUse & 0x10) !== 0,
    puffEnd: (endTerminated & 0x01) !== 0,
    terminated: (endTerminated & 0x10) !== 0,
  };
}

/** Parse the charge-start vibration response of holder models. */
export function parseChargeVibration(frame: Uint8Array): boolean {
  if (frame.length < 19) {
    throw decodeError('invalid charge-start vibration response: frame too short');
  }
  if (bytesEqual(frame, CHARGE_ON_RESPONSE)) return true;
  if (bytesEqual(frame, CHARGE_OFF_RESPONSE)) return false;
  throw decodeError('unknown charge-start vibration response');
}

function mainVibrationCommand(settings: VibrationSettings): Uint8Array {
  const heatUse = (settings.heating ? 0x01 : 0) | (settings.starting ? 0x10 : 0);
  const endTerminated = (settings.puffEnd ? 0x01 : 0) | (settings.terminated ? 0x10 : 0);
  return classicFrame(0xc9, 0x44, 0x23, [0x10, 0x00, heatUse, endTerminated]);
}

/** Build the write sequence that applies `settings` on `model`. */
export function vibrationCommands(settings: VibrationSettings, model: DeviceModel): Uint8Array[] {
  if (!supports(model, 'vibration')) {
    throw unsupportedError(`vibration is not supported for model ${modelLabel(model)}`);
  }
  const holder = supports(model, 'charge-vibration');
  if (!holder && settings.charge !== undefined) {
    throw unsupportedError(`charge-start vibration is not supported for model ${modelLabel(model)}`);
  }
  if (holder && settings.charge === undefined) {
    throw encodeError(`charge-start vibration value is required for model ${modelLabel(model)}`);
  }

  const commands = [mainVibrationCommand(settings)];
  const anyCore = settings.heating || settings.starting || settings.puffEnd || settings.terminated;
  if (settings.charge !== undefined && (settings.charge || anyCore)) {
    commands.push(...chargeVibrationCommands(settings.charge));
  }
  return commands;
}
