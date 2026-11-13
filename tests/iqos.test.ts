import { describe, expect, it } from 'vitest';
import { Iqos } from '../src/device/iqos';
import { toHex } from '../src/protocol/bytes';
import { SphereError } from '../src/protocol/errors';
import { formatFirmware } from '../src/protocol/identity';
import { classicFrame, frameError } from '../src/protocol/scp';
import type { WireEvent } from '../src/transport/session';
import { SimulatedDevice, openSimulatedLink, type SimulatorOptions } from '../src/transport/simulator';

function connect(options: SimulatorOptions = {}): {
  device: SimulatedDevice;
  iqos: Iqos;
  wire: WireEvent[];
  sent: () => string[];
} {
  const device = new SimulatedDevice(options);
  const wire: WireEvent[] = [];
  const link = openSimulatedLink(device, { onWire: (event) => wire.push(event) }, 200);
  return {
    device,
    iqos: new Iqos(link.transport, device.model),
    wire,
    sent: () => device.received.map(toHex),
  };
}

describe('Iqos against the simulator', () => {
  it('reads and writes brightness', async () => {
    const { iqos, device, sent } = connect({ state: { brightness: 'high' } });
    expect(await iqos.readBrightness()).toBe('high');

    await iqos.setBrightness('low');
    expect(device.state.brightness).toBe('low');
    expect(await iqos.readBrightness()).toBe('low');
    expect(sent().slice(1, 4)).toEqual([
      '00 C0 46 23 1E 00 00 00 E1',
      '00 C0 02 23 C3',
      '00 C9 44 24 1E 00 00 00 9A',
    ]);
  });

  it('reads and writes FlexPuff', async () => {
    const { iqos, device } = connect({ state: { flexpuff: false } });
    expect(await iqos.readFlexpuff()).toBe(false);
    await iqos.setFlexpuff(true);
    expect(device.state.flexpuff).toBe(true);
    expect(await iqos.readFlexpuff()).toBe(true);
  });

  it('reads FlexBattery mode and pause', async () => {
    const { iqos } = connect({ state: { eco: true, pause: false } });
    expect(await iqos.readFlexbattery()).toEqual({ mode: 'eco', pause: false });
  });

  it('writes the FlexBattery mode alone when pause is not given', async () => {
    const { iqos, device, sent } = connect({ state: { eco: false, pause: true } });
    await iqos.setFlexbattery({ mode: 'eco' });
    expect(device.state.eco).toBe(true);
    expect(device.state.pause).toBe(true);
    expect(sent()).toEqual(['00 C9 44 25 01 00 00 00 4D', '00 C9 00 25 FB']);
  });

  it('writes mode and pause together', async () => {
    const { iqos, device, sent } = connect({ state: { eco: true, pause: true } });
    await iqos.setFlexbattery({ mode: 'performance', pause: false });
    expect(device.state).toMatchObject({ eco: false, pause: false });
    expect(sent()).toEqual([
      '00 C9 44 25 00 00 00 00 5B',
      '00 C9 00 25 FB',
      '00 C9 47 24 02 00 00 00 6E',
      '00 C9 07 24 02 00 00 00 18',
    ]);
  });

  it('toggles Smart Gesture and Auto Start', async () => {
    const { iqos, device } = connect({ state: { smartGesture: true, autostart: true } });
    await iqos.setSmartGesture(false);
    expect(device.state.smartGesture).toBe(false);

    expect(await iqos.readAutostart()).toBe(true);
    await iqos.setAutostart(false);
    expect(await iqos.readAutostart()).toBe(false);
  });

  it('locks and unlocks with the three-frame sequences', async () => {
    const { iqos, device, sent } = connect();
    await iqos.lock();
    expect(device.state.locked).toBe(true);
    await iqos.unlock();
    expect(device.state.locked).toBe(false);
    expect(sent()).toEqual([
      '00 C9 44 04 02 FF 00 00 5A',
      '00 C9 00 04 1C',
      '00 C0 01 00 15',
      '00 C9 44 04 00 00 00 00 5D',
      '00 C9 00 04 1C',
      '00 C0 01 00 15',
    ]);
  });

  it('reads vibration including the charge flag on holder models', async () => {
    const { iqos } = connect({
      state: { heating: true, starting: false, puffEnd: true, terminated: false, charge: false },
    });
    expect(await iqos.readVibration()).toEqual({
      heating: true,
      starting: false,
      puffEnd: true,
      terminated: false,
      charge: false,
    });
  });

  it('omits the charge flag on one-piece models', async () => {
    const { iqos, sent } = connect({ name: 'IQOS ILUMA ONE' });
    const settings = await iqos.readVibration();
    expect(settings.charge).toBeUndefined();
    expect(sent()).toEqual(['00 C9 00 23 E9']);
  });

  it('updates vibration and the charge flag', async () => {
    const { iqos, device } = connect({ state: { charge: true } });
    await iqos.updateVibration({
      heating: false,
      starting: true,
      puffEnd: false,
      terminated: true,
      charge: false,
    });
    expect(device.state).toMatchObject({
      heating: false,
      starting: true,
      puffEnd: false,
      terminated: true,
      charge: false,
    });
  });

  it('reads the charge flag first when an update leaves it out', async () => {
    const { iqos, device, sent } = connect({ state: { charge: true } });
    await iqos.updateVibration({ heating: true, starting: true, puffEnd: true, terminated: true });
    expect(sent()[0]).toBe('00 C9 07 04 04 00 00 00 08');
    expect(device.state.charge).toBe(true);
  });

  it('reads device status', async () => {
    const { iqos } = connect({ state: { batteryMillivolts: 3870 } });
    const status = await iqos.readStatus();
    expect(status.productNumber).toBe('SIMCHARGER0001');
    expect(status.holderProductNumber).toBe('SIMHOLDER00001');
    expect(formatFirmware(status.stickFirmware)).toBe('v1.2.3.24');
    expect(formatFirmware(status.holderFirmware!)).toBe('v1.2.3.24');
    expect(status.batteryVoltage).toBeCloseTo(3.87, 5);
    expect(status.holderError).toBeUndefined();
  });

  it('skips holder identity on one-piece models', async () => {
    const { iqos, sent } = connect({ name: 'IQOS ILUMA i ONE' });
    const status = await iqos.readStatus();
    expect(status.holderFirmware).toBeUndefined();
    expect(sent().some((frame) => frame.startsWith('00 C9'))).toBe(false);
  });

  it('reads diagnosis', async () => {
    const { iqos } = connect({ state: { puffCount: 2033, daysUsed: 941, batteryMillivolts: 4072 } });
    const diagnosis = await iqos.readDiagnosis();
    expect(diagnosis.puffCount).toBe(2033);
    expect(diagnosis.daysUsed).toBe(941);
    expect(diagnosis.batteryVoltage).toBeCloseTo(4.072, 5);
    expect(diagnosis.telemetryRecords).toHaveLength(4);
    expect(diagnosis.deviceTimeRaw).toHaveLength(8);
  });

  it('starts and stops Find My IQOS', async () => {
    const { iqos, device } = connect();
    await iqos.findStart();
    expect(device.state.vibrating).toBe(true);
    await iqos.findStop();
    expect(device.state.vibrating).toBe(false);
  });

  it('works when the device fragments its replies', async () => {
    const { iqos } = connect({ fragmentReplies: true });
    expect((await iqos.readDiagnosis()).telemetryRecords).toHaveLength(4);
    expect((await iqos.readVibration()).charge).toBe(true);
  });

  it('only exchanges valid frames', async () => {
    const { iqos, wire } = connect();
    await iqos.readStatus();
    await iqos.readDiagnosis();
    await iqos.updateVibration({ heating: true, starting: false, puffEnd: false, terminated: false });
    expect(wire.length).toBeGreaterThan(10);
    for (const event of wire) expect(frameError(event.frame)).toBeNull();
    expect(wire.every((event) => event.direction !== 'stray')).toBe(true);
  });

  it('refuses features the model lacks', async () => {
    const { iqos, sent } = connect({ name: 'IQOS ILUMA ONE' });
    await expect(iqos.readFlexpuff()).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(iqos.setFlexpuff(true)).rejects.toThrow(/FlexPuff is not supported/);
    await expect(iqos.setFlexbattery({ mode: 'eco' })).rejects.toThrow(/FlexBattery/);
    await expect(iqos.readFlexbattery()).rejects.toThrow(/FlexBattery/);
    await expect(iqos.setSmartGesture(true)).rejects.toThrow(/Smart Gesture/);
    await expect(iqos.setAutostart(true)).rejects.toThrow(/Auto Start/);
    await expect(iqos.readAutostart()).rejects.toThrow(/Auto Start/);
    expect(sent()).toEqual([]);
  });

  it('refuses everything model-specific on an unknown model', async () => {
    const { iqos } = connect({ name: 'mystery' });
    await expect(iqos.readBrightness()).rejects.toThrow(/brightness is not supported/);
    await expect(iqos.setBrightness('low')).rejects.toBeInstanceOf(SphereError);
    await expect(iqos.readVibration()).rejects.toBeInstanceOf(SphereError);
    await expect(
      iqos.updateVibration({ heating: true, starting: true, puffEnd: true, terminated: true }),
    ).rejects.toBeInstanceOf(SphereError);
    await expect(iqos.lock()).rejects.toThrow(/device lock/);
    await expect(iqos.unlock()).rejects.toThrow(/device lock/);
  });

  it('reports an unreachable holder without failing the status read', async () => {
    const device = new SimulatedDevice();
    const link = openSimulatedLink(device, {}, 200);
    const flaky = {
      request: (command: Uint8Array): Promise<Uint8Array> =>
        command[1] === 0xc9
          ? Promise.reject(new SphereError('transport', 'timed out waiting for the device to answer'))
          : link.transport.request(command),
    };
    const status = await new Iqos(flaky, 'iluma-i').readStatus();
    expect(status.productNumber).toBe('SIMCHARGER0001');
    expect(status.holderFirmware).toBeUndefined();
    expect(status.holderError).toMatch(/timed out/);
  });

  it('leaves battery voltage out when the device rejects the read', async () => {
    const device = new SimulatedDevice({ name: 'IQOS ILUMA ONE' });
    const link = openSimulatedLink(device, {}, 200);
    const noLifeData = {
      request: (command: Uint8Array): Promise<Uint8Array> =>
        command[3] === 0x21
          ? Promise.reject(new SphereError('decode', 'SCP device error: 01'))
          : link.transport.request(command),
    };
    const status = await new Iqos(noLifeData, 'iluma-one').readStatus();
    expect(status.batteryVoltage).toBeUndefined();
  });

  it('does not hide programming errors behind a status result', async () => {
    const broken = {
      request: (): Promise<Uint8Array> => Promise.reject(new TypeError('boom')),
    };
    await expect(new Iqos(broken, 'iluma-one').readStatus()).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a diagnostic response that answers a different command', async () => {
    const wrong = {
      request: async (): Promise<Uint8Array> => Uint8Array.from([0x00, 0xc0, 0x86, 0x23, 0x64, 0, 0, 0, 0xd5]),
    };
    await expect(new Iqos(wrong, 'iluma-i').readDiagnosis()).rejects.toThrow(/does not match/);
  });
});

