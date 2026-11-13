import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/console/parse';
import { describeError, SphereError } from '../src/protocol/errors';
import {
  EMPTY_BOOK,
  STORAGE_KEY,
  findDevice,
  loadBook,
  normalizeLabel,
  saveBook,
  sortedLabels,
  validateLabel,
  withDevice,
  withLast,
  withoutDevice,
  type KeyValueStore,
  type SavedDevice,
} from '../src/storage/devices';

const usage = (line: string): string => {
  try {
    parseCommand(line);
  } catch (error) {
    expect(error).toBeInstanceOf(SphereError);
    expect((error as SphereError).kind).toBe('usage');
    return (error as SphereError).message;
  }
  throw new Error(`expected "${line}" to be rejected`);
};

describe('parseCommand', () => {
  it('returns null for blank lines', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  it('parses commands without arguments, case-insensitively', () => {
    expect(parseCommand('battery')).toEqual({ name: 'battery' });
    expect(parseCommand('  HELP ')).toEqual({ name: 'help' });
    expect(parseCommand('quit')).toEqual({ name: 'exit' });
    expect(parseCommand('exit')).toEqual({ name: 'exit' });
    expect(parseCommand('lock')).toEqual({ name: 'lock' });
    expect(parseCommand('findmyiqos')).toEqual({ name: 'findmyiqos' });
  });

  it('rejects stray arguments where the CLI does', () => {
    expect(usage('info now')).toBe('Usage: info');
    expect(usage('version 2')).toBe('Usage: version');
    expect(usage('clear all')).toBe('Usage: clear');
  });

  it('rejects unknown commands and overlong input', () => {
    expect(usage('reboot')).toBe('Unknown command: reboot');
    expect(usage('x'.repeat(300))).toMatch(/too long/);
  });

  it('parses brightness', () => {
    expect(parseCommand('brightness')).toEqual({ name: 'brightness' });
    expect(parseCommand('brightness HIGH')).toEqual({ name: 'brightness', level: 'high' });
    expect(usage('brightness medium')).toMatch(/Invalid option: medium/);
    expect(usage('brightness low now')).toMatch(/^Usage: brightness/);
  });

  it('parses vibration flag pairs', () => {
    expect(parseCommand('vibration')).toEqual({ name: 'vibration' });
    expect(parseCommand('vibration heating on puffend off')).toEqual({
      name: 'vibration',
      changes: { heating: true, puffend: false },
    });
    expect(parseCommand('vibration charge on')).toEqual({ name: 'vibration', changes: { charge: true } });
  });

  it('keeps the first value when a vibration flag repeats', () => {
    expect(parseCommand('vibration heating on heating off')).toEqual({
      name: 'vibration',
      changes: { heating: true },
    });
  });

  it('rejects malformed vibration arguments', () => {
    expect(usage('vibration heating')).toMatch(/Each flag requires a value/);
    expect(usage('vibration turbo on')).toMatch(/Unknown flag 'turbo'/);
    expect(usage('vibration heating yes')).toMatch(/Invalid value 'yes' for 'heating'/);
  });

  it('parses flexpuff', () => {
    expect(parseCommand('flexpuff')).toEqual({ name: 'flexpuff', action: 'status' });
    expect(parseCommand('flexpuff enable')).toEqual({ name: 'flexpuff', action: 'enable' });
    expect(parseCommand('flexpuff disable')).toEqual({ name: 'flexpuff', action: 'disable' });
    expect(parseCommand('flexpuff status')).toEqual({ name: 'flexpuff', action: 'status' });
    expect(usage('flexpuff enable typo')).toBe('Usage: flexpuff enable');
    expect(usage('flexpuff on')).toMatch(/Invalid option: on/);
  });

  it('parses autostart with its aliases', () => {
    expect(parseCommand('autostart')).toEqual({ name: 'autostart', action: 'status' });
    expect(parseCommand('autostart on')).toEqual({ name: 'autostart', action: 'enable' });
    expect(parseCommand('autostart enable')).toEqual({ name: 'autostart', action: 'enable' });
    expect(parseCommand('autostart off')).toEqual({ name: 'autostart', action: 'disable' });
    expect(parseCommand('autostart disable')).toEqual({ name: 'autostart', action: 'disable' });
    expect(parseCommand('autostart status')).toEqual({ name: 'autostart', action: 'status' });
    expect(usage('autostart enable typo')).toMatch(/^Usage: autostart/);
    expect(usage('autostart bogus')).toMatch(/Invalid option: bogus/);
  });

  it('parses smartgesture, which has no status', () => {
    expect(parseCommand('smartgesture enable')).toEqual({ name: 'smartgesture', enabled: true });
    expect(parseCommand('smartgesture disable')).toEqual({ name: 'smartgesture', enabled: false });
    expect(usage('smartgesture')).toBe('Usage: smartgesture [enable|disable]');
    expect(usage('smartgesture status')).toMatch(/Invalid option: status/);
    expect(usage('smartgesture enable typo')).toBe('Usage: smartgesture enable');
  });

  it('parses flexbattery', () => {
    expect(parseCommand('flexbattery')).toEqual({ name: 'flexbattery' });
    expect(parseCommand('flexbattery eco')).toEqual({ name: 'flexbattery', mode: 'eco' });
    expect(parseCommand('flexbattery Performance')).toEqual({ name: 'flexbattery', mode: 'performance' });
    expect(parseCommand('flexbattery pause on')).toEqual({ name: 'flexbattery', pause: true });
    expect(parseCommand('flexbattery pause off')).toEqual({ name: 'flexbattery', pause: false });
    expect(usage('flexbattery pause')).toBe('Usage: flexbattery pause [on|off]');
    expect(usage('flexbattery pause yes')).toMatch(/Invalid pause value: yes/);
    expect(usage('flexbattery eco now')).toBe('Usage: flexbattery eco');
    expect(usage('flexbattery turbo')).toMatch(/Invalid option: turbo/);
  });

  it('parses device memory commands', () => {
    expect(parseCommand('device list')).toEqual({ name: 'device', action: { kind: 'list' } });
    expect(parseCommand('device save minera')).toEqual({
      name: 'device',
      action: { kind: 'save', label: 'minera' },
    });
    expect(parseCommand('device remove minera')).toEqual({
      name: 'device',
      action: { kind: 'remove', label: 'minera' },
    });
    expect(usage('device')).toBe('Usage: device [list|save|remove]');
    expect(usage('device list all')).toBe('Usage: device list');
    expect(usage('device save')).toBe('Usage: device save <label>');
    expect(usage('device remove a b')).toBe('Usage: device remove <label>');
    expect(usage('device rename a')).toMatch(/Invalid option: rename/);
  });

  it('parses connection commands', () => {
    expect(parseCommand('connect')).toEqual({ name: 'connect', target: { kind: 'choose' } });
    expect(parseCommand('connect --all')).toEqual({ name: 'connect', target: { kind: 'all' } });
    expect(parseCommand('connect --last')).toEqual({ name: 'connect', target: { kind: 'last' } });
    expect(parseCommand('connect minera')).toEqual({
      name: 'connect',
      target: { kind: 'label', label: 'minera' },
    });
    expect(usage('connect --fast')).toMatch(/Invalid option: --fast/);
    expect(usage('connect a b')).toMatch(/^Usage: connect/);

    expect(parseCommand('demo')).toEqual({ name: 'demo' });
    expect(parseCommand('demo iluma-one')).toEqual({ name: 'demo', model: 'iluma-one' });
    expect(usage('demo zune')).toMatch(/Invalid option: zune/);
    expect(usage('demo iluma now')).toBe('Usage: demo [model]');

    expect(parseCommand('model iluma-i-prime')).toEqual({ name: 'model', model: 'iluma-i-prime' });
    expect(usage('model')).toBe('Usage: model <model>');
    expect(parseCommand('disconnect')).toEqual({ name: 'disconnect' });
    expect(parseCommand('refresh')).toEqual({ name: 'refresh' });
  });
});

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failing = false;

  getItem(key: string): string | null {
    if (this.failing) throw new Error('storage disabled');
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failing) throw new Error('quota exceeded');
    this.data.set(key, value);
  }
}

