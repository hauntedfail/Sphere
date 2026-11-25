/**
 * Application core: owns the connection, the state store and the console.
 *
 * Buttons and the console prompt both go through `run(line)`, so every action
 * has one implementation and leaves the same trace. Nothing here touches the
 * DOM, which keeps the whole thing testable against the simulator. The
 * simulator itself is handed in, so a build that leaves it out has none.
 */
import { parseCommand, type ConnectTarget } from '../console/parse';
import { Iqos } from '../device/iqos';
import { ENGLISH, type I18n, loadI18n } from '../i18n/i18n';
import { LOCALE_NAMES, LOCALE_STORAGE_KEY, type Locale } from '../i18n/locales';
import type { MessageRef } from '../i18n/message';
import { SphereError, describeError } from '../protocol/errors';
import { type DeviceModel, modelFromLocalName, modelLabel } from '../protocol/model';
import {
  type DeviceBook,
  type KeyValueStore,
  findDevice,
  loadBook,
  saveBook,
  withLast,
} from '../storage/devices';
import type { BluetoothGateway, DeviceLink, LinkHooks, SimulatorGateway } from '../transport/link';
import type { WireEvent } from '../transport/session';
import { toHex } from '../protocol/bytes';
import { runCommand, refreshDevice } from './commands';
import { appError, english, errorRef } from './messages';
import {
  type AppState,
  type ConnectedDevice,
  type ConsoleTone,
  type Field,
  NO_DEVICE_FIELDS,
  type Store,
  createStore,
  initialState,
} from './state';

export interface AppDeps {
  readonly storage: KeyValueStore;
  /** `null` where Web Bluetooth does not exist. */
  readonly bluetooth: BluetoothGateway | null;
  readonly version: string;
  readonly now?: () => number;
  /** The simulated device. Debug builds pass one; production builds do not. */
  readonly simulator?: SimulatorGateway | null;
  /** The language to start in. English when left out. */
  readonly i18n?: I18n;
  /** Fetches another language. The real loader when left out. */
  readonly loadI18n?: (locale: Locale) => Promise<I18n>;
}

export type FieldKey =
  | 'battery'
  | 'status'
  | 'diagnosis'
  | 'brightness'
  | 'vibration'
  | 'flexpuff'
  | 'flexbattery'
  | 'autostart';

export type FieldValue<K extends FieldKey> = AppState[K] extends Field<infer T> ? T : never;

export interface Session {
  readonly iqos: Iqos;
  readonly link: DeviceLink;
  readonly device: ConnectedDevice;
}

const MAX_CONSOLE_LINES = 500;
const MAX_WIRE_LINES = 400;

/** Lines that end the connection. They run at once instead of queueing. */
const HANG_UP = /^\s*(disconnect|exit|quit)\s*$/i;
/** Choosing a language asks nothing of the device, so it does not wait for it either. */
const LANGUAGE = /^\s*lang(\s|$)/i;

export class App {
  readonly store: Store<AppState>;
  readonly version: string;
  /** Whether this build can open a simulated device. */
  readonly canSimulate: boolean;

  private link: DeviceLink | null = null;
  private iqos: Iqos | null = null;
  private queue: Promise<void> = Promise.resolve();
  private nextLineId = 1;
  /** Bumped on every connect and disconnect so late results are dropped. */
  private generation = 0;
  private readonly now: () => number;

  /** Counts the choices of language, so a slow one cannot overtake a later one. */
  private localeRequest = 0;

  constructor(private readonly deps: AppDeps) {
    this.version = deps.version;
    this.canSimulate = (deps.simulator ?? null) !== null;
    this.now = deps.now ?? Date.now;
    const support = deps.bluetooth?.support() ?? 'unsupported';
    this.store = createStore(initialState(support, loadBook(deps.storage), deps.i18n ?? ENGLISH));
  }

