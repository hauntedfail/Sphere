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
import { SphereError, describeError, transportError, usageError } from '../protocol/errors';
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

  constructor(private readonly deps: AppDeps) {
    this.version = deps.version;
    this.canSimulate = (deps.simulator ?? null) !== null;
    this.now = deps.now ?? Date.now;
    const support = deps.bluetooth?.support() ?? 'unsupported';
    this.store = createStore(initialState(support, loadBook(deps.storage)));
  }

  /**
   * Run one console line. Lines run one after another; this never rejects.
   *
   * `disconnect`, `exit` and `quit` jump the queue: someone who wants out
   * should not wait behind reads that a silent device is still timing out.
   */
  run(line: string): Promise<void> {
    if (HANG_UP.test(line)) return this.hangUp(line);
    this.patch((state) => ({ ...state, busy: state.busy + 1 }));
    const task = this.queue.then(() => this.execute(line));
    this.queue = task;
    return task;
  }

  /** Resolves once every line queued so far has finished. */
  async whenIdle(): Promise<void> {
    while (this.store.get().busy > 0) await this.queue;
  }

  print(text: string, tone: ConsoleTone = 'out'): void {
    const lines = text.split('\n').map((line) => ({ id: this.nextLineId++, tone, text: line }));
    this.patch((state) => ({
      ...state,
      console: [...state.console, ...lines].slice(-MAX_CONSOLE_LINES),
    }));
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
      throw usageError(
        this.canSimulate
          ? 'Not connected. Run connect, or demo to try a simulated device.'
          : 'Not connected. Run connect first.',
      );
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
      this.setField(key, { status: 'error', error: describeError(error), ...kept }, generation);
      throw error;
    }
  }

  setBook(book: DeviceBook): void {
    this.patch((state) => ({ ...state, book }));
    if (!saveBook(this.deps.storage, book)) {
      this.print('Could not write to browser storage; the change lasts until this tab closes.', 'note');
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
      throw transportError(
        support === 'insecure'
          ? 'Bluetooth needs a secure page. Open Sphere over HTTPS or from localhost.'
          : 'this browser has no Web Bluetooth. Use Chrome, Edge or Opera on desktop or Android, or Bluefy on an iPhone or iPad.',
      );
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
    if (simulator === null) throw usageError('The simulated device is only part of debug builds.');
    this.requireIdle();
    const generation = ++this.generation;
    await this.attach(simulator.open(model, this.hooks(generation)), generation);
  }

  /** Close the connection, stopping Find My IQOS first so it does not buzz on. */
  async disconnect(): Promise<void> {
    const link = this.link;
    if (link === null) throw usageError('Not connected.');
    if (this.store.get().finding && this.iqos !== null) {
      await this.iqos.findStop().catch(() => undefined);
    }
    link.disconnect();
  }

  /** Use `model` for a device whose name was not recognised. */
  async setModel(model: DeviceModel): Promise<void> {
    const { link, device } = this.session();
    if (device.detectedModel !== 'unknown') {
      throw usageError(`This device identifies itself as ${modelLabel(device.detectedModel)}.`);
    }
    this.iqos = new Iqos(link.transport, model);
    this.patch((state) => ({ ...state, ...NO_DEVICE_FIELDS, device: { ...device, model } }));
    this.print(`Treating this device as ${modelLabel(model)}`);
    await refreshDevice(this);
  }

  private async hangUp(line: string): Promise<void> {
    this.print(`iqos> ${line}`, 'input');
    const leaving = !/disconnect/i.test(line);
    if (leaving) this.print('Goodbye!');
    if (this.link === null) {
      if (!leaving) this.print('Not connected.', 'error');
      return;
    }
    try {
      await this.disconnect();
    } catch (error) {
      this.print(`Error: ${describeError(error)}`, 'error');
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
      const usage = error instanceof SphereError && error.kind === 'usage';
      this.print(usage ? error.message : `Error: ${describeError(error)}`, 'error');
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
    this.print('Stopped.');
  }

  private requireIdle(): void {
    const { phase } = this.store.get();
    if (phase === 'connected') throw usageError('Already connected. Run disconnect first.');
    if (phase === 'connecting') throw usageError('A connection attempt is already in progress.');
  }

  private resolveKnown(
    target: ConnectTarget,
    book: DeviceBook,
  ): { id: string; name: string; model: DeviceModel } | undefined {
    if (target.kind === 'label') {
      const saved = findDevice(book, target.label);
      if (saved === null) throw usageError(`Device label not found: ${target.label.trim()}`);
      return saved;
    }
    if (target.kind === 'last') {
      if (book.last === undefined) throw usageError('No device has been connected from this browser yet.');
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
    this.print(
      link.kind === 'simulated'
        ? `Connected to a simulated ${modelLabel(model)}. Nothing is sent over Bluetooth.`
        : `Connected to ${link.name} (${modelLabel(model)})`,
    );
    if (model === 'unknown') {
      this.print(
        `The name "${link.name}" does not say which model this is. Pick one with: model <model>`,
        'note',
      );
    }
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
    this.print(reason === 'disconnected' ? 'Disconnected.' : `Disconnected: ${reason}`, 'note');
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
  if (name === 'NotFoundError') return usageError('No device was selected.');
  if (name === 'SecurityError') {
    return transportError('the browser blocked the request. Start the connection from a button or the prompt.');
  }
  return transportError(
    `could not connect (${describeError(error)}). Wake the device, keep it close, and close the IQOS app if it is connected.`,
    error,
  );
}
