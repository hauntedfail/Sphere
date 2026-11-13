/**
 * Saved device labels: the browser counterpart of the CLI's `config.toml`.
 *
 * Only what is needed to find a device again is kept: the browser's opaque,
 * origin-scoped device id, the advertised name and the model. No serial
 * numbers, product numbers or usage data are written to storage.
 */
import { usageError } from '../protocol/errors';
import { type DeviceModel, KNOWN_MODELS, parseModelSelector } from '../protocol/model';

export interface SavedDevice {
  readonly id: string;
  readonly name: string;
  readonly model: DeviceModel;
}

export interface DeviceBook {
  /** The device connected most recently. */
  readonly last?: SavedDevice;
  readonly devices: Readonly<Record<string, SavedDevice>>;
}

/** The subset of `Storage` this module needs. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = 'sphere.devices.v1';
export const EMPTY_BOOK: DeviceBook = { devices: {} };

const MAX_LABEL_LENGTH = 32;
const MAX_FIELD_LENGTH = 128;
const MAX_DEVICES = 64;

/** Trim a label. Labels must not be empty. */
export function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed === '') throw usageError('Invalid label: label must not be empty');
  return trimmed;
}

/** Validate a label for saving: printable, short, and not a model name. */
export function validateLabel(label: string): string {
  const trimmed = normalizeLabel(label);
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw usageError(`Invalid label: use at most ${MAX_LABEL_LENGTH} characters`);
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(trimmed)) {
    throw usageError('Invalid label: use letters, digits, ".", "_" or "-"');
  }
  if (parseModelSelector(trimmed) !== null) {
    throw usageError(`Invalid label: ${trimmed} is reserved for model selection`);
  }
  return trimmed;
}

export function withDevice(book: DeviceBook, label: string, device: SavedDevice): DeviceBook {
  const key = validateLabel(label);
  if (!Object.hasOwn(book.devices, key) && Object.keys(book.devices).length >= MAX_DEVICES) {
    throw usageError(`Cannot save more than ${MAX_DEVICES} devices`);
  }
  return { ...book, devices: { ...book.devices, [key]: device } };
}

/** Remove a label. Returns `null` when the label does not exist. */
export function withoutDevice(book: DeviceBook, label: string): DeviceBook | null {
  const key = normalizeLabel(label);
  if (!Object.hasOwn(book.devices, key)) return null;
  const devices = Object.fromEntries(Object.entries(book.devices).filter(([name]) => name !== key));
  return { ...book, devices };
}

export function withLast(book: DeviceBook, device: SavedDevice): DeviceBook {
  return { ...book, last: device };
}

export function findDevice(book: DeviceBook, label: string): SavedDevice | null {
  const key = label.trim();
  return Object.hasOwn(book.devices, key) ? (book.devices[key] ?? null) : null;
}

/** Labels in alphabetical order, as the CLI lists them. */
export function sortedLabels(book: DeviceBook): string[] {
  return Object.keys(book.devices).sort((a, b) => a.localeCompare(b));
}

/** Read the book. Missing, unreadable or malformed data yields an empty book. */
export function loadBook(store: KeyValueStore): DeviceBook {
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_BOOK;
  }
  if (raw === null) return EMPTY_BOOK;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_BOOK;
  }
  return parseBook(parsed);
}

/** Persist the book. Returns `false` when storage refuses the write. */
export function saveBook(store: KeyValueStore, book: DeviceBook): boolean {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(book));
    return true;
  } catch {
    return false;
  }
}

function parseBook(value: unknown): DeviceBook {
  if (!isRecord(value)) return EMPTY_BOOK;

  // Entries are collected as pairs and turned into an object in one step, so
  // a stored key such as "__proto__" becomes an ordinary own property instead
  // of reaching the prototype setter.
  const entries: [string, SavedDevice][] = [];
  if (isRecord(value['devices'])) {
    for (const [label, entry] of Object.entries(value['devices']).slice(0, MAX_DEVICES)) {
      const device = parseDevice(entry);
      if (device !== null && isValidLabel(label)) entries.push([label, device]);
    }
  }
  const devices = Object.fromEntries(entries);

  const last = parseDevice(value['last']);
  return last === null ? { devices } : { last, devices };
}

function parseDevice(value: unknown): SavedDevice | null {
  if (!isRecord(value)) return null;
  const { id, name, model } = value;
  if (!isShortString(id) || !isShortString(name) || typeof model !== 'string') return null;
  const known = model === 'unknown' || (KNOWN_MODELS as readonly string[]).includes(model);
  return known ? { id, name, model: model as DeviceModel } : null;
}

function isValidLabel(label: string): boolean {
  try {
    return validateLabel(label) === label;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}