  /**
   * Run one console line. Lines run one after another; this never rejects.
   *
   * `disconnect`, `exit` and `quit` jump the queue: someone who wants out
   * should not wait behind reads that a silent device is still timing out.
   */
  run(line: string): Promise<void> {
    if (HANG_UP.test(line)) return this.hangUp(line);
    if (LANGUAGE.test(line)) return this.aside(line);
    this.patch((state) => ({ ...state, busy: state.busy + 1 }));
    const task = this.queue.then(() => this.execute(line));
    this.queue = task;
    return task;
  }

  /** Resolves once every line queued so far has finished. */
  async whenIdle(): Promise<void> {
    while (this.store.get().busy > 0) await this.queue;
  }

  /** Add text to the console, in English. `message` is the same text for the page to translate. */
  print(text: string, tone: ConsoleTone = 'out', message?: MessageRef): void {
    const lines = text.split('\n').map((line) => ({
      id: this.nextLineId++,
      tone,
      text: line,
      ...(message === undefined ? {} : { message }),
    }));
    this.patch((state) => ({
      ...state,
      console: [...state.console, ...lines].slice(-MAX_CONSOLE_LINES),
    }));
  }

  /**
   * Print a one-line answer that the page may show on its own. The console
   * gets the English; the line keeps the message for any other language.
   */
  say(message: MessageRef, tone: ConsoleTone = 'out'): void {
    this.print(english(message), tone, message);
  }

  /** Print a failure as the console words it, with the message for the page. */
  private fail(error: unknown): void {
    const usage = error instanceof SphereError && error.kind === 'usage';
    this.print(usage ? error.message : `Error: ${describeError(error)}`, 'error', errorRef(error));
  }

  clearConsole(): void {
    this.patch((state) => ({ ...state, console: [] }));
  }

  clearWire(): void {
    this.patch((state) => ({ ...state, wire: [] }));
  }

  /** The live connection, or a usage error telling the user how to get one. */
  session(): Session {
    const { device } = this.store.get();
    if (this.link === null || this.iqos === null || device === null) {
      throw appError('usage', { key: this.canSimulate ? 'error.notConnectedDemo' : 'error.notConnectedRun' });
    }
    return { iqos: this.iqos, link: this.link, device };
  }

  /**
   * Read a value into a state field, tracking loading and failure. The error
   * is rethrown so the caller decides how loudly to report it.
   */
  async load<K extends FieldKey>(key: K, read: () => Promise<FieldValue<K>>): Promise<FieldValue<K>> {
    const generation = this.generation;
    const previous = this.store.get()[key] as Field<FieldValue<K>>;
    const kept = 'value' in previous && previous.value !== undefined ? { value: previous.value } : {};
    this.setField(key, { status: 'loading', ...kept }, generation);
    try {
      const value = await read();
      this.setField(key, { status: 'ready', value }, generation);
      return value;
    } catch (error) {
      this.setField(
        key,
        { status: 'error', error: describeError(error), message: errorRef(error), ...kept },
        generation,
      );
      throw error;
    }
  }

  setBook(book: DeviceBook): void {
    this.patch((state) => ({ ...state, book }));
    if (!saveBook(this.deps.storage, book)) {
      this.say({ key: 'result.storageFailed' }, 'note');
    }
  }

  patch(change: (state: AppState) => AppState): void {
    this.store.update(change);
  }

  /**
   * Apply a change that describes `device`, unless the connection it came
   * from has ended while the command was waiting on the device.
   */
  patchDevice(device: ConnectedDevice, change: (state: AppState) => AppState): void {
    this.patch((state) => (state.device === device ? change(state) : state));
  }

  async connect(target: ConnectTarget): Promise<void> {
    this.requireIdle();
    const bluetooth = this.deps.bluetooth;
    const support = this.store.get().support;
    if (bluetooth === null || support !== 'ok') {
      throw appError('transport', { key: support === 'insecure' ? 'error.insecure' : 'error.noBluetooth' });
    }

    const { book } = this.store.get();
    const known = this.resolveKnown(target, book);
    const label = target.kind === 'label' ? target.label.trim() : undefined;

    this.patch((state) => ({ ...state, phase: 'connecting' }));
    const generation = ++this.generation;
    let link: DeviceLink;
    try {
      link = await bluetooth.open(
        { ...(known ? { known } : {}), ...(target.kind === 'all' ? { acceptAll: true } : {}) },
        this.hooks(generation),
      );
    } catch (error) {
      this.patch((state) => ({ ...state, phase: 'idle' }));
      throw connectError(error);
    }
    await this.attach(link, generation, known?.model, label);
  }

