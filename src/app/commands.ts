/** What each console command does. Output follows the `iqos` CLI. */
import type { Command, DeviceAction, ToggleAction, VibrationChanges } from '../console/parse';
import { describeError, usageError } from '../protocol/errors';
import { supports } from '../protocol/model';
import type { VibrationSettings } from '../protocol/vibration';
import { withDevice, withoutDevice } from '../storage/devices';
import type { App, FieldKey, FieldValue, Session } from './app';
import {
  enabledText,
  formatDiagnosis,
  formatFlexbattery,
  formatInfo,
  formatSavedDevices,
  formatVibration,
  helpLines,
} from './format';

export async function runCommand(app: App, command: Command): Promise<void> {
  switch (command.name) {
    case 'help':
      return app.print(helpLines(app.store.get().device?.model ?? null, app.canSimulate).join('\n'));
    case 'version':
      return app.print(`sphere ${app.version}`);
    case 'clear':
      return app.clearConsole();
    case 'connect':
      return app.connect(command.target);
    case 'demo':
      return app.demo(command.model);
    case 'disconnect':
      return app.disconnect();
    case 'exit':
      // Reached only with trailing arguments; a bare `exit` skips the queue.
      app.print('Goodbye!');
      if (app.store.get().phase === 'connected') await app.disconnect();
      return;
    case 'model':
      return app.setModel(command.model);
    case 'device':
      return device(app, command.action);
    case 'refresh':
      app.session();
      return refreshDevice(app);
    case 'battery':
      return battery(app);
    case 'info':
      return info(app);
    case 'diagnosis':
      return diagnosis(app);
    case 'lock':
      return lock(app, true);
    case 'unlock':
      return lock(app, false);
    case 'findmyiqos':
      return findMyIqos(app);
    case 'brightness':
      return brightness(app, command.level);
    case 'vibration':
      return vibration(app, command.changes);
    case 'flexpuff':
      return flexpuff(app, command.action);
    case 'autostart':
      return autostart(app, command.action);
    case 'smartgesture':
      return smartGesture(app, command.enabled);
    case 'flexbattery':
      return flexbattery(app, command.mode, command.pause);
  }
}

/**
 * Read everything the panels show. Each read stands alone: one that fails is
 * reported and the rest still run.
 */
export async function refreshDevice(app: App): Promise<void> {
  const { iqos, link } = app.session();
  const reads: [string, () => Promise<unknown>][] = [
    ['battery level', () => app.load('battery', () => link.readBatteryLevel())],
    ['device information', () => app.load('status', () => iqos.readStatus())],
  ];
  if (iqos.supports('brightness')) {
    reads.push(['brightness', () => app.load('brightness', () => iqos.readBrightness())]);
  }
  if (iqos.supports('vibration')) {
    reads.push(['vibration', () => app.load('vibration', () => iqos.readVibration())]);
  }
  if (iqos.supports('flexpuff')) {
    reads.push(['FlexPuff', () => app.load('flexpuff', () => iqos.readFlexpuff())]);
  }
  if (iqos.supports('flexbattery')) {
    reads.push(['FlexBattery', () => app.load('flexbattery', () => iqos.readFlexbattery())]);
  }
  if (iqos.supports('autostart')) {
    reads.push(['Auto Start', () => app.load('autostart', () => iqos.readAutostart())]);
  }

  for (const [name, read] of reads) {
    if (app.store.get().phase !== 'connected') return;
    try {
      await read();
    } catch (error) {
      app.print(`Could not read ${name}: ${describeError(error)}`, 'note');
    }
  }
}

/**
 * Read a setting again after writing it, so the panes show what the device
 * holds. The write has already succeeded here, so a failed read-back is a
 * note, not an error.
 */
async function readBack<K extends FieldKey>(
  app: App,
  key: K,
  read: () => Promise<FieldValue<K>>,
): Promise<FieldValue<K> | undefined> {
  try {
    return await app.load(key, read);
  } catch (error) {
    app.print(`Written, but reading it back failed: ${describeError(error)}`, 'note');
    return undefined;
  }
}

async function battery(app: App): Promise<void> {
  const { link } = app.session();
  const level = await app.load('battery', () => link.readBatteryLevel());
  app.print(`Battery: ${level}%`);
}

async function info(app: App): Promise<void> {
  const { iqos, device } = app.session();
  const status = await app.load('status', () => iqos.readStatus());
  app.print(formatInfo(device, status).join('\n'));
}

async function diagnosis(app: App): Promise<void> {
  const { iqos } = app.session();
  const data = await app.load('diagnosis', () => iqos.readDiagnosis());
  app.print(formatDiagnosis(data).join('\n'));
}

async function lock(app: App, locked: boolean): Promise<void> {
  const { iqos, device } = app.session();
  await (locked ? iqos.lock() : iqos.unlock());
  app.patchDevice(device, (state) => ({ ...state, locked }));
  app.print(locked ? 'Device locked' : 'Device unlocked');
}

async function findMyIqos(app: App): Promise<void> {
  const { iqos, device } = app.session();
  app.print('Starting Find My IQOS...');
  await iqos.findStart();
  app.patchDevice(device, (state) => ({ ...state, finding: true }));
  if (app.store.get().finding) app.print('Press <Enter> to stop');
}