describe('SimulatedDevice', () => {
  it('answers unknown commands with a device error', async () => {
    const device = new SimulatedDevice();
    const link = openSimulatedLink(device, {}, 200);
    const unknown = classicFrame(0xc0, 0x00, 0x7f);
    await expect(link.transport.request(unknown)).rejects.toThrow(/device error/i);
  });

  it('times out when the device goes silent', async () => {
    const device = new SimulatedDevice();
    device.silent = true;
    const link = openSimulatedLink(device, {}, 20);
    await expect(new Iqos(link.transport, device.model).readBrightness()).rejects.toThrow(/timed out/);
  });

  it('exposes the battery level and link metadata', async () => {
    const device = new SimulatedDevice({ state: { batteryLevel: 61 } });
    let reason = '';
    const link = openSimulatedLink(device, { onDisconnect: (why) => (reason = why) });
    expect(link.kind).toBe('simulated');
    expect(link.name).toBe('IQOS ILUMA i');
    expect(await link.readBatteryLevel()).toBe(61);

    link.disconnect();
    link.disconnect();
    expect(reason).toBe('disconnected');
    await expect(link.transport.request(Uint8Array.from([0, 0xc0, 0x02, 0x23, 0xc3]))).rejects.toThrow(
      /disconnected/,
    );
  });

  it('delays replies when latency is set', async () => {
    const device = new SimulatedDevice({ latencyMs: 5 });
    const link = openSimulatedLink(device, {}, 200);
    expect(await new Iqos(link.transport, device.model).readBrightness()).toBe('high');
  });
});