const DEVICE: SavedDevice = { id: 'abc123', name: 'IQOS ILUMA i', model: 'iluma-i' };

describe('device book', () => {
  it('validates labels', () => {
    expect(validateLabel('  minera ')).toBe('minera');
    expect(validateLabel('机-1')).toBe('机-1');
    expect(() => normalizeLabel('   ')).toThrow(/must not be empty/);
    expect(() => validateLabel('iluma')).toThrow(/reserved for model selection/);
    expect(() => validateLabel('ILUMA_I prime')).toThrow(/Invalid label/);
    expect(() => validateLabel('a b')).toThrow(/letters, digits/);
    expect(() => validateLabel('<script>')).toThrow(/letters, digits/);
    expect(() => validateLabel('x'.repeat(33))).toThrow(/at most 32/);
  });

  it('adds, finds, lists and removes devices without mutating', () => {
    const one = withDevice(EMPTY_BOOK, 'minera', DEVICE);
    const two = withDevice(one, 'desk', { ...DEVICE, id: 'def456' });
    expect(EMPTY_BOOK.devices).toEqual({});
    expect(sortedLabels(two)).toEqual(['desk', 'minera']);
    expect(findDevice(two, ' minera ')).toEqual(DEVICE);
    expect(findDevice(two, 'missing')).toBeNull();
    expect(findDevice(two, 'constructor')).toBeNull();

    const removed = withoutDevice(two, 'minera');
    expect(sortedLabels(removed!)).toEqual(['desk']);
    expect(sortedLabels(two)).toEqual(['desk', 'minera']);
    expect(withoutDevice(two, 'missing')).toBeNull();
    expect(withoutDevice(two, 'toString')).toBeNull();
  });

  it('remembers the last device', () => {
    expect(withLast(EMPTY_BOOK, DEVICE).last).toEqual(DEVICE);
  });

  it('caps the number of saved devices', () => {
    let book = EMPTY_BOOK;
    for (let index = 0; index < 64; index++) book = withDevice(book, `d${index}`, DEVICE);
    expect(() => withDevice(book, 'one-more', DEVICE)).toThrow(/Cannot save more than 64/);
    expect(() => withDevice(book, 'd3', DEVICE)).not.toThrow();
  });

  it('round-trips through storage', () => {
    const store = new MemoryStore();
    const book = withLast(withDevice(EMPTY_BOOK, 'minera', DEVICE), DEVICE);
    expect(saveBook(store, book)).toBe(true);
    expect(loadBook(store)).toEqual(book);
  });

  it('survives missing, corrupt and hostile stored data', () => {
    const store = new MemoryStore();
    expect(loadBook(store)).toEqual(EMPTY_BOOK);

    for (const raw of ['not json', '[]', 'null', '42', '{"devices":[]}', '{"devices":{"a":null}}']) {
      store.data.set(STORAGE_KEY, raw);
      expect(loadBook(store)).toEqual(EMPTY_BOOK);
    }

    store.data.set(
      STORAGE_KEY,
      JSON.stringify({
        last: { id: 'x', name: 'y', model: 'toaster' },
        devices: {
          ok: DEVICE,
          'bad label': DEVICE,
          iluma: DEVICE,
          missing: { id: '', name: 'n', model: 'iluma' },
          long: { id: 'i'.repeat(200), name: 'n', model: 'iluma' },
          typed: { id: 1, name: 'n', model: 'iluma' },
          unknown: { id: 'u', name: 'n', model: 'unknown' },
        },
      }),
    );
    const book = loadBook(store);
    expect(book.last).toBeUndefined();
    expect(sortedLabels(book)).toEqual(['ok', 'unknown']);
  });

  it('treats prototype-looking labels as ordinary labels', () => {
    const store = new MemoryStore();
    let book = EMPTY_BOOK;
    for (const label of ['__proto__', 'constructor', 'toString']) book = withDevice(book, label, DEVICE);
    expect(sortedLabels(book)).toEqual(['__proto__', 'constructor', 'toString']);

    saveBook(store, book);
    const loaded = loadBook(store);
    expect(sortedLabels(loaded)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(findDevice(loaded, '__proto__')).toEqual(DEVICE);
    expect(Object.getPrototypeOf(loaded.devices)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['id']).toBeUndefined();
    expect(sortedLabels(withoutDevice(loaded, '__proto__')!)).toEqual(['constructor', 'toString']);
  });

  it('reports storage that cannot be read or written', () => {
    const store = new MemoryStore();
    store.failing = true;
    expect(loadBook(store)).toEqual(EMPTY_BOOK);
    expect(saveBook(store, EMPTY_BOOK)).toBe(false);
  });
});

describe('describeError', () => {
  it('prefixes errors by kind like the CLI', () => {
    expect(describeError(new SphereError('transport', 'x'))).toBe('transport error: x');
    expect(describeError(new SphereError('decode', 'x'))).toBe('protocol decode error: x');
    expect(describeError(new SphereError('encode', 'x'))).toBe('protocol encode error: x');
    expect(describeError(new SphereError('unsupported', 'x'))).toBe('unsupported operation: x');
    expect(describeError(new SphereError('usage', 'x'))).toBe('x');
    expect(describeError(new Error('plain'))).toBe('plain');
    expect(describeError('text')).toBe('text');
  });
});
