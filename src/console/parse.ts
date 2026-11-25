/**
 * Console command grammar. It accepts what the `iqos` CLI's interactive
 * prompt accepts, plus the few commands a page needs that a process does not
 * (`connect`, `demo`, `disconnect`, `model`, `refresh`, `clear`).
 */
import { LOCALES, type Locale, parseLocale } from '../i18n/locales';
import { usageError } from '../protocol/errors';
import { type DeviceModel, parseModelSelector } from '../protocol/model';
import { type BrightnessLevel, type FlexBatteryMode, parseBrightnessLevel } from '../protocol/settings';

export type VibrationFlag = 'heating' | 'starting' | 'puffend' | 'terminated' | 'charge';
export type VibrationChanges = Partial<Record<VibrationFlag, boolean>>;
export type ToggleAction = 'enable' | 'disable' | 'status';

export type Command =
  | { readonly name: 'help' | 'version' | 'info' | 'battery' | 'diagnosis' }
  | { readonly name: 'lock' | 'unlock' | 'findmyiqos' }
  | { readonly name: 'disconnect' | 'exit' | 'clear' | 'refresh' }
  | { readonly name: 'brightness'; readonly level?: BrightnessLevel }
  | { readonly name: 'vibration'; readonly changes?: VibrationChanges }
  | { readonly name: 'flexpuff'; readonly action: ToggleAction }
  | { readonly name: 'autostart'; readonly action: ToggleAction }
  | { readonly name: 'smartgesture'; readonly enabled: boolean }
  | { readonly name: 'flexbattery'; readonly mode?: FlexBatteryMode; readonly pause?: boolean }
  | { readonly name: 'device'; readonly action: DeviceAction }
  | { readonly name: 'connect'; readonly target: ConnectTarget }
  | { readonly name: 'demo'; readonly model?: DeviceModel }
  | { readonly name: 'lang'; readonly locale?: Locale }
  | { readonly name: 'model'; readonly model: DeviceModel };

/** Which device `connect` should open. */
export type ConnectTarget =
  | { readonly kind: 'choose' }
  | { readonly kind: 'all' }
  | { readonly kind: 'last' }
  | { readonly kind: 'label'; readonly label: string };

export type DeviceAction =
  | { readonly kind: 'list' }
  | { readonly kind: 'save'; readonly label: string }
  | { readonly kind: 'remove'; readonly label: string };

export const VIBRATION_FLAGS: readonly VibrationFlag[] = [
  'heating',
  'starting',
  'puffend',
  'terminated',
  'charge',
];

/** Every command name, sorted, for completion and `help`. */
export const COMMAND_NAMES: readonly string[] = [
  'autostart',
  'battery',
  'brightness',
  'clear',
  'connect',
  'demo',
  'device',
  'diagnosis',
  'disconnect',
  'exit',
  'findmyiqos',
  'flexbattery',
  'flexpuff',
  'help',
  'info',
  'lang',
  'lock',
  'model',
  'quit',
  'refresh',
  'smartgesture',
  'unlock',
  'version',
  'vibration',
];

const MAX_LINE_LENGTH = 256;

/** Parse one console line. Returns `null` for a blank line; throws on misuse. */
export function parseCommand(line: string): Command | null {
  if (line.length > MAX_LINE_LENGTH) throw usageError('Command is too long');
  const args = line.trim().split(/\s+/).filter((part) => part !== '');
  const [first, ...rest] = args;
  if (first === undefined) return null;

  const name = first.toLowerCase();
  switch (name) {
    case 'help':
    case 'battery':
    case 'diagnosis':
    case 'lock':
    case 'unlock':
    case 'findmyiqos':
      return { name };
    case 'version':
    case 'info':
    case 'disconnect':
    case 'clear':
    case 'refresh':
      if (rest.length > 0) throw usageError(`Usage: ${name}`);
      return { name };
    case 'exit':
    case 'quit':
      return { name: 'exit' };
    case 'brightness':
      return parseBrightness(rest);
    case 'vibration':
      return parseVibration(rest);
    case 'flexpuff':
      return { name, action: parseFlexpuff(rest) };
    case 'autostart':
      return { name, action: parseAutostart(rest) };
    case 'smartgesture':
      return { name, enabled: parseSmartGesture(rest) };
    case 'flexbattery':
      return parseFlexbattery(rest);
    case 'device':
      return { name, action: parseDevice(rest) };
    case 'connect':
      return parseConnect(rest);
    case 'demo':
      return parseDemo(rest);
    case 'model':
      return parseModel(rest);
    case 'lang':
      return parseLanguage(rest);
    default:
      throw usageError(`Unknown command: ${first}`);
  }
}

function parseBrightness(args: readonly string[]): Command {
  const [value, ...extra] = args;
  if (value === undefined) return { name: 'brightness' };
  const level = parseBrightnessLevel(value);
  if (level === null) throw usageError(`Invalid option: ${value}. Use high or low`);
  if (extra.length > 0) throw usageError('Usage: brightness [high|low]');
  return { name: 'brightness', level };
}

function parseVibration(args: readonly string[]): Command {
  if (args.length === 0) return { name: 'vibration' };
  if (args.length % 2 !== 0) {
    throw usageError(
      'Each flag requires a value. Usage: vibration [heating|starting|puffend|terminated|charge] [on|off] ...',
    );
  }

  const changes: VibrationChanges = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = (args[index] ?? '').toLowerCase();
    const value = (args[index + 1] ?? '').toLowerCase();
    if (!isVibrationFlag(flag)) {
      throw usageError(
        `Unknown flag '${flag}'. Valid: heating, starting, puffend, terminated, charge`,
      );
    }
    if (value !== 'on' && value !== 'off') {
      throw usageError(`Invalid value '${value}' for '${flag}'. Use on or off`);
    }
    if (!(flag in changes)) changes[flag] = value === 'on';
  }
  return { name: 'vibration', changes };
}

