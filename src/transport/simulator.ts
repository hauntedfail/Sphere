/**
 * A simulated IQOS that answers SCP frames in memory.
 *
 * It exists so the interface can be explored without hardware and so the
 * session, framing and command layers can be tested end to end. Only debug
 * builds include it: `main.ts` is the one place that decides. Read replies
 * follow frames captured from an ILUMA i. Three things are invented, because
 * no capture shows them: the acknowledgement sent after a classic write, the
 * life-data frame, and every identifier (product numbers, firmware bytes).
 */
import { type DeviceModel, modelFromLocalName } from '../protocol/model';
import {
  FrameAssembler,
  classicFrame,
  extendedFrame,
  fragment,
  frameError,
  usesCrc16,
} from '../protocol/scp';
import type { DeviceLink, LinkHooks, SimulatorGateway } from './link';
import { ScpSession, type ScpPort } from './session';

export interface SimulatorState {
  brightness: 'high' | 'low';
  heating: boolean;
  starting: boolean;
  puffEnd: boolean;
  terminated: boolean;
  charge: boolean;
  flexpuff: boolean;
  eco: boolean;
  pause: boolean;
  autostart: boolean;
  smartGesture: boolean;
  locked: boolean;
  vibrating: boolean;
  batteryLevel: number;
  batteryMillivolts: number;
  puffCount: number;
  daysUsed: number;
}

export interface SimulatorOptions {
  readonly name?: string;
  /** Delay before each reply, so the interface shows work in progress. */
  readonly latencyMs?: number;
  /** Split replies into 20-byte notifications instead of sending them whole. */
  readonly fragmentReplies?: boolean;
  readonly state?: Partial<SimulatorState>;
}

const DEFAULT_STATE: SimulatorState = {
  brightness: 'high',
  heating: true,
  starting: false,
  puffEnd: true,
  terminated: true,
  charge: true,
  flexpuff: true,
  eco: false,
  pause: true,
  autostart: true,
  smartGesture: true,
  locked: false,
  vibrating: false,
  batteryLevel: 85,
  batteryMillivolts: 3870,
  puffCount: 1234,
  daysUsed: 42,
};

const REPLY_ADDRESS: Readonly<Record<number, number>> = { 0xc0: 0xc0, 0xc9: 0x08, 0xd2: 0x90 };

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));
const zeros = (count: number): number[] => new Array<number>(count).fill(0x00);
const flag = (value: boolean): number => (value ? 0x01 : 0x00);

export class SimulatedDevice implements ScpPort {
  readonly name: string;
  readonly model: DeviceModel;
  readonly state: SimulatorState;
  /** Complete request frames received, oldest first. */
  readonly received: Uint8Array[] = [];
  /** Set to make the device stop answering, to exercise timeouts. */
  silent = false;

  private readonly assembler = new FrameAssembler();
  private readonly listeners = new Set<(chunk: Uint8Array) => void>();
  private readonly latencyMs: number;
  private readonly fragmentReplies: boolean;

  constructor(options: SimulatorOptions = {}) {
    this.name = options.name ?? 'IQOS ILUMA i';
    this.model = modelFromLocalName(this.name);
    this.state = { ...DEFAULT_STATE, ...options.state };
    this.latencyMs = options.latencyMs ?? 0;
    this.fragmentReplies = options.fragmentReplies ?? false;
  }

  async write(chunk: Uint8Array): Promise<void> {
    const frame = this.assembler.push(chunk);
    if (frame === null) return;
    this.received.push(frame);
    if (this.silent) return;

    const reply = this.answer(frame);
    if (this.latencyMs > 0) {
      setTimeout(() => this.notify(reply), this.latencyMs);
    } else {
      queueMicrotask(() => this.notify(reply));
    }
  }

