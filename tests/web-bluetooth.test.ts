import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { CORE_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID } from '../src/protocol/gatt';
import { LOAD_BRIGHTNESS, parseBrightness } from '../src/protocol/settings';
import type { BluetoothGateway } from '../src/transport/link';
import type { WireEvent } from '../src/transport/session';
import { createBluetoothGateway } from '../src/transport/web-bluetooth';
import { FakeBluetooth, FakeBluetoothDevice } from './fake-bluetooth';

function install(bluetooth: FakeBluetooth | undefined, secure = true): BluetoothGateway | null {
  vi.stubGlobal('navigator', bluetooth === undefined ? {} : { bluetooth });
  vi.stubGlobal('isSecureContext', secure);
  return createBluetoothGateway();
}

function gateway(bluetooth: FakeBluetooth): BluetoothGateway {
  const created = install(bluetooth);
  if (created === null) throw new Error('gateway unavailable');
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createBluetoothGateway', () => {
  it('is absent where Web Bluetooth does not exist', () => {
    expect(install(undefined)).toBeNull();
    vi.stubGlobal('navigator', undefined);
    expect(createBluetoothGateway()).toBeNull();
  });

  it('reports whether the page is secure enough', () => {
    expect(install(new FakeBluetooth())?.support()).toBe('ok');
    expect(install(new FakeBluetooth(), false)?.support()).toBe('insecure');
  });
});

