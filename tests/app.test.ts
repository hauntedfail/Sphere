import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import type { AppState } from '../src/app/state';
import { KNOWN_MODELS, modelFromLocalName } from '../src/protocol/model';
import { STORAGE_KEY, type KeyValueStore } from '../src/storage/devices';
import type {
  BluetoothGateway,
  BluetoothSupport,
  DeviceLink,
  LinkHooks,
  OpenRequest,
} from '../src/transport/link';
import {
  SimulatedDevice,
  createSimulator,
  openSimulatedLink,
  type SimulatorOptions,
} from '../src/transport/simulator';

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failing = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failing) throw new Error('quota exceeded');
    this.data.set(key, value);
  }
}

/** Stands in for Web Bluetooth: hands out simulated devices as if they were real. */
class FakeBluetooth implements BluetoothGateway {
  readonly requests: OpenRequest[] = [];
  readonly devices: SimulatedDevice[] = [];
  supportLevel: BluetoothSupport = 'ok';
  failure: Error | null = null;
  options: SimulatorOptions = {};
  hooks: LinkHooks = {};

  support(): BluetoothSupport {
    return this.supportLevel;
  }

  async open(request: OpenRequest, hooks: LinkHooks): Promise<DeviceLink> {
    this.requests.push(request);
    if (this.failure !== null) throw this.failure;
    const device = new SimulatedDevice(this.options);
    this.devices.push(device);
    this.hooks = hooks;
    const link = openSimulatedLink(device, hooks, 200);
    return { ...link, kind: 'ble', id: 'ble-device-1' };
  }

  get device(): SimulatedDevice {
    const device = this.devices.at(-1);
    if (device === undefined) throw new Error('nothing connected');
    return device;
  }
}

interface Harness {
  app: App;
  bluetooth: FakeBluetooth;
  storage: MemoryStore;
  state: () => AppState;
  /** Console text printed since the last call. */
  output: () => string[];
  run: (...lines: string[]) => Promise<string[]>;
}

/** `simulator: false` builds the app the way a production build does. */
function harness(
  bluetooth: FakeBluetooth | null = new FakeBluetooth(),
  options: { simulator?: boolean } = {},
): Harness {
  const storage = new MemoryStore();
  const app = new App({
    storage,
    bluetooth,
    version: '9.9.9',
    simulator: options.simulator === false ? null : createSimulator({ latencyMs: 0 }),
    now: () => 1000,
  });
  let seen = 0;
  const output = (): string[] => {
    const lines = app.store.get().console.filter((line) => line.id > seen);
    seen = lines.at(-1)?.id ?? seen;
    return lines.filter((line) => line.tone !== 'input').map((line) => line.text);
  };
  const run = async (...lines: string[]): Promise<string[]> => {
    for (const line of lines) await app.run(line);
    return output();
  };
  return {
    app,
    bluetooth: bluetooth ?? new FakeBluetooth(),
    storage,
    state: () => app.store.get(),
    output,
    run,
  };
}

async function connected(options: SimulatorOptions = {}): Promise<Harness> {
  const h = harness();
  h.bluetooth.options = options;
  await h.run('connect');
  return h;
}