function isVibrationFlag(value: string): value is VibrationFlag {
  return (VIBRATION_FLAGS as readonly string[]).includes(value);
}

function parseFlexpuff(args: readonly string[]): ToggleAction {
  const [option, ...extra] = args;
  if (option === undefined) return 'status';
  const action = option.toLowerCase();
  if (action !== 'enable' && action !== 'disable' && action !== 'status') {
    throw usageError(`Invalid option: ${option}. Use enable/disable/status`);
  }
  if (extra.length > 0) throw usageError(`Usage: flexpuff ${action}`);
  return action;
}

function parseAutostart(args: readonly string[]): ToggleAction {
  const [option, ...extra] = args;
  if (option === undefined) return 'status';
  if (extra.length > 0) throw usageError('Usage: autostart [enable|on|disable|off|status]');
  switch (option.toLowerCase()) {
    case 'status':
      return 'status';
    case 'on':
    case 'enable':
      return 'enable';
    case 'off':
    case 'disable':
      return 'disable';
    default:
      throw usageError(
        `Invalid option: ${option}. Use enable/on, disable/off, or status (default)`,
      );
  }
}

function parseSmartGesture(args: readonly string[]): boolean {
  const [option, ...extra] = args;
  if (option === undefined) throw usageError('Usage: smartgesture [enable|disable]');
  const action = option.toLowerCase();
  if (action !== 'enable' && action !== 'disable') {
    throw usageError(`Invalid option: ${option}. Use enable/disable`);
  }
  if (extra.length > 0) throw usageError(`Usage: smartgesture ${action}`);
  return action === 'enable';
}

function parseFlexbattery(args: readonly string[]): Command {
  const [option, value, ...extra] = args;
  if (option === undefined) return { name: 'flexbattery' };

  switch (option.toLowerCase()) {
    case 'performance':
    case 'eco':
      if (value !== undefined) throw usageError(`Usage: flexbattery ${option.toLowerCase()}`);
      return { name: 'flexbattery', mode: option.toLowerCase() as FlexBatteryMode };
    case 'pause': {
      if (value === undefined || extra.length > 0) {
        throw usageError('Usage: flexbattery pause [on|off]');
      }
      const pause = value.toLowerCase();
      if (pause !== 'on' && pause !== 'off') {
        throw usageError(`Invalid pause value: ${value}. Use on/off`);
      }
      return { name: 'flexbattery', pause: pause === 'on' };
    }
    default:
      throw usageError(`Invalid option: ${option}. Use performance/eco/pause [on|off]`);
  }
}

function parseDevice(args: readonly string[]): DeviceAction {
  const [option, label, ...extra] = args;
  switch (option?.toLowerCase()) {
    case undefined:
      throw usageError('Usage: device [list|save|remove]');
    case 'list':
      if (label !== undefined) throw usageError('Usage: device list');
      return { kind: 'list' };
    case 'save':
      // The one mistake a control can make here: a label typed in two words.
      if (label === undefined || extra.length > 0) {
        throw usageError('Usage: device save <label>', { key: 'error.saveUsage' });
      }
      return { kind: 'save', label };
    case 'remove':
      if (label === undefined || extra.length > 0) throw usageError('Usage: device remove <label>');
      return { kind: 'remove', label };
    default:
      throw usageError(`Invalid option: ${option}. Use list/save/remove`);
  }
}

function parseConnect(args: readonly string[]): Command {
  const [target, ...extra] = args;
  if (extra.length > 0) throw usageError('Usage: connect [label|--last|--all]');
  if (target === undefined) return { name: 'connect', target: { kind: 'choose' } };
  if (target === '--all') return { name: 'connect', target: { kind: 'all' } };
  if (target === '--last') return { name: 'connect', target: { kind: 'last' } };
  if (target.startsWith('-')) {
    throw usageError(`Invalid option: ${target}. Use a saved label, --last or --all`);
  }
  return { name: 'connect', target: { kind: 'label', label: target } };
}

function parseDemo(args: readonly string[]): Command {
  const [selector, ...extra] = args;
  if (extra.length > 0) throw usageError('Usage: demo [model]');
  if (selector === undefined) return { name: 'demo' };
  return { name: 'demo', model: requireModel(selector) };
}

/** `lang` asks which language the page is in; `lang <code>` chooses one. */
function parseLanguage(args: readonly string[]): Command {
  const [code, ...extra] = args;
  if (code === undefined) return { name: 'lang' };
  const locale = parseLocale(code);
  if (locale === null || extra.length > 0) throw usageError(`Usage: lang [${LOCALES.join('|')}]`);
  return { name: 'lang', locale };
}

function parseModel(args: readonly string[]): Command {
  const [selector, ...extra] = args;
  if (selector === undefined || extra.length > 0) throw usageError('Usage: model <model>');
  return { name: 'model', model: requireModel(selector) };
}

function requireModel(selector: string): DeviceModel {
  const model = parseModelSelector(selector);
  if (model === null) {
    throw usageError(
      `Invalid option: ${selector}. Use iluma, iluma-one, iluma-prime, iluma-i, iluma-i-one or iluma-i-prime`,
    );
  }
  return model;
}
