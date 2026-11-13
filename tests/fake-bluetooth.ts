/**
 * A fake `navigator.bluetooth` backed by the simulated device, so the Web
 * Bluetooth adapter can be tested without a browser or hardware.
 */
import {
  BATTERY_CHARACTERISTIC_UUID,
  CORE_SERVICE_UUID,
  DEVICE_INFO_SERVICE_UUID,
  MANUFACTURER_NAME_UUID,
  MODEL_NUMBER_UUID,
  SCP_CHARACTERISTIC_UUID,
  SERIAL_NUMBER_UUID,
  SOFTWARE_REVISION_UUID,
} from '../src/protocol/gatt';
import { SimulatedDevice } from '../src/transport/simulator';

const view = (bytes: Uint8Array): DataView => new DataView(Uint8Array.from(bytes).buffer);
const text = (value: string): DataView => view(new TextEncoder().encode(value));

function domError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  notifying = false;

  constructor(
    readonly uuid: string,
    private readonly device: SimulatedDevice,
  ) {
    super();
  }

  async startNotifications(): Promise<this> {
    this.notifying = true;
    this.device.subscribe((chunk) => {
      this.value = view(chunk);
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    });
    return this;
  }

  async writeValueWithResponse(bytes: BufferSource): Promise<void> {
    const copy = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    await this.device.write(Uint8Array.from(copy));
  }

  async readValue(): Promise<DataView> {
    switch (this.uuid) {
      case BATTERY_CHARACTERISTIC_UUID:
        return view(this.device.batteryValue());
      case MODEL_NUMBER_UUID:
        return text('M0022\0');
      case SOFTWARE_REVISION_UUID:
        return text('1.2.3\0');
      case MANUFACTURER_NAME_UUID:
        return text('PMI');
      case SERIAL_NUMBER_UUID:
        // Browsers refuse this read: the UUID is on the Web Bluetooth blocklist.
        throw domError('SecurityError', 'readValue() called on blocklisted object');
      default:
        throw domError('NotSupportedError', 'not readable');
    }
  }
}

export interface FakeDeviceOptions {
  readonly name?: string | undefined;
  readonly id?: string;
  /** Leave out the Device Information service entirely. */
  readonly withoutDeviceInfo?: boolean;
  /** Leave out the IQOS core service, as a non-IQOS device would. */
  readonly withoutCore?: boolean;
}

export class FakeBluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name: string | undefined;
  readonly simulated: SimulatedDevice;
  readonly scp: FakeCharacteristic;
  connected = false;
  /** `connect()` rejects while this is set. */
  connectFailure: Error | null = null;
  /** `connect()` never settles while this is set. */
  hang = false;
  connectCalls = 0;
  /** How many times `gatt.disconnect()` was called. */
  hangups = 0;

  readonly gatt: {
    connected: boolean;
    connect: () => Promise<unknown>;
    disconnect: () => void;
  };

  constructor(private readonly options: FakeDeviceOptions = {}) {
    super();
    this.id = options.id ?? 'fake-device-id';
    this.name = 'name' in options ? options.name : 'IQOS ILUMA i';
    this.simulated = new SimulatedDevice({ name: this.name ?? 'IQOS' });
    this.scp = new FakeCharacteristic(SCP_CHARACTERISTIC_UUID, this.simulated);

    const device = this;
    this.gatt = {
      get connected() {
        return device.connected;
      },
      connect: () => this.connect(),
      disconnect: () => {
        this.hangups++;
        this.drop();
      },
    };
  }

  /** Simulate the link going away, from either side. */
  drop(): void {
    if (!this.connected) return;
    this.connected = false;
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }

  private async connect(): Promise<unknown> {
    this.connectCalls++;
    if (this.hang) return new Promise(() => undefined);
    if (this.connectFailure !== null) throw this.connectFailure;
    this.connected = true;
    return { getPrimaryService: (uuid: string) => this.service(uuid) };
  }

  private async service(uuid: string): Promise<unknown> {
    const known =
      (uuid === CORE_SERVICE_UUID && this.options.withoutCore !== true) ||
      (uuid === DEVICE_INFO_SERVICE_UUID && this.options.withoutDeviceInfo !== true);
    if (!known) throw domError('NotFoundError', `No Services matching UUID ${uuid} found in Device.`);
    return {
      getCharacteristic: async (characteristic: string) =>
        characteristic === SCP_CHARACTERISTIC_UUID
          ? this.scp
          : new FakeCharacteristic(characteristic, this.simulated),
    };
  }
}

export class FakeBluetooth {
  readonly chooserRequests: unknown[] = [];
  /** Devices the origin already has permission for. */
  permitted: FakeBluetoothDevice[] = [];
  /** What the chooser returns; `null` means the user cancelled. */
  chosen: FakeBluetoothDevice | null;
  getDevices: (() => Promise<FakeBluetoothDevice[]>) | undefined = async () => this.permitted;

  constructor(chosen: FakeBluetoothDevice | null = new FakeBluetoothDevice()) {
    this.chosen = chosen;
  }

  async requestDevice(options: unknown): Promise<FakeBluetoothDevice> {
    this.chooserRequests.push(options);
    if (this.chosen === null) throw domError('NotFoundError', 'User cancelled the requestDevice() chooser.');
    return this.chosen;
  }
}