describe('connecting', () => {
  it('starts idle with every command explained', async () => {
    const h = harness();
    expect(h.state().phase).toBe('idle');
    const help = await h.run('help');
    expect(help[0]).toBe('Available commands:');
    expect(help.join('\n')).toMatch(/flexbattery/);
    expect(await h.run('version')).toEqual(['sphere 9.9.9']);
  });

  it('tells a disconnected user how to connect', async () => {
    const h = harness();
    expect(await h.run('battery')).toEqual([
      'Not connected. Run connect, or demo to try a simulated device.',
    ]);
    expect(await h.run('disconnect')).toEqual(['Not connected.']);
    expect(await h.run('refresh')).toHaveLength(1);
  });

  it('connects, loads every panel and remembers the device', async () => {
    const h = await connected();
    const state = h.state();
    expect(state.phase).toBe('connected');
    expect(state.device).toMatchObject({ kind: 'ble', name: 'IQOS ILUMA i', model: 'iluma-i' });
    expect(state.battery).toEqual({ status: 'ready', value: 85 });
    expect(state.brightness).toEqual({ status: 'ready', value: 'high' });
    expect(state.flexpuff).toEqual({ status: 'ready', value: true });
    expect(state.flexbattery).toEqual({ status: 'ready', value: { mode: 'performance', pause: true } });
    expect(state.autostart).toEqual({ status: 'ready', value: true });
    expect(state.vibration.status).toBe('ready');
    expect(state.status.status).toBe('ready');
    expect(state.diagnosis.status).toBe('idle');
    expect(state.busy).toBe(0);
    expect(state.wire.length).toBeGreaterThan(8);
    expect(state.wire[0]).toMatchObject({ direction: 'tx', at: 1000 });

    expect(state.book.last).toEqual({ id: 'ble-device-1', name: 'IQOS ILUMA i', model: 'iluma-i' });
    expect(JSON.parse(h.storage.data.get(STORAGE_KEY)!)).toMatchObject({
      last: { id: 'ble-device-1' },
    });
  });

  it('only reads what the model supports', async () => {
    const h = await connected({ name: 'IQOS ILUMA ONE' });
    const state = h.state();
    expect(state.device?.model).toBe('iluma-one');
    expect(state.brightness.status).toBe('ready');
    expect(state.flexpuff.status).toBe('idle');
    expect(state.flexbattery.status).toBe('idle');
    expect(state.autostart.status).toBe('idle');
    const help = (await h.run('help')).join('\n');
    expect(help).not.toMatch(/flexpuff|flexbattery|autostart|smartgesture|charge/);
  });

  it('refuses a second connection', async () => {
    const h = await connected();
    expect(await h.run('connect')).toEqual(['Already connected. Run disconnect first.']);
    expect(await h.run('demo')).toEqual(['Already connected. Run disconnect first.']);
  });

  it('explains missing or insecure Bluetooth', async () => {
    const none = harness(null);
    expect(none.state().support).toBe('unsupported');
    expect((await none.run('connect'))[0]).toMatch(/no Web Bluetooth/);
    expect((await none.run('connect'))[0]).toMatch(/Bluefy on an iPhone or iPad/);

    const bluetooth = new FakeBluetooth();
    bluetooth.supportLevel = 'insecure';
    expect((await harness(bluetooth).run('connect'))[0]).toMatch(/HTTPS or from localhost/);
  });

  it('reports a cancelled chooser and other failures', async () => {
    const h = harness();
    h.bluetooth.failure = Object.assign(new Error('User cancelled'), { name: 'NotFoundError' });
    expect(await h.run('connect')).toEqual(['No device was selected.']);
    expect(h.state().phase).toBe('idle');

    h.bluetooth.failure = Object.assign(new Error('needs a gesture'), { name: 'SecurityError' });
    expect((await h.run('connect'))[0]).toMatch(/browser blocked/);

    h.bluetooth.failure = new Error('GATT Server is disconnected');
    expect((await h.run('connect'))[0]).toMatch(/could not connect \(GATT Server is disconnected\)/);
    expect(h.state().phase).toBe('idle');
  });

  it('passes the chooser options through', async () => {
    const h = harness();
    await h.run('connect --all', 'disconnect');
    expect(h.bluetooth.requests[0]).toEqual({ acceptAll: true });

    await h.run('connect --last');
    expect(h.bluetooth.requests[1]).toMatchObject({ known: { id: 'ble-device-1', name: 'IQOS ILUMA i' } });
  });

  it('has nothing to reconnect to on first use', async () => {
    const h = harness();
    expect((await h.run('connect --last'))[0]).toMatch(/No device has been connected/);
    expect(await h.run('connect minera')).toEqual(['Device label not found: minera']);
    expect(h.bluetooth.requests).toHaveLength(0);
  });

  it('handles the device dropping the link', async () => {
    const h = await connected();
    h.output();
    h.bluetooth.hooks.onDisconnect?.('the device went out of range');
    const state = h.state();
    expect(state.phase).toBe('idle');
    expect(state.device).toBeNull();
    expect(state.battery.status).toBe('idle');
    expect(h.output()).toEqual(['Disconnected: the device went out of range']);
    expect((await h.run('battery'))[0]).toMatch(/Not connected/);
  });

  it('disconnects on request and on exit', async () => {
    const h = await connected();
    expect(await h.run('disconnect')).toEqual(['Disconnected.']);
    expect(await h.run('exit')).toEqual(['Goodbye!']);
    await h.run('connect');
    expect(await h.run('quit')).toEqual(['Goodbye!', 'Disconnected.']);
    expect(h.state().phase).toBe('idle');
  });
});

