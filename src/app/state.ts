import type { DeviceStatus } from '../device/iqos';
import type { I18n } from '../i18n/i18n';
import type { MessageRef } from '../i18n/message';
import type { DeviceInfo } from '../protocol/gatt';
import type { Diagnosis } from '../protocol/identity';
import type { DeviceModel } from '../protocol/model';
import type { BrightnessLevel, FlexBatterySettings } from '../protocol/settings';
import type { VibrationSettings } from '../protocol/vibration';
import type { DeviceBook } from '../storage/devices';
import type { BluetoothSupport } from '../transport/link';
import type { WireDirection } from '../transport/session';

/** A value read from the device, with its loading and failure states. */
export type Field<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly value?: T }
  | { readonly status: 'ready'; readonly value: T }
  | {
      readonly status: 'error';
      /** What went wrong, in English. */
      readonly error: string;
      /** The same, for the page to say in its own language. */
      readonly message?: MessageRef;
      readonly value?: T;
    };

export const IDLE: Field<never> = { status: 'idle' };

export interface ConnectedDevice {
  readonly kind: 'ble' | 'simulated';
  readonly id: string;
  readonly name: string;
  /** The model in effect: detected from the name, or chosen by the user. */
  readonly model: DeviceModel;
  /** What the advertised name alone says. */
  readonly detectedModel: DeviceModel;
  readonly info: DeviceInfo;
  /** The saved label used to connect, if any. */
  readonly label?: string;
}

export type ConsoleTone = 'input' | 'out' | 'error' | 'note';

export interface ConsoleLine {
  readonly id: number;
  readonly tone: ConsoleTone;
  /** The line as the console shows it, in English. */
  readonly text: string;
  /** The same line for the page to say in its own language, where it has one. */
  readonly message?: MessageRef;
}

export interface WireLine {
  readonly id: number;
  /** Milliseconds since the epoch. */
  readonly at: number;
  readonly direction: WireDirection;
  readonly hex: string;
  readonly note?: string;
}

export type FlexBatteryState = Required<FlexBatterySettings>;

export interface AppState {
  readonly support: BluetoothSupport;
  readonly phase: 'idle' | 'connecting' | 'connected';
  readonly device: ConnectedDevice | null;
  readonly battery: Field<number>;
  readonly status: Field<DeviceStatus>;
  readonly diagnosis: Field<Diagnosis>;
  readonly brightness: Field<BrightnessLevel>;
  readonly vibration: Field<VibrationSettings>;
  readonly flexpuff: Field<boolean>;
  readonly flexbattery: Field<FlexBatteryState>;
  readonly autostart: Field<boolean>;
  /** Smart Gesture cannot be read back; this is what was last written here. */
  readonly smartGesture: boolean | null;
  /** Lock state cannot be read back either. */
  readonly locked: boolean | null;
  /** Find My IQOS is vibrating the device. */
  readonly finding: boolean;
  /** Commands currently running or queued. */
  readonly busy: number;
  readonly console: readonly ConsoleLine[];
  readonly wire: readonly WireLine[];
  readonly book: DeviceBook;
  /** The language the page is drawn in. */
  readonly i18n: I18n;
}

/** The slice of state that describes the connected device. */
export type DeviceFields = Pick<
  AppState,
  | 'battery'
  | 'status'
  | 'diagnosis'
  | 'brightness'
  | 'vibration'
  | 'flexpuff'
  | 'flexbattery'
  | 'autostart'
  | 'smartGesture'
  | 'locked'
  | 'finding'
>;

export const NO_DEVICE_FIELDS: DeviceFields = {
  battery: IDLE,
  status: IDLE,
  diagnosis: IDLE,
  brightness: IDLE,
  vibration: IDLE,
  flexpuff: IDLE,
  flexbattery: IDLE,
  autostart: IDLE,
  smartGesture: null,
  locked: null,
  finding: false,
};

export function initialState(support: BluetoothSupport, book: DeviceBook, i18n: I18n): AppState {
  return {
    support,
    phase: 'idle',
    device: null,
    ...NO_DEVICE_FIELDS,
    busy: 0,
    console: [],
    wire: [],
    book,
    i18n,
  };
}

// ── Store ───────────────────────────────────────────────────────────────────

export type Listener<T> = (state: T, previous: T) => void;

export interface Store<T> {
  get(): T;
  /** Replace the state with the result of `change`. State is never mutated. */
  update(change: (state: T) => T): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  return {
    get: () => state,
    update: (change) => {
      const previous = state;
      state = change(previous);
      if (state === previous) return;
      for (const listener of [...listeners]) listener(state, previous);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
