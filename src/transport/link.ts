import type { DeviceInfo } from '../protocol/gatt';
import type { DeviceModel } from '../protocol/model';
import type { Transport, WireEvent } from './session';

/** A connected device: an SCP transport plus what GATT offers besides it. */
export interface DeviceLink {
  readonly kind: 'ble' | 'simulated';
  /** Browser-scoped device identifier. Opaque, and different on every origin. */
  readonly id: string;
  /** Advertised name, e.g. `IQOS ILUMA i`. */
  readonly name: string;
  readonly info: DeviceInfo;
  readonly transport: Transport;
  /** Charge percentage, 0-100. */
  readBatteryLevel(): Promise<number>;
  disconnect(): void;
}

export interface LinkHooks {
  readonly onWire?: (event: WireEvent) => void;
  /** Called once when the link goes away, whoever ended it. */
  readonly onDisconnect?: (reason: string) => void;
}

export type BluetoothSupport = 'ok' | 'unsupported' | 'insecure';

export interface OpenRequest {
  /** A device seen before: reconnect to it without listing everything nearby. */
  readonly known?: { readonly id: string; readonly name: string };
  /** List every nearby device instead of only IQOS ones. */
  readonly acceptAll?: boolean;
}

/**
 * Opens simulated devices. Only debug builds wire one in, so a production
 * bundle carries no simulator at all.
 */
export interface SimulatorGateway {
  /** Open a simulated `model`. `unknown` is a device whose name names no model. */
  open(model: DeviceModel, hooks: LinkHooks): DeviceLink;
}

/** How the app reaches real hardware. Absent in tests and unsupported browsers. */
export interface BluetoothGateway {
  support(): BluetoothSupport;
  open(request: OpenRequest, hooks: LinkHooks): Promise<DeviceLink>;
}