  async demo(model: DeviceModel = 'iluma-i'): Promise<void> {
    const simulator = this.deps.simulator ?? null;
    if (simulator === null) throw appError('usage', { key: 'error.simulatorMissing' });
    this.requireIdle();
    const generation = ++this.generation;
    await this.attach(simulator.open(model, this.hooks(generation)), generation);
  }

  /** Close the connection, stopping Find My IQOS first so it does not buzz on. */
  async disconnect(): Promise<void> {
    const link = this.link;
    if (link === null) throw appError('usage', { key: 'error.notConnected' });
    if (this.store.get().finding && this.iqos !== null) {
      await this.iqos.findStop().catch(() => undefined);
    }
    link.disconnect();
  }

  /** Use `model` for a device whose name was not recognised. */
  async setModel(model: DeviceModel): Promise<void> {
    const { link, device } = this.session();
    if (device.detectedModel !== 'unknown') {
      throw appError('usage', { key: 'error.identifiesAs', params: { model: modelLabel(device.detectedModel) } });
    }
    this.iqos = new Iqos(link.transport, model);
    this.patch((state) => ({ ...state, ...NO_DEVICE_FIELDS, device: { ...device, model } }));
    this.say({ key: 'result.treatingAs', params: { model: modelLabel(model) } });
    await refreshDevice(this);
  }

  /**
   * Run a line beside the queue: it is not counted as work in progress, and
   * it does not stand in for the Enter that stops Find My IQOS.
   */
  private async aside(line: string): Promise<void> {
    this.print(`iqos> ${line}`, 'input');
    try {
      const command = parseCommand(line);
      if (command !== null) await runCommand(this, command);
    } catch (error) {
      this.fail(error);
    }
  }

  sayLanguage(): void {
    this.say({ key: 'result.language', params: { name: LOCALE_NAMES[this.store.get().i18n.locale] } });
  }

  /**
   * Put the page into `locale` and remember the choice. If a later choice is
   * made while this one is still loading, the later one wins and this one
   * ends without a word.
   */
  async setLocale(locale: Locale): Promise<void> {
    const request = ++this.localeRequest;
    let i18n: I18n;
    try {
      i18n = await (this.deps.loadI18n ?? loadI18n)(locale);
    } catch (error) {
      if (request !== this.localeRequest) return;
      throw appError(
        'transport',
        { key: 'error.languageUnavailable', params: { name: LOCALE_NAMES[locale] } },
        error,
      );
    }
    if (request !== this.localeRequest) return;
    this.patch((state) => ({ ...state, i18n }));
    try {
      this.deps.storage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      this.say({ key: 'result.storageFailed' }, 'note');
    }
    this.sayLanguage();
  }

  private async hangUp(line: string): Promise<void> {
    this.print(`iqos> ${line}`, 'input');
    const leaving = !/disconnect/i.test(line);
    if (leaving) this.print('Goodbye!');
    if (this.link === null) {
      if (!leaving) this.say({ key: 'error.notConnected' }, 'error');
      return;
    }
    try {
      await this.disconnect();
    } catch (error) {
      this.fail(error);
    }
  }

  private async execute(line: string): Promise<void> {
    this.print(`iqos> ${line}`, 'input');
    try {
      if (this.store.get().finding) {
        await this.stopFinding();
        return;
      }
      const command = parseCommand(line);
      if (command !== null) await runCommand(this, command);
    } catch (error) {
      this.fail(error);
    } finally {
      this.patch((state) => ({ ...state, busy: state.busy - 1 }));
    }
  }

  private async stopFinding(): Promise<void> {
    const { iqos } = this.session();
    try {
      await iqos.findStop();
    } finally {
      this.patch((state) => ({ ...state, finding: false }));
    }
    this.say({ key: 'result.stopped' });
  }