async function brightness(app: App, level: 'high' | 'low' | undefined): Promise<void> {
  const { iqos } = app.session();
  if (!iqos.supports('brightness')) return app.print('Brightness not supported on this device');

  if (level === undefined) {
    const current = await app.load('brightness', () => iqos.readBrightness());
    return app.print(`Brightness: ${current}`);
  }
  await iqos.setBrightness(level);
  app.print(`Brightness set to ${level}`);
  const actual = await readBack(app, 'brightness', () => iqos.readBrightness());
  if (actual !== undefined && actual !== level) {
    app.print(`The device still reports ${actual}.`, 'note');
  }
}

async function vibration(app: App, changes: VibrationChanges | undefined): Promise<void> {
  const session = app.session();
  const { iqos } = session;
  if (!iqos.supports('vibration')) return app.print('Vibration is not supported on this device');

  if (changes === undefined) {
    const current = await app.load('vibration', () => iqos.readVibration());
    return app.print(formatVibration(current));
  }
  if (changes.charge !== undefined && !iqos.supports('charge-vibration')) {
    throw usageError("'charge' flag is not supported on this device");
  }

  const current = await app.load('vibration', () => iqos.readVibration());
  const next = applyVibrationChanges(current, changes, session);
  await iqos.updateVibration(next);
  app.print('Vibration settings updated');
  await readBack(app, 'vibration', () => iqos.readVibration());
}

function applyVibrationChanges(
  current: VibrationSettings,
  changes: VibrationChanges,
  session: Session,
): VibrationSettings {
  const core = {
    heating: changes.heating ?? current.heating,
    starting: changes.starting ?? current.starting,
    puffEnd: changes.puffend ?? current.puffEnd,
    terminated: changes.terminated ?? current.terminated,
  };
  return supports(session.device.model, 'charge-vibration')
    ? { ...core, charge: changes.charge ?? current.charge ?? false }
    : core;
}

async function flexpuff(app: App, action: ToggleAction): Promise<void> {
  const { iqos } = app.session();
  if (!iqos.supports('flexpuff')) return app.print('FlexPuff is not supported on this device');

  if (action === 'status') {
    const enabled = await app.load('flexpuff', () => iqos.readFlexpuff());
    return app.print(`FlexPuff: ${enabledText(enabled)}`);
  }
  await iqos.setFlexpuff(action === 'enable');
  app.print(`FlexPuff ${enabledText(action === 'enable')}`);
  await readBack(app, 'flexpuff', () => iqos.readFlexpuff());
}

async function autostart(app: App, action: ToggleAction): Promise<void> {
  const { iqos } = app.session();
  if (!iqos.supports('autostart')) return app.print('AutoStart is not supported on this device');

  if (action === 'status') {
    const enabled = await app.load('autostart', () => iqos.readAutostart());
    return app.print(`Autostart: ${enabledText(enabled)}`);
  }
  await iqos.setAutostart(action === 'enable');
  app.print(`Autostart ${enabledText(action === 'enable')}`);
  await readBack(app, 'autostart', () => iqos.readAutostart());
}

async function smartGesture(app: App, enabled: boolean): Promise<void> {
  const { iqos, device } = app.session();
  if (!iqos.supports('smartgesture')) {
    return app.print('SmartGesture is not supported on this device');
  }
  await iqos.setSmartGesture(enabled);
  app.patchDevice(device, (state) => ({ ...state, smartGesture: enabled }));
  app.print(`Smart Gesture ${enabledText(enabled)}`);
}

async function flexbattery(
  app: App,
  mode: 'performance' | 'eco' | undefined,
  pause: boolean | undefined,
): Promise<void> {
  const { iqos } = app.session();
  if (!iqos.supports('flexbattery')) {
    return app.print('FlexBattery is only available on ILUMA i and ILUMA i PRIME devices');
  }

  if (mode === undefined && pause === undefined) {
    const current = await app.load('flexbattery', () => iqos.readFlexbattery());
    return app.print(formatFlexbattery(current));
  }
  // Changing only Pause Mode still writes the mode, as the CLI does, so the
  // current mode is read first and sent back unchanged.
  const target = mode ?? (await app.load('flexbattery', () => iqos.readFlexbattery())).mode;
  await iqos.setFlexbattery({ mode: target, ...(pause === undefined ? {} : { pause }) });
  app.print('FlexBattery settings updated');
  await readBack(app, 'flexbattery', () => iqos.readFlexbattery());
}

function device(app: App, action: DeviceAction): void {
  const { book } = app.store.get();
  switch (action.kind) {
    case 'list':
      return app.print(formatSavedDevices(book).join('\n'));
    case 'save': {
      const connected = app.store.get().device;
      if (connected === null) throw usageError('No connected device metadata available');
      if (connected.kind === 'simulated') {
        throw usageError('The simulated device cannot be saved.');
      }
      const saved = { id: connected.id, name: connected.name, model: connected.model };
      app.setBook(withDevice(book, action.label, saved));
      return app.print(`Saved device label: ${action.label.trim()}`);
    }
    case 'remove': {
      const next = withoutDevice(book, action.label);
      if (next === null) throw usageError(`Device label not found: ${action.label.trim()}`);
      app.setBook(next);
      return app.print(`Removed device label: ${action.label.trim()}`);
    }
  }
}