describe('device commands', () => {
  it('prints battery, info and diagnosis like the CLI', async () => {
    const h = await connected({ state: { batteryLevel: 61, puffCount: 2033, daysUsed: 941 } });
    expect(await h.run('battery')).toEqual(['Battery: 61%']);

    expect(await h.run('info')).toEqual([
      'Device Information:',
      '  Model:           ILUMA i',
      '  Model number:    SIM-0001',
      '  Serial number:   hidden by the browser',
      '  Manufacturer:    Sphere simulator',
      '  Software rev:    0.0.0-sim',
      '  Product number:  SIMCHARGER0001',
      '  Stick firmware:  v1.2.3.24',
      '  Holder product:  SIMHOLDER00001',
      '  Holder firmware: v1.2.3.24',
      '  Battery voltage: 3.870V',
    ]);

    expect(await h.run('diagnosis')).toEqual([
      'Diagnosis:',
      '  Total puffs:     2033',
      '  Days used:       941',
      '  Battery voltage: 3.87V',
    ]);
    expect(h.state().diagnosis.status).toBe('ready');
  });

  it('reads and sets brightness', async () => {
    const h = await connected();
    expect(await h.run('brightness')).toEqual(['Brightness: high']);
    expect(await h.run('brightness low')).toEqual(['Brightness set to low']);
    expect(h.bluetooth.device.state.brightness).toBe('low');
    expect(h.state().brightness).toEqual({ status: 'ready', value: 'low' });
  });

  it('reads and updates vibration flags', async () => {
    const h = await connected({
      state: { heating: true, starting: false, puffEnd: true, terminated: true, charge: true },
    });
    expect(await h.run('vibration')).toEqual([
      'Vibration: heating=on starting=off puffend=on terminated=on charge=on',
    ]);
    expect(await h.run('vibration heating off starting on charge off')).toEqual([
      'Vibration settings updated',
    ]);
    expect(h.bluetooth.device.state).toMatchObject({
      heating: false,
      starting: true,
      puffEnd: true,
      terminated: true,
      charge: false,
    });
    expect(h.state().vibration).toEqual({
      status: 'ready',
      value: { heating: false, starting: true, puffEnd: true, terminated: true, charge: false },
    });
  });

  it('rejects the charge flag on one-piece models', async () => {
    const h = await connected({ name: 'IQOS ILUMA ONE' });
    expect(await h.run('vibration charge on')).toEqual(["'charge' flag is not supported on this device"]);
    expect(await h.run('vibration heating off')).toEqual(['Vibration settings updated']);
    expect(await h.run('vibration')).toEqual([
      'Vibration: heating=off starting=off puffend=on terminated=on',
    ]);
  });

  it('manages FlexPuff', async () => {
    const h = await connected({ state: { flexpuff: true } });
    expect(await h.run('flexpuff')).toEqual(['FlexPuff: enabled']);
    expect(await h.run('flexpuff disable')).toEqual(['FlexPuff disabled']);
    expect(await h.run('flexpuff status')).toEqual(['FlexPuff: disabled']);
    expect(await h.run('flexpuff enable')).toEqual(['FlexPuff enabled']);
    expect(h.state().flexpuff).toEqual({ status: 'ready', value: true });
  });

  it('manages FlexBattery mode and pause', async () => {
    const h = await connected({ state: { eco: false, pause: false } });
    expect(await h.run('flexbattery')).toEqual(['FlexBattery: mode=performance, pause=off']);
    expect(await h.run('flexbattery eco')).toEqual(['FlexBattery settings updated']);
    expect(await h.run('flexbattery pause on')).toEqual(['FlexBattery settings updated']);
    expect(h.bluetooth.device.state).toMatchObject({ eco: true, pause: true });
    expect(h.state().flexbattery).toEqual({ status: 'ready', value: { mode: 'eco', pause: true } });
  });

  it('manages Auto Start and Smart Gesture', async () => {
    const h = await connected();
    expect(await h.run('autostart')).toEqual(['Autostart: enabled']);
    expect(await h.run('autostart off')).toEqual(['Autostart disabled']);
    expect(await h.run('autostart status')).toEqual(['Autostart: disabled']);
    expect(await h.run('autostart on')).toEqual(['Autostart enabled']);

    expect(h.state().smartGesture).toBeNull();
    expect(await h.run('smartgesture disable')).toEqual(['Smart Gesture disabled']);
    expect(h.state().smartGesture).toBe(false);
    expect(h.bluetooth.device.state.smartGesture).toBe(false);
    expect(await h.run('smartgesture enable')).toEqual(['Smart Gesture enabled']);
  });

  it('locks and unlocks', async () => {
    const h = await connected();
    expect(h.state().locked).toBeNull();
    expect(await h.run('lock')).toEqual(['Device locked']);
    expect(h.state().locked).toBe(true);
    expect(h.bluetooth.device.state.locked).toBe(true);
    expect(await h.run('unlock')).toEqual(['Device unlocked']);
    expect(h.state().locked).toBe(false);
  });

  it('vibrates until the next Enter', async () => {
    const h = await connected();
    expect(await h.run('findmyiqos')).toEqual(['Starting Find My IQOS...', 'Press <Enter> to stop']);
    expect(h.state().finding).toBe(true);
    expect(h.bluetooth.device.state.vibrating).toBe(true);

    expect(await h.run('')).toEqual(['Stopped.']);
    expect(h.state().finding).toBe(false);
    expect(h.bluetooth.device.state.vibrating).toBe(false);
  });

  it('lets disconnect and exit through while the device is vibrating', async () => {
    const h = await connected();
    await h.run('findmyiqos');
    const device = h.bluetooth.device;
    expect(await h.run('disconnect')).toEqual(['Disconnected.']);
    expect(device.state.vibrating).toBe(false);
    expect(h.state().finding).toBe(false);
  });

  it('disconnects at once instead of waiting behind queued reads', async () => {
    const h = await connected();
    h.bluetooth.device.silent = true;
    const refresh = h.app.run('refresh');
    const info = h.app.run('info');
    const started = Date.now();
    await h.app.run('disconnect');
    expect(h.state().phase).toBe('idle');
    expect(Date.now() - started).toBeLessThan(150);

    await Promise.all([refresh, info]);
    expect(h.state().busy).toBe(0);
    expect(h.output()).toContain('Not connected. Run connect, or demo to try a simulated device.');
  });

  it('does not write device state onto a connection that has ended', async () => {
    const h = await connected();
    const session = h.app.session();
    vi.spyOn(session.iqos, 'findStart').mockImplementation(async () => {
      h.bluetooth.hooks.onDisconnect?.('the device went out of range');
    });
    vi.spyOn(session.iqos, 'lock').mockImplementation(async () => undefined);
    const out = await h.run('findmyiqos');
    expect(h.state().finding).toBe(false);
    expect(out).not.toContain('Press <Enter> to stop');
    expect(h.state().locked).toBeNull();
  });

  it('notes a failed read-back without calling the write a failure', async () => {
    const h = await connected();
    const { iqos } = h.app.session();
    vi.spyOn(iqos, 'readBrightness').mockRejectedValue(new Error('GATT operation failed'));
    expect(await h.run('brightness low')).toEqual([
      'Brightness set to low',
      'Written, but reading it back failed: GATT operation failed',
    ]);
    expect(h.bluetooth.device.state.brightness).toBe('low');
  });

  it('says when the device did not take a new value', async () => {
    const h = await connected();
    const { iqos } = h.app.session();
    vi.spyOn(iqos, 'setBrightness').mockResolvedValue(undefined);
    expect(await h.run('brightness low')).toEqual([
      'Brightness set to low',
      'The device still reports high.',
    ]);
  });

  it('stops vibrating before disconnecting', async () => {
    const h = await connected();
    await h.run('findmyiqos');
    const device = h.bluetooth.device;
    await h.app.disconnect();
    expect(device.state.vibrating).toBe(false);
    expect(h.state().phase).toBe('idle');
  });

  it('says so when the model lacks a feature', async () => {
    const h = await connected({ name: 'IQOS ILUMA ONE' });
    expect(await h.run('flexpuff enable')).toEqual(['FlexPuff is not supported on this device']);
    expect(await h.run('flexbattery eco')).toEqual([
      'FlexBattery is only available on ILUMA i and ILUMA i PRIME devices',
    ]);
    expect(await h.run('autostart on')).toEqual(['AutoStart is not supported on this device']);
    expect(await h.run('smartgesture enable')).toEqual(['SmartGesture is not supported on this device']);
  });

  it('reports device failures with an Error prefix and keeps going', async () => {
    const h = await connected();
    h.bluetooth.device.silent = true;
    const out = await h.run('brightness');
    expect(out).toEqual(['Error: transport error: timed out waiting for the device to answer']);
    expect(h.state().brightness).toMatchObject({ status: 'error', value: 'high' });

    h.bluetooth.device.silent = false;
    expect(await h.run('brightness')).toEqual(['Brightness: high']);
  });

  it('refreshes every panel and notes what could not be read', async () => {
    const h = await connected();
    h.bluetooth.device.state.batteryLevel = 12;
    h.bluetooth.device.state.brightness = 'low';
    expect(await h.run('refresh')).toEqual([]);
    expect(h.state().battery).toEqual({ status: 'ready', value: 12 });
    expect(h.state().brightness).toEqual({ status: 'ready', value: 'low' });

    h.bluetooth.device.silent = true;
    const notes = await h.run('refresh');
    expect(notes).toContain('Could not read brightness: transport error: timed out waiting for the device to answer');
    expect(h.state().battery.status).toBe('ready');
  });

  it('clears the console and the wire log', async () => {
    const h = await connected();
    await h.run('clear');
    expect(h.state().console).toEqual([]);
    h.app.clearWire();
    expect(h.state().wire).toEqual([]);
  });

  it('caps the console and wire logs', async () => {
    const h = await connected();
    for (let index = 0; index < 130; index++) await h.app.run('brightness');
    expect(h.state().wire.length).toBeLessThanOrEqual(400);
    for (let index = 0; index < 300; index++) h.app.print('line');
    expect(h.state().console.length).toBe(500);
  });
});