  subscribe(listener: (chunk: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Push an unrequested notification, as a real device sometimes does. */
  notify(frame: Uint8Array): void {
    const chunks = this.fragmentReplies ? fragment(frame) : [frame];
    for (const chunk of chunks) {
      for (const listener of this.listeners) listener(chunk);
    }
  }

  /** Value of the vendor battery characteristic. */
  batteryValue(): Uint8Array {
    return Uint8Array.from([0x00, 0x00, this.state.batteryLevel]);
  }

  private answer(frame: Uint8Array): Uint8Array {
    const address = frame[1] ?? 0;
    const header = frame[2] ?? 0;
    const id = frame[3] ?? 0;
    const reply = REPLY_ADDRESS[address];

    if (reply === undefined || frameError(frame) !== null) {
      return classicFrame(reply ?? address, 0xa0 | (header & 3), id);
    }
    if (usesCrc16(frame)) return this.answerExtended(reply, frame);

    const payload = Array.from(frame.subarray(4, frame.length - 1));
    const answer = this.answerClassic(address, header, id, payload);
    if (answer === null) return classicFrame(reply, 0xa0 | (header & 3), id);
    if (answer === 'ack') return classicFrame(reply, 0xc0 | (header & 3), id);
    return classicFrame(reply, answer.header, id, answer.payload);
  }

  private answerExtended(reply: number, frame: Uint8Array): Uint8Array {
    const s = this.state;
    const dataId = [frame[4] ?? 0, frame[5] ?? 0];
    if (dataId[0] === 0x01 && dataId[1] === 0x01) {
      const record = (index: number, value: number, tag: number): number[] => [
        index, 0x00, 0x00, 0x00, value & 0xff, (value >> 8) & 0xff, 0x00, tag,
      ];
      return extendedFrame(reply, 0x90, [
        ...dataId,
        ...record(0, s.puffCount, 0x8e),
        ...record(1, 0x0728, 0x20),
        ...record(2, s.daysUsed, 0x17),
        ...record(3, 0x0041, 0x18),
      ]);
    }
    if (dataId[0] === 0x00 && dataId[1] === 0x04) {
      return extendedFrame(reply, 0x90, [...dataId, 0xda, 0x07, 0x01, 0x01, 0x2e, 0xe0, 0xe3, 0x1c]);
    }
    return extendedFrame(reply, 0xb0, dataId);
  }

  private answerClassic(
    address: number,
    header: number,
    id: number,
    payload: readonly number[],
  ): { header: number; payload: number[] } | 'ack' | null {
    const s = this.state;
    const key = (address << 16) | (header << 8) | id;
    const first = payload[0] ?? 0;
    const second = payload[1] ?? 0;

    switch (key) {
      // Charger / one-piece device (C0)
      case 0xc00000:
        return { header: 0x88, payload: [0x10, 0x00, 0x01, 0x02, 0x03, 0x18, ...zeros(8)] };
      case 0xc00003:
        return { header: 0x88, payload: ascii('SIMCHARGER0001') };
      case 0xc00021:
        return {
          header: 0x88,
          payload: [0x00, s.batteryMillivolts & 0xff, s.batteryMillivolts >> 8, ...zeros(11)],
        };
      case 0xc00100:
        return { header: 0x89, payload: zeros(14) };
      case 0xc00223:
        return { header: 0x86, payload: [s.brightness === 'high' ? 0x64 : 0x1e, 0, 0, 0] };
      case 0xc04623:
        if (first !== 0x64 && first !== 0x1e) return null;
        s.brightness = first === 0x64 ? 'high' : 'low';
        return 'ack';
      case 0xc04522:
        s.vibrating = first === 0x01;
        return 'ack';

      // Holder (C9)
      case 0xc90000:
        return { header: 0x88, payload: [0x0e, 0x00, 0x01, 0x02, 0x03, 0x18, ...zeros(8)] };
      case 0xc90003:
        return { header: 0x88, payload: ascii('SIMHOLDER00001') };
      case 0xc90004:
        return { header: 0x84, payload: [s.locked ? 0x02 : 0x00, 0, 0, 0] };
      case 0xc94404:
        s.locked = first === 0x02;
        return 'ack';
      case 0xc90023:
        return {
          header: 0x84,
          payload: [
            0x10,
            0x00,
            flag(s.heating) | (s.starting ? 0x10 : 0),
            flag(s.puffEnd) | (s.terminated ? 0x10 : 0),
          ],
        };
      case 0xc94423:
        s.heating = ((payload[2] ?? 0) & 0x01) !== 0;
        s.starting = ((payload[2] ?? 0) & 0x10) !== 0;
        s.puffEnd = ((payload[3] ?? 0) & 0x01) !== 0;
        s.terminated = ((payload[3] ?? 0) & 0x10) !== 0;
        return 'ack';
      case 0xc94424:
        return 'ack';
      case 0xc90025:
        return { header: 0x84, payload: [flag(s.eco), 0, 0, 0] };
      case 0xc94425:
        s.eco = first === 0x01;
        return 'ack';
      case 0xc90704:
        if (first !== 0x04 && first !== 0x05) return null;
        return {
          header: 0x8b,
          payload: [first, ...zeros(4), s.charge ? 0x00 : 0x09, ...zeros(8)],
        };
      case 0xc94f04:
        if (second === 0x04) s.charge = (payload[6] ?? 0) === 0x00;
        return 'ack';
      case 0xc94704:
        return 'ack';
      case 0xc90724: {
        const value = this.holderSetting(first);
        return value === null ? null : { header: 0x87, payload: [first, flag(value), 0, 0] };
      }
      case 0xc94724:
        if (first === 0x01) s.autostart = second === 0x01;
        else if (first === 0x02) s.pause = second === 0x01;
        else if (first === 0x04) s.smartGesture = second === 0x01;
        else return null;
        return 'ack';

      // Heating engine (D2)
      case 0xd20522:
        return first === 0x03 ? { header: 0x85, payload: [0x03, flag(s.flexpuff), 0, 0] } : null;
      case 0xd24522:
        if (first !== 0x03) return null;
        s.flexpuff = second === 0x01;
        return 'ack';

      default:
        return null;
    }
  }

  private holderSetting(settingId: number): boolean | null {
    if (settingId === 0x01) return this.state.autostart;
    if (settingId === 0x02) return this.state.pause;
    if (settingId === 0x04) return this.state.smartGesture;
    return null;
  }
}

/** The name each model advertises, which is how the app tells them apart. */
const ADVERTISED_NAMES: Record<Exclude<DeviceModel, 'unknown'>, string> = {
  iluma: 'IQOS ILUMA',
  'iluma-one': 'IQOS ILUMA ONE',
  'iluma-prime': 'IQOS ILUMA PRIME',
  'iluma-i': 'IQOS ILUMA i',
  'iluma-i-one': 'IQOS ILUMA i ONE',
  'iluma-i-prime': 'IQOS ILUMA i PRIME',
};

/** Reply delay that lets the interface show work in progress. */
const DEFAULT_LATENCY_MS = 60;

/** The simulator as the app sees it: a place to open simulated devices. */
export function createSimulator(options: { readonly latencyMs?: number } = {}): SimulatorGateway {
  const latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
  return {
    open: (model, hooks) => {
      const name = model === 'unknown' ? 'IQOS' : ADVERTISED_NAMES[model];
      return openSimulatedLink(new SimulatedDevice({ name, latencyMs }), hooks);
    },
  };
}

/** Open a link to a simulated device, shaped like a Bluetooth one. */
export function openSimulatedLink(
  device: SimulatedDevice,
  hooks: LinkHooks = {},
  timeoutMs?: number,
): DeviceLink {
  const session = new ScpSession(device, {
    ...(hooks.onWire ? { onWire: hooks.onWire } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  let open = true;
  return {
    kind: 'simulated',
    id: 'simulated',
    name: device.name,
    info: {
      modelNumber: 'SIM-0001',
      softwareRevision: '0.0.0-sim',
      manufacturerName: 'Sphere simulator',
    },
    transport: session,
    readBatteryLevel: async () => {
      const level = device.batteryValue()[2] ?? 0;
      return level;
    },
    disconnect: () => {
      if (!open) return;
      open = false;
      session.close('disconnected');
      hooks.onDisconnect?.('disconnected');
    },
  };
}
