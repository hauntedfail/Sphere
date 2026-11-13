/**
 * Web Bluetooth adapter: finds an IQOS, opens its GATT services and exposes
 * the SCP control characteristic as a `DeviceLink`.
 *
 * This is the only module that touches `navigator.bluetooth`.
 */
import { copyBytes } from '../protocol/bytes';
import { describeError, transportError } from '../protocol/errors';
import {
  BATTERY_CHARACTERISTIC_UUID,
  CORE_SERVICE_UUID,
  DEVICE_INFO_SERVICE_UUID,
  DEVICE_NAME_PREFIX,
  type DeviceInfo,
  MANUFACTURER_NAME_UUID,
  MODEL_NUMBER_UUID,
  SCP_CHARACTERISTIC_UUID,
  SERIAL_NUMBER_UUID,
  SOFTWARE_REVISION_UUID,
  cleanDeviceText,
  deviceInfoText,
} from '../protocol/gatt';
import { parseBatteryLevel } from '../protocol/identity';
import type {
  BluetoothGateway,
  BluetoothSupport,
  DeviceLink,
  LinkHooks,
  OpenRequest,
} from './link';
import { ScpSession, type ScpPort } from './session';

const OPTIONAL_SERVICES = [CORE_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID];

/** `gatt.connect()` can stay pending forever when the device is out of range. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Budget for reaching a remembered device before falling back to the chooser. */
const KNOWN_DEVICE_TIMEOUT_MS = 4_000;

export function createBluetoothGateway(): BluetoothGateway | null {
  if (typeof navigator === 'undefined') return null;
  const bluetooth = navigator.bluetooth as Bluetooth | undefined;
  if (bluetooth === undefined) return null;

  return {
    support: (): BluetoothSupport => (globalThis.isSecureContext ? 'ok' : 'insecure'),
    open: (request, hooks) => open(bluetooth, request, hooks),
  };
}

async function open(
  bluetooth: Bluetooth,
  request: OpenRequest,
  hooks: LinkHooks,
): Promise<DeviceLink> {
  if (request.known !== undefined) {
    const remembered = await findPermitted(bluetooth, request.known.id);
    if (remembered !== null) {
      try {
        return await openLink(remembered, hooks, KNOWN_DEVICE_TIMEOUT_MS);
      } catch {
        // Out of range or asleep. Fall through to the chooser, which scans.
      }
    }
  }
  const device = await bluetooth.requestDevice(chooserOptions(request));
  return openLink(device, hooks, CONNECT_TIMEOUT_MS);
}

function chooserOptions(request: OpenRequest): RequestDeviceOptions {
  if (request.acceptAll === true) {
    return { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES };
  }
  const filters: BluetoothLEScanFilter[] =
    request.known === undefined
      ? [{ namePrefix: DEVICE_NAME_PREFIX }, { services: [CORE_SERVICE_UUID] }]
      : [{ name: request.known.name }];
  return { filters, optionalServices: OPTIONAL_SERVICES };
}

/** Find a device this origin was already granted, where the browser allows it. */
async function findPermitted(bluetooth: Bluetooth, id: string): Promise<BluetoothDevice | null> {
  if (typeof bluetooth.getDevices !== 'function') return null;
  try {
    const devices = await bluetooth.getDevices();
    return devices.find((device) => device.id === id) ?? null;
  } catch {
    return null;
  }
}

async function openLink(
  device: BluetoothDevice,
  hooks: LinkHooks,
  timeoutMs: number,
): Promise<DeviceLink> {
  const gatt = device.gatt;
  if (gatt === undefined) throw transportError('this device does not offer GATT');

  let session: ScpSession | null = null;
  let reported = false;
  const report = (reason: string): void => {
    if (reported) return;
    reported = true;
    device.removeEventListener('gattserverdisconnected', onLost);
    session?.close(reason);
    hooks.onDisconnect?.(reason);
  };
  const onLost = (): void => report('the device closed the connection');

  try {
    const server = await withTimeout(gatt.connect(), timeoutMs, 'the device did not answer');
    const core = await server.getPrimaryService(CORE_SERVICE_UUID);
    const battery = await core.getCharacteristic(BATTERY_CHARACTERISTIC_UUID);
    const scp = await core.getCharacteristic(SCP_CHARACTERISTIC_UUID);
    const info = await readDeviceInfo(server);

    const port = await openPort(scp);
    session = new ScpSession(port, hooks.onWire ? { onWire: hooks.onWire } : {});
    device.addEventListener('gattserverdisconnected', onLost);
    if (!gatt.connected) throw transportError('the device closed the connection');

    return {
      kind: 'ble',
      id: device.id,
      name: cleanDeviceText(device.name ?? '') || 'unnamed device',
      info,
      transport: session,
      readBatteryLevel: async () => parseBatteryLevel(toBytes(await battery.readValue())),
      disconnect: () => {
        // Report first: hanging up fires `gattserverdisconnected`, and a
        // disconnect the user asked for should not read as the device's doing.
        report('disconnected');
        if (gatt.connected) gatt.disconnect();
      },
    };
  } catch (error) {
    device.removeEventListener('gattserverdisconnected', onLost);
    session?.close('connection setup failed');
    // Always hang up, connected or not: after a timeout the browser may still
    // be connecting, and `disconnect()` is what cancels that. A link left to
    // complete on its own would occupy the device's only connection.
    gatt.disconnect();
    throw transportError(describeError(error), error);
  }
}

async function openPort(scp: BluetoothRemoteGATTCharacteristic): Promise<ScpPort> {
  await scp.startNotifications();
  return {
    write: (chunk) => scp.writeValueWithResponse(copyBytes(chunk)),
    subscribe: (listener) => {
      const onValue = (): void => {
        if (scp.value !== undefined) listener(toBytes(scp.value));
      };
      scp.addEventListener('characteristicvaluechanged', onValue);
      return () => scp.removeEventListener('characteristicvaluechanged', onValue);
    },
  };
}

/**
 * Read the Device Information strings. Every one is optional: browsers block
 * the serial number, and some firmware omits the others.
 */
async function readDeviceInfo(server: BluetoothRemoteGATTServer): Promise<DeviceInfo> {
  let service: BluetoothRemoteGATTService;
  try {
    service = await server.getPrimaryService(DEVICE_INFO_SERVICE_UUID);
  } catch {
    return {};
  }

  const read = async (uuid: string): Promise<string | undefined> => {
    try {
      const characteristic = await service.getCharacteristic(uuid);
      return deviceInfoText(toBytes(await characteristic.readValue()));
    } catch {
      return undefined;
    }
  };

  const modelNumber = await read(MODEL_NUMBER_UUID);
  const serialNumber = await read(SERIAL_NUMBER_UUID);
  const softwareRevision = await read(SOFTWARE_REVISION_UUID);
  const manufacturerName = await read(MANUFACTURER_NAME_UUID);
  return {
    ...(modelNumber === undefined ? {} : { modelNumber }),
    ...(serialNumber === undefined ? {} : { serialNumber }),
    ...(softwareRevision === undefined ? {} : { softwareRevision }),
    ...(manufacturerName === undefined ? {} : { manufacturerName }),
  };
}

function toBytes(view: DataView): Uint8Array {
  return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(transportError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