describe('unknown models', () => {
  it('asks the user to pick a model, then loads its settings', async () => {
    const h = harness();
    h.bluetooth.options = { name: 'IQOS3_AABBCC' };
    const out = await h.run('connect');
    expect(out.join('\n')).toMatch(/does not say which model this is/);
    expect(h.state().device).toMatchObject({ model: 'unknown', detectedModel: 'unknown' });
    expect(h.state().brightness.status).toBe('idle');
    expect(await h.run('brightness')).toEqual(['Brightness not supported on this device']);
    expect(await h.run('vibration')).toEqual(['Vibration is not supported on this device']);

    expect(await h.run('model iluma-one')).toEqual(['Treating this device as ILUMA ONE']);
    expect(h.state().device?.model).toBe('iluma-one');
    expect(h.state().brightness.status).toBe('ready');
  });

  it('does not override a recognised model', async () => {
    const h = await connected();
    expect(await h.run('model iluma-one')).toEqual(['This device identifies itself as ILUMA i.']);
  });

  it('uses the saved model as a hint when reconnecting by label', async () => {
    const h = harness();
    h.bluetooth.options = { name: 'IQOS3_AABBCC' };
    await h.run('connect', 'model iluma-prime', 'device save desk', 'disconnect');
    await h.run('connect desk');
    expect(h.state().device).toMatchObject({ model: 'iluma-prime', label: 'desk' });
  });
});