describe('opening a device', () => {
  it('asks the chooser for IQOS devices only', async () => {
    const bluetooth = new FakeBluetooth();
    await gateway(bluetooth).open({}, {});
    expect(bluetooth.chooserRequests).toEqual([
      {
        filters: [{ namePrefix: 'IQOS' }, { services: [CORE_SERVICE_UUID] }],
        optionalServices: [CORE_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
      },
    ]);
  });

  it('can list every nearby device', async () => {
    const bluetooth = new FakeBluetooth();
    await gateway(bluetooth).open({ acceptAll: true }, {});
    expect(bluetooth.chooserRequests[0]).toEqual({
      acceptAllDevices: true,
      optionalServices: [CORE_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
    });
  });

  it('exposes identity, battery and an SCP transport', async () => {
    const bluetooth = new FakeBluetooth();
    const wire: WireEvent[] = [];
    const link = await gateway(bluetooth).open({}, { onWire: (event) => wire.push(event) });

    expect(link).toMatchObject({ kind: 'ble', id: 'fake-device-id', name: 'IQOS ILUMA i' });
    expect(link.info).toEqual({
      modelNumber: 'M0022',
      softwareRevision: '1.2.3',
      manufacturerName: 'PMI',
    });
    expect(link.info.serialNumber).toBeUndefined();
    expect(await link.readBatteryLevel()).toBe(85);
    expect(parseBrightness(await link.transport.request(LOAD_BRIGHTNESS))).toBe('high');
    expect(wire.map((event) => event.direction)).toEqual(['tx', 'rx']);
    expect(bluetooth.chosen?.scp.notifying).toBe(true);
  });

  it('copes with a device that has no name or Device Information service', async () => {
    const bluetooth = new FakeBluetooth(new FakeBluetoothDevice({ name: undefined, withoutDeviceInfo: true }));
    const link = await gateway(bluetooth).open({}, {});
    expect(link.name).toBe('unnamed device');
    expect(link.info).toEqual({});
  });

  it('rejects a device without the IQOS service and hangs up', async () => {
    const device = new FakeBluetoothDevice({ withoutCore: true });
    await expect(gateway(new FakeBluetooth(device)).open({}, {})).rejects.toMatchObject({
      kind: 'transport',
      message: expect.stringMatching(/No Services matching/),
    });
    expect(device.connected).toBe(false);
  });

  it('passes a cancelled chooser through untouched', async () => {
    await expect(gateway(new FakeBluetooth(null)).open({}, {})).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('gives up on a device that never answers', async () => {
    vi.useFakeTimers();
    const device = new FakeBluetoothDevice();
    device.hang = true;
    const attempt = gateway(new FakeBluetooth(device)).open({}, {});
    const assertion = expect(attempt).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    // The pending connect must be cancelled, or it would complete later and
    // hold the device's only connection with nothing attached to it.
    expect(device.hangups).toBe(1);
  });

  it('strips control and invisible characters from what the device says', async () => {
    const name = 'IQOS ILUMA i\niqos> lock\u202e' + 'x'.repeat(200);
    const link = await gateway(new FakeBluetooth(new FakeBluetoothDevice({ name }))).open({}, {});
    expect(link.name).toBe(('IQOS ILUMA iiqos> lock' + 'x'.repeat(200)).slice(0, 64));
    expect(link.name).not.toMatch(/[\n\u202e]/);
  });
});

describe('reconnecting to a known device', () => {
  const known = { id: 'fake-device-id', name: 'IQOS ILUMA i' };

  it('skips the chooser when the browser still grants the device', async () => {
    const bluetooth = new FakeBluetooth();
    bluetooth.permitted = [bluetooth.chosen!];
    const link = await gateway(bluetooth).open({ known }, {});
    expect(link.id).toBe('fake-device-id');
    expect(bluetooth.chooserRequests).toEqual([]);
  });

  it('falls back to a chooser limited to that device', async () => {
    const bluetooth = new FakeBluetooth();
    await gateway(bluetooth).open({ known }, {});
    expect(bluetooth.chooserRequests).toEqual([
      {
        filters: [{ name: 'IQOS ILUMA i' }],
        optionalServices: [CORE_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
      },
    ]);
  });

  it('falls back when the remembered device is out of reach', async () => {
    const stale = new FakeBluetoothDevice();
    stale.connectFailure = new Error('Bluetooth Device is no longer in range.');
    const bluetooth = new FakeBluetooth();
    bluetooth.permitted = [stale];
    const link = await gateway(bluetooth).open({ known }, {});
    expect(stale.connectCalls).toBe(1);
    expect(bluetooth.chooserRequests).toHaveLength(1);
    expect(link.name).toBe('IQOS ILUMA i');
  });

  it('works in browsers without getDevices, or where it fails', async () => {
    const without = new FakeBluetooth();
    without.getDevices = undefined;
    await gateway(without).open({ known }, {});
    expect(without.chooserRequests).toHaveLength(1);

    const failing = new FakeBluetooth();
    failing.getDevices = () => Promise.reject(new Error('denied'));
    await gateway(failing).open({ known }, {});
    expect(failing.chooserRequests).toHaveLength(1);
  });
});

describe('disconnecting', () => {
  it('reports a link the device dropped, once', async () => {
    const bluetooth = new FakeBluetooth();
    const reasons: string[] = [];
    const link = await gateway(bluetooth).open({}, { onDisconnect: (reason) => reasons.push(reason) });

    bluetooth.chosen?.drop();
    expect(reasons).toEqual(['the device closed the connection']);
    await expect(link.transport.request(LOAD_BRIGHTNESS)).rejects.toThrow(/closed the connection/);

    link.disconnect();
    expect(reasons).toHaveLength(1);
  });

  it('hangs up on request', async () => {
    const bluetooth = new FakeBluetooth();
    const reasons: string[] = [];
    const link = await gateway(bluetooth).open({}, { onDisconnect: (reason) => reasons.push(reason) });
    link.disconnect();
    expect(bluetooth.chosen?.connected).toBe(false);
    expect(reasons).toEqual(['disconnected']);
  });
});

describe('the app over fake Web Bluetooth', () => {
  it('connects, shows the hidden serial number, and notices a dropped link', async () => {
    const bluetooth = new FakeBluetooth();
    const storage = new Map<string, string>();
    const app = new App({
      storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) },
      bluetooth: gateway(bluetooth),
      version: '0.0.0',
    });

    await app.run('connect');
    expect(app.store.get().device).toMatchObject({ kind: 'ble', model: 'iluma-i' });
    expect(app.store.get().battery).toEqual({ status: 'ready', value: 85 });

    await app.run('info');
    const output = app.store.get().console.map((line) => line.text);
    expect(output).toContain('  Serial number:   hidden by the browser');
    expect(output).toContain('  Model number:    M0022');

    bluetooth.chosen?.drop();
    expect(app.store.get().phase).toBe('idle');
    expect(app.store.get().console.at(-1)?.text).toBe('Disconnected: the device closed the connection');
  });
});