  private requireIdle(): void {
    const { phase } = this.store.get();
    if (phase === 'connected') throw appError('usage', { key: 'error.alreadyConnected' });
    if (phase === 'connecting') throw appError('usage', { key: 'error.connecting' });
  }

  private resolveKnown(
    target: ConnectTarget,
    book: DeviceBook,
  ): { id: string; name: string; model: DeviceModel } | undefined {
    if (target.kind === 'label') {
      const saved = findDevice(book, target.label);
      if (saved === null) {
        throw appError('usage', { key: 'error.labelNotFound', params: { label: target.label.trim() } });
      }
      return saved;
    }
    if (target.kind === 'last') {
      if (book.last === undefined) throw appError('usage', { key: 'error.noLast' });
      return book.last;
    }
    return undefined;
  }

  private hooks(generation: number): LinkHooks {
    return {
      onWire: (event) => this.recordWire(event),
      onDisconnect: (reason) => this.detached(generation, reason),
    };
  }

  private async attach(
    link: DeviceLink,
    generation: number,
    modelHint?: DeviceModel,
    label?: string,
  ): Promise<void> {
    if (generation !== this.generation) {
      link.disconnect();
      return;
    }
    const detectedModel = modelFromLocalName(link.name);
    const model = detectedModel === 'unknown' ? (modelHint ?? 'unknown') : detectedModel;
    const device: ConnectedDevice = {
      kind: link.kind,
      id: link.id,
      name: link.name,
      model,
      detectedModel,
      info: link.info,
      ...(label === undefined ? {} : { label }),
    };

    this.link = link;
    this.iqos = new Iqos(link.transport, model);
    this.patch((state) => ({ ...state, ...NO_DEVICE_FIELDS, phase: 'connected', device }));

    if (link.kind === 'ble') this.remember(device);
    this.say(
      link.kind === 'simulated'
        ? { key: 'result.connectedSimulated', params: { model: modelLabel(model) } }
        : { key: 'result.connected', params: { name: link.name, model: modelLabel(model) } },
    );
    if (model === 'unknown') this.say({ key: 'result.unknownModel', params: { name: link.name } }, 'note');
    await refreshDevice(this);
  }

  private remember(device: ConnectedDevice): void {
    const saved = { id: device.id, name: device.name, model: device.model };
    const { book } = this.store.get();
    const withMetadata =
      device.label !== undefined && findDevice(book, device.label) !== null
        ? { ...book, devices: { ...book.devices, [device.label]: saved } }
        : book;
    this.setBook(withLast(withMetadata, saved));
  }

  private detached(generation: number, reason: string): void {
    if (generation !== this.generation) return;
    this.generation++;
    this.link = null;
    this.iqos = null;
    this.patch((state) => ({ ...state, ...NO_DEVICE_FIELDS, phase: 'idle', device: null }));
    this.say(
      reason === 'disconnected'
        ? { key: 'result.disconnected' }
        : { key: 'result.disconnectedBecause', params: { reason } },
      'note',
    );
  }

  private recordWire(event: WireEvent): void {
    const line = {
      id: this.nextLineId++,
      at: this.now(),
      direction: event.direction,
      hex: toHex(event.frame),
      ...(event.note === undefined ? {} : { note: event.note }),
    };
    this.patch((state) => ({ ...state, wire: [...state.wire, line].slice(-MAX_WIRE_LINES) }));
  }

  private setField<K extends FieldKey>(key: K, field: Field<FieldValue<K>>, generation: number): void {
    if (generation !== this.generation) return;
    this.patch((state) => ({ ...state, [key]: field }) as AppState);
  }
}

/** Turn a Web Bluetooth failure into something a person can act on. */
function connectError(error: unknown): Error {
  if (error instanceof SphereError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotFoundError') return appError('usage', { key: 'error.noneSelected' });
  if (name === 'SecurityError') return appError('transport', { key: 'error.blocked' });
  return appError('transport', { key: 'error.couldNotConnect', params: { detail: describeError(error) } }, error);
}

export { appError, errorRef } from './messages';