describe('device memory', () => {
  it('saves, lists and removes labels', async () => {
    const h = await connected();
    expect(await h.run('device list')).toEqual(['No saved devices']);
    expect(await h.run('device save minera')).toEqual(['Saved device label: minera']);
    expect(await h.run('device list')).toEqual([
      'minera',
      '  id: ble-device-1',
      '  local_name: IQOS ILUMA i',
      '  model: ILUMA i',
    ]);
    expect(await h.run('device save iluma')).toEqual([
      'Invalid label: iluma is reserved for model selection',
    ]);
    expect(await h.run('device remove nope')).toEqual(['Device label not found: nope']);
    expect(await h.run('device remove minera')).toEqual(['Removed device label: minera']);
    expect(h.state().book.devices).toEqual({});
  });

  it('reconnects by label without asking for every device', async () => {
    const h = await connected();
    await h.run('device save minera', 'disconnect', 'connect minera');
    expect(h.bluetooth.requests[1]).toEqual({
      known: { id: 'ble-device-1', name: 'IQOS ILUMA i', model: 'iluma-i' },
    });
    expect(h.state().device?.label).toBe('minera');
  });

  it('needs a real connected device to save', async () => {
    const h = harness();
    expect(await h.run('device save minera')).toEqual(['No connected device metadata available']);
    await h.run('demo');
    expect(await h.run('device save minera')).toEqual(['The simulated device cannot be saved.']);
    expect(h.state().book.last).toBeUndefined();
  });

  it('keeps working when storage is full', async () => {
    const h = harness();
    h.storage.failing = true;
    const out = await h.run('connect');
    expect(out.join('\n')).toMatch(/Could not write to browser storage/);
    expect(h.state().phase).toBe('connected');
  });
});

