/** What each console command does. Output follows the `iqos` CLI. */
import type { Command, DeviceAction, ToggleAction, VibrationChanges } from '../console/parse';
import type { MessageRef } from '../i18n/message';
import type { MessageKey } from '../i18n/messages/en';
import { usageError } from '../protocol/errors';
import { supports } from '../protocol/model';
import type { VibrationSettings } from '../protocol/vibration';
import { withDevice, withoutDevice } from '../storage/devices';
import type { App, FieldKey, FieldValue, Session } from './app';
import { appError, errorRef } from './messages';
import {
  enabledText,
  formatDiagnosis,
  formatFlexbattery,
  formatInfo,
  formatSavedDevices,
  formatVibration,
  helpLines,
} from './format';

/** `enabled` or `disabled`, as a value inside an answer. */
const enabledRef = (value: boolean): MessageRef => ({ key: value ? 'value.enabled' : 'value.disabled' });

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
    case 'lang':
      return command.locale === undefined ? app.sayLanguage() : app.setLocale(command.locale);
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
  const reads: [MessageKey, () => Promise<unknown>][] = [
    ['reading.battery', () => app.load('battery', () => link.readBatteryLevel())],
    ['reading.status', () => app.load('status', () => iqos.readStatus())],
  ];
  if (iqos.supports('brightness')) {
    reads.push(['reading.brightness', () => app.load('brightness', () => iqos.readBrightness())]);
  }
  if (iqos.supports('vibration')) {
    reads.push(['reading.vibration', () => app.load('vibration', () => iqos.readVibration())]);
  }
  if (iqos.supports('flexpuff')) {
    reads.push(['reading.flexpuff', () => app.load('flexpuff', () => iqos.readFlexpuff())]);
  }
  if (iqos.supports('flexbattery')) {
    reads.push(['reading.flexbattery', () => app.load('flexbattery', () => iqos.readFlexbattery())]);
  }
  if (iqos.supports('autostart')) {
    reads.push(['reading.autostart', () => app.load('autostart', () => iqos.readAutostart())]);
  }

  for (const [name, read] of reads) {
    if (app.store.get().phase !== 'connected') return;
    try {
      await read();
    } catch (error) {
      app.say({ key: 'result.couldNotRead', params: { name: { key: name }, detail: errorRef(error) } }, 'note');
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
    app.say({ key: 'result.readBackFailed', params: { detail: errorRef(error) } }, 'note');
    return undefined;
  }
}

async function battery(app: App): Promise<void> {
  const { link } = app.session();
  const level = await app.load('battery', () => link.readBatteryLevel());
  app.say({ key: 'result.battery', params: { level } });
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
  app.say({ key: locked ? 'result.locked' : 'result.unlocked' });
}

async function findMyIqos(app: App): Promise<void> {
  const { iqos, device } = app.session();
  app.say({ key: 'result.findStarting' });
  await iqos.findStart();
  app.patchDevice(device, (state) => ({ ...state, finding: true }));
  if (app.store.get().finding) app.print('Press <Enter> to stop');
}

async function brightness(app: App, level: 'high' | 'low' | undefined): Promise<void> {
  const { iqos } = app.session();
  if (!iqos.supports('brightness')) return app.say({ key: 'result.brightnessUnsupported' });

  if (level === undefined) {
    const current = await app.load('brightness', () => iqos.readBrightness());
    return app.say({ key: 'result.brightness', params: { level: { key: `value.${current}` } } });
  }
  await iqos.setBrightness(level);
  app.say({ key: 'result.brightnessSet', params: { level: { key: `value.${level}` } } });
  const actual = await readBack(app, 'brightness', () => iqos.readBrightness());
  if (actual !== undefined && actual !== level) {
    app.say({ key: 'result.stillReports', params: { level: { key: `value.${actual}` } } }, 'note');
  }
}

async function vibration(app: App, changes: VibrationChanges | undefined): Promise<void> {
  const session = app.session();
  const { iqos } = session;
  if (!iqos.supports('vibration')) return app.say({ key: 'result.vibrationUnsupported' });

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
  app.say({ key: 'result.vibrationUpdated' });
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
  if (!iqos.supports('flexpuff')) return app.say({ key: 'result.flexpuffUnsupported' });

  if (action === 'status') {
    const enabled = await app.load('flexpuff', () => iqos.readFlexpuff());
    return app.print(`FlexPuff: ${enabledText(enabled)}`);
  }
  await iqos.setFlexpuff(action === 'enable');
  app.say({ key: 'result.flexpuffSet', params: { state: enabledRef(action === 'enable') } });
  await readBack(app, 'flexpuff', () => iqos.readFlexpuff());
}

async function autostart(app: App, action: ToggleAction): Promise<void> {
  const { iqos } = app.session();
  if (!iqos.supports('autostart')) return app.say({ key: 'result.autostartUnsupported' });

  if (action === 'status') {
    const enabled = await app.load('autostart', () => iqos.readAutostart());
    return app.print(`Autostart: ${enabledText(enabled)}`);
  }
  await iqos.setAutostart(action === 'enable');
  app.say({ key: 'result.autostartSet', params: { state: enabledRef(action === 'enable') } });
  await readBack(app, 'autostart', () => iqos.readAutostart());
}

async function smartGesture(app: App, enabled: boolean): Promise<void> {
  const { iqos, device } = app.session();
  if (!iqos.supports('smartgesture')) {
    return app.say({ key: 'result.gestureUnsupported' });
  }
  await iqos.setSmartGesture(enabled);
  app.patchDevice(device, (state) => ({ ...state, smartGesture: enabled }));
  app.say({ key: 'result.gestureSet', params: { state: enabledRef(enabled) } });
}

async function flexbattery(
  app: App,
  mode: 'performance' | 'eco' | undefined,
  pause: boolean | undefined,
): Promise<void> {
  const { iqos } = app.session();
  if (!iqos.supports('flexbattery')) {
    return app.say({ key: 'result.flexbatteryUnsupported' });
  }

  if (mode === undefined && pause === undefined) {
    const current = await app.load('flexbattery', () => iqos.readFlexbattery());
    return app.print(formatFlexbattery(current));
  }
  // Changing only Pause Mode still writes the mode, as the CLI does, so the
  // current mode is read first and sent back unchanged.
  const target = mode ?? (await app.load('flexbattery', () => iqos.readFlexbattery())).mode;
  await iqos.setFlexbattery({ mode: target, ...(pause === undefined ? {} : { pause }) });
  app.say({ key: 'result.flexbatteryUpdated' });
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
        throw appError('usage', { key: 'error.simulatedNotSaved' });
      }
      const saved = { id: connected.id, name: connected.name, model: connected.model };
      app.setBook(withDevice(book, action.label, saved));
      return app.say({ key: 'result.labelSaved', params: { label: action.label.trim() } });
    }
    case 'remove': {
      const next = withoutDevice(book, action.label);
      if (next === null) {
        throw appError('usage', { key: 'error.labelNotFound', params: { label: action.label.trim() } });
      }
      app.setBook(next);
      return app.say({ key: 'result.labelRemoved', params: { label: action.label.trim() } });
    }
  }
}
