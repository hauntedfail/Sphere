/** GATT identifiers used by IQOS devices. */

/** IQOS core control service. */
export const CORE_SERVICE_UUID = 'daebb240-b041-11e4-9e45-0002a5d5c51b';
/** Battery characteristic exposed by the core service. */
export const BATTERY_CHARACTERISTIC_UUID = 'f8a54120-b041-11e4-9be7-0002a5d5c51b';
/** SCP control characteristic: commands are written here, replies notify here. */
export const SCP_CHARACTERISTIC_UUID = 'e16c6e20-b041-11e4-a4c3-0002a5d5c51b';

/** Standard Device Information service. */
export const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
export const MODEL_NUMBER_UUID = '00002a24-0000-1000-8000-00805f9b34fb';
export const SERIAL_NUMBER_UUID = '00002a25-0000-1000-8000-00805f9b34fb';
export const SOFTWARE_REVISION_UUID = '00002a28-0000-1000-8000-00805f9b34fb';
export const MANUFACTURER_NAME_UUID = '00002a29-0000-1000-8000-00805f9b34fb';

/** Advertised names start with this, e.g. `IQOS ILUMA i`. */
export const DEVICE_NAME_PREFIX = 'IQOS';

/** Device Information strings read while connecting. */
export interface DeviceInfo {
  readonly modelNumber?: string;
  /**
   * Browsers refuse to read the serial number characteristic (it is on the
   * Web Bluetooth blocklist), so this is normally absent over BLE.
   */
  readonly serialNumber?: string;
  readonly softwareRevision?: string;
  readonly manufacturerName?: string;
}

const MAX_TEXT_LENGTH = 64;

/**
 * Make device-supplied text safe to show and store: no control characters
 * (a newline would forge console lines), no invisible format characters
 * (bidi overrides can disguise text), and a length cap.
 */
export function cleanDeviceText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, MAX_TEXT_LENGTH);
}

/** Decode a Device Information string, dropping GATT NUL padding. */
export function deviceInfoText(value: Uint8Array): string {
  return cleanDeviceText(new TextDecoder('utf-8').decode(value));
}