describe('simulated device', () => {
  it('connects without Bluetooth', async () => {
    const h = harness(null);
    const out = await h.run('demo');
    expect(out[0]).toBe('Connected to a simulated ILUMA i. Nothing is sent over Bluetooth.');
    expect(h.state().device?.kind).toBe('simulated');
    expect(await h.run('battery')).toEqual(['Battery: 85%']);
    expect((await h.run('info')).join('\n')).toMatch(/Serial number:   N\/A/);
  });

  it('simulates other models', async () => {
    const h = harness(null);
    await h.run('demo iluma-prime');
    expect(h.state().device?.model).toBe('iluma-prime');
    expect(h.state().flexpuff.status).toBe('idle');
  });

  it('runs queued lines in order', async () => {
    const h = harness(null);
    const done = Promise.all([h.app.run('demo'), h.app.run('brightness low'), h.app.run('brightness')]);
    expect(h.state().busy).toBe(3);
    await done;
    expect(h.state().busy).toBe(0);
    expect(h.output().slice(-2)).toEqual(['Brightness set to low', 'Brightness: low']);
  });
});

describe('without the simulator (production builds)', () => {
  it('says whether a simulated device can be opened', () => {
    expect(harness().app.canSimulate).toBe(true);
    expect(harness(null, { simulator: false }).app.canSimulate).toBe(false);
  });

  it('refuses demo and stays idle', async () => {
    const h = harness(null, { simulator: false });
    expect(await h.run('demo')).toEqual(['The simulated device is only part of debug builds.']);
    expect(await h.run('demo iluma-prime')).toEqual(['The simulated device is only part of debug builds.']);
    expect(h.state().phase).toBe('idle');
    expect(h.state().device).toBeNull();
  });

  it('does not point a disconnected user at demo', async () => {
    const h = harness(new FakeBluetooth(), { simulator: false });
    expect(await h.run('battery')).toEqual(['Not connected. Run connect first.']);
  });

  it('lists demo in help only when it exists', async () => {
    const withSimulator = (await harness().run('help')).join('\n');
    const without = (await harness(null, { simulator: false }).run('help')).join('\n');
    expect(withSimulator).toMatch(/^ {2}demo \[model\]/m);
    expect(without).not.toMatch(/demo/);
    expect(without).toMatch(/^ {2}connect \[label\|--last\|--all\]/m);
  });

  it('still connects over Bluetooth', async () => {
    const h = harness(new FakeBluetooth(), { simulator: false });
    await h.run('connect');
    expect(h.state().phase).toBe('connected');
    expect(h.state().device?.kind).toBe('ble');
  });
});

describe('createSimulator', () => {
  it('opens a simulated link that advertises the model asked for', async () => {
    const reasons: string[] = [];
    const link = createSimulator({ latencyMs: 0 }).open('iluma-one', {
      onDisconnect: (reason) => reasons.push(reason),
    });
    expect(link.kind).toBe('simulated');
    expect(link.name).toBe('IQOS ILUMA ONE');
    expect(await link.readBatteryLevel()).toBe(85);
    link.disconnect();
    expect(reasons).toEqual(['disconnected']);
  });

  it('advertises a name the app recognises for every known model', () => {
    const simulator = createSimulator();
    for (const model of KNOWN_MODELS) {
      expect(modelFromLocalName(simulator.open(model, {}).name)).toBe(model);
    }
    expect(modelFromLocalName(simulator.open('unknown', {}).name)).toBe('unknown');
  });
});
