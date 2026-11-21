/** Device and settings panes: functions from state to DOM nodes. */
import type { AppState, ConnectedDevice, Field } from '../app/state';
import type { Translate } from '../i18n/i18n';
import { render } from '../i18n/message';
import type { MessageKey, Messages } from '../i18n/messages/en';
import { formatFirmware } from '../protocol/identity';
import { KNOWN_MODELS, type Capability, modelLabel, supports } from '../protocol/model';
import { sortedLabels } from '../storage/devices';
import { type Child, h } from './dom';
import type { Scene, Stage } from './dots';
import {
  DEVICE_COLUMNS,
  DEVICE_ROWS,
  GUIDE_COLUMNS,
  GUIDE_ROWS,
  autoStartScene,
  batteryScene,
  brightnessScene,
  deviceForm,
  deviceScene,
  findScene,
  flexPuffScene,
  gestureScene,
  lockScene,
  vibrationScene,
} from './scenes';

/** Run a console line, exactly as if it had been typed at a prompt. */
export type Run = (line: string) => void;

const FEATURE_NAMES: Partial<Record<Capability, MessageKey>> = {
  brightness: 'settings.missing.brightness',
  vibration: 'settings.missing.vibration',
  flexpuff: 'settings.missing.flexpuff',
  flexbattery: 'settings.missing.flexbattery',
  autostart: 'settings.missing.autostart',
  smartgesture: 'settings.missing.smartgesture',
  lock: 'settings.missing.lock',
};

/**
 * Remembers what each row showed, so a reading that changed stands out.
 * `baseline` is what was on screen when the current command began; a row
 * stays marked until the next command starts.
 */
export interface Memory {
  baseline: Map<string, string>;
  readonly latest: Map<string, string>;
}

export function createMemory(): Memory {
  return { baseline: new Map(), latest: new Map() };
}

/** Start a new comparison: what is on screen now becomes the baseline. */
export function commitMemory(memory: Memory): void {
  memory.baseline = new Map(memory.latest);
}

export function clearMemory(memory: Memory): void {
  memory.baseline = new Map();
  memory.latest.clear();
}

/** What the panes keep between redraws. Everything else comes from the state. */
export interface PaneUi {
  readonly memory: Memory;
  /** Owns the dot pictures, so a redraw moves them rather than restarting them. */
  readonly stage: Stage;
  /** Whether the details list is unfolded. */
  detailsOpen: boolean;
  /** What each control last showed, so that a change can be animated. */
  readonly shown: Map<string, string>;
  /** Copy the session log; the button is passed so it can report the outcome. */
  readonly copyLog: (button: HTMLButtonElement) => void;
}

export function createPaneUi(
  stage: Stage,
  detailsOpen: boolean,
  copyLog: PaneUi['copyLog'],
): PaneUi {
  return { memory: createMemory(), stage, detailsOpen, shown: new Map(), copyLog };
}

/** Forget the device that was connected. */
export function resetPaneUi(ui: PaneUi): void {
  clearMemory(ui.memory);
  ui.shown.clear();
}

// ── Small pieces ────────────────────────────────────────────────────────────

function button(key: string, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
  return h(
    'button',
    { class: `button ${extraClass}`.trim(), key, attrs: { type: 'button' }, on: { click: onClick } },
    label,
  );
}

/** What a control shows while its value is not known. */
const UNKNOWN = 'unknown';

/**
 * True when `key` showed a different value at the last draw. A first reading
 * arriving is not a change: nothing was switched.
 */
function turned(ui: PaneUi, key: string, value: string): boolean {
  const before = ui.shown.get(key);
  ui.shown.set(key, value);
  return before !== undefined && before !== UNKNOWN && before !== value;
}

function fieldValue<T>(field: Field<T>): T | undefined {
  return 'value' in field ? field.value : undefined;
}

/** Text for a field that is not ready, or `null` when it has a value to show. */
function fieldPlaceholder<T>(t: Translate, field: Field<T>): Child {
  if (field.status === 'error') {
    const reason = field.message === undefined ? field.error : render(t, field.message);
    return h('span', { class: 'bad', attrs: { title: reason } }, t('field.readFailed'));
  }
  if (fieldValue(field) !== undefined) return null;
  return h('span', { class: 'pending' }, t(field.status === 'loading' ? 'field.reading' : 'field.notRead'));
}

interface RowOptions {
  /** One line under the title saying what the setting does. */
  readonly note?: string;
  /** The reading behind the control; shown as a status while it has no value. */
  readonly field?: Field<unknown>;
}

function noteId(key: string): string {
  return `note-${key}`;
}

/**
 * A row with an on/off switch. The whole row is the switch's hit area, and
 * the switch is named by the row's title alone.
 */
function switchRow(
  ui: PaneUi,
  t: Translate,
  key: string,
  title: string,
  on: boolean | undefined,
  onToggle: () => void,
  options: RowOptions = {},
): HTMLElement {
  const checked = on === undefined ? 'mixed' : String(on);
  const control = h(
    'button',
    {
      class: `switch${turned(ui, key, on === undefined ? UNKNOWN : checked) ? ' turned' : ''}`,
      key,
      attrs: {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-describedby': options.note === undefined ? undefined : noteId(key),
      },
      on: { click: onToggle },
    },
    title,
    h('span', { class: 'track', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'knob' })),
  );
  return h(
    'div',
    { class: 'row switch-row' },
    h(
      'div',
      { class: 'row-text' },
      control,
      options.note === undefined
        ? null
        : h('p', { class: 'row-note', attrs: { id: noteId(key) } }, options.note),
      options.field === undefined ? null : fieldPlaceholder(t, options.field),
    ),
  );
}

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly selected: boolean;
  readonly choose: () => void;
}

/** A row with a set of exclusive choices. None is marked while the value is unknown. */
function choiceRow(
  ui: PaneUi,
  t: Translate,
  title: string,
  choices: readonly Choice[],
  options: RowOptions & { readonly aside?: Child } = {},
): HTMLElement {
  const selected = choices.find((choice) => choice.selected);
  // Named by its choices, not its title: the title changes with the language.
  const moved = turned(ui, `choice-${choices.map((choice) => choice.key).join('|')}`, selected?.key ?? UNKNOWN);
  return h(
    'div',
    { class: 'row choice-row' },
    h(
      'div',
      { class: 'row-text' },
      h('span', { class: 'row-title' }, title),
      options.note === undefined ? null : h('p', { class: 'row-note' }, options.note),
      options.aside ?? null,
      options.field === undefined ? null : fieldPlaceholder(t, options.field),
    ),
    h(
      'div',
      { class: 'segmented', attrs: { role: 'group', 'aria-label': title } },
      ...choices.map((choice) =>
        h(
          'button',
          {
            class: `segment${moved && choice.selected ? ' turned' : ''}`,
            key: choice.key,
            attrs: { type: 'button', 'aria-pressed': String(choice.selected) },
            on: { click: choice.choose },
          },
          choice.label,
        ),
      ),
    ),
  );
}

/** What a setting is for, in a sentence, and the particulars worth knowing. */
interface Guide {
  readonly lead: string;
  readonly points?: readonly string[];
}

interface Feature {
  /** Anchor id, and the name the picture is kept under. */
  readonly id: string;
  readonly title: string;
  readonly scene: Scene;
  readonly guide: Guide;
  /** A reading shared by every control in the feature, if there is one. */
  readonly field?: Field<unknown>;
  readonly rows: readonly Child[];
}

/** One setting: its picture, its guide, and under them the controls. */
function feature(ui: PaneUi, t: Translate, spec: Feature): HTMLElement {
  const titleId = `feature-${spec.id}`;
  return h(
    'section',
    { class: 'feature', attrs: { id: spec.id, 'aria-labelledby': titleId } },
    h(
      'div',
      { class: 'feature-art', attrs: { 'aria-hidden': 'true' } },
      ui.stage.screen(`guide-${spec.id}`, GUIDE_COLUMNS, GUIDE_ROWS, spec.scene).element,
    ),
    h(
      'div',
      { class: 'feature-text' },
      h(
        'h3',
        { class: 'feature-title', attrs: { id: titleId } },
        h('span', { class: 'dot-text' }, spec.title),
        spec.field === undefined ? null : fieldPlaceholder(t, spec.field),
      ),
      h('p', { class: 'guide-lead' }, spec.guide.lead),
      spec.guide.points === undefined
        ? null
        : h('ul', { class: 'guide-points' }, ...spec.guide.points.map((point) => h('li', {}, point))),
    ),
    h('div', { class: 'rows' }, ...spec.rows),
  );
}

// ── Device pane ─────────────────────────────────────────────────────────────

interface Row {
  /** Names the row whatever language its label is in, so a change can be told across draws. */
  readonly key: string;
  readonly label: string;
  readonly value: Child;
  /** Plain text of the value, compared between draws to mark what changed. */
  readonly text?: string;
  readonly unverified?: boolean;
}

/** What to show for the serial number, which browsers refuse to read. */
function serialText(t: Translate, device: ConnectedDevice): string {
  if (device.info.serialNumber !== undefined) return device.info.serialNumber;
  return t(device.kind === 'ble' ? 'device.serialHidden' : 'device.serialNone');
}

type RowName = keyof Messages['device']['rows'];

function rowsFor(state: AppState, device: ConnectedDevice): Row[] {
  const { t } = state.i18n;
  const none = t('device.none');
  const label = (name: RowName): Pick<Row, 'key' | 'label'> => ({ key: name, label: t(`device.rows.${name}`) });
  const status = fieldValue(state.status);
  const pending = fieldPlaceholder(t, state.status);
  const statusRow = (name: RowName, text: string | undefined, unverified = false): Row => ({
    ...label(name),
    value: pending ?? text ?? none,
    ...(text === undefined ? {} : { text }),
    ...(unverified ? { unverified } : {}),
  });

  const rows: Row[] = [
    statusRow('productNumber', status?.productNumber),
    statusRow('stickFirmware', status && formatFirmware(status.stickFirmware)),
  ];
  if (status?.holderError !== undefined) {
    rows.push({
      ...label('holder'),
      value: h('span', { class: 'bad', attrs: { title: status.holderError } }, t('device.rows.holderNoAnswer')),
    });
  } else if (supports(device.model, 'charge-vibration')) {
    rows.push(
      statusRow('holderProduct', status?.holderProductNumber),
      statusRow('holderFirmware', status?.holderFirmware && formatFirmware(status.holderFirmware)),
    );
  }
  rows.push(
    statusRow(
      'batteryVoltage',
      status === undefined
        ? undefined
        : status.batteryVoltage === undefined
          ? t('field.readFailed')
          : `${status.batteryVoltage.toFixed(3)}V`,
      true,
    ),
    { ...label('modelNumber'), value: device.info.modelNumber ?? none },
    { ...label('softwareRev'), value: device.info.softwareRevision ?? none },
    { ...label('manufacturer'), value: device.info.manufacturerName ?? none },
    { ...label('serialNumber'), value: serialText(t, device) },
  );

  const diagnosis = fieldValue(state.diagnosis);
  if (state.diagnosis.status !== 'idle') {
    const waiting = fieldPlaceholder(t, state.diagnosis);
    const diagnosisRow = (name: RowName, text: string | undefined): Row => ({
      ...label(name),
      value: waiting ?? text ?? none,
      ...(text === undefined ? {} : { text }),
      unverified: true,
    });
    rows.push(
      diagnosisRow('totalPuffs', diagnosis?.puffCount?.toString()),
      diagnosisRow('daysUsed', diagnosis?.daysUsed?.toString()),
    );
  }
  return rows;
}

/** Whether `text` differs from what the row showed when the command began. */
function changedSince(memory: Memory, key: string, text: string | undefined): boolean {
  if (text === undefined) return false;
  const before = memory.baseline.get(key);
  memory.latest.set(key, text);
  return before !== undefined && before !== text;
}

function batteryReading(state: AppState, ui: PaneUi): HTMLElement {
  const { t } = state.i18n;
  const level = fieldValue(state.battery);
  const placeholder = fieldPlaceholder(t, state.battery);
  if (placeholder !== null || level === undefined) {
    return h('p', { class: 'battery' }, h('span', { class: 'battery-label' }, t('device.batteryPending')), placeholder);
  }
  const changed = changedSince(ui.memory, 'battery', String(level));
  return h(
    'p',
    { class: 'battery' },
    h(
      'span',
      { class: `battery-level dot-text${changed ? ' changed' : ''}`, attrs: { id: 'battery-level' } },
      String(level),
      h('span', { class: 'battery-unit' }, '%'),
    ),
    h('span', { class: 'battery-label' }, t('device.batteryAfterLevel')),
  );
}

/** The battery level to draw: only a reading that succeeded counts. */
function knownLevel(state: AppState): number | null {
  const level = fieldValue(state.battery);
  return state.battery.status === 'error' || level === undefined ? null : level;
}

export function devicePane(state: AppState, run: Run, ui: PaneUi): Child[] {
  const device = state.device;
  if (device === null) return [];
  const { t } = state.i18n;

  const level = knownLevel(state);
  const picture = ui.stage.screen(
    'device',
    DEVICE_COLUMNS,
    DEVICE_ROWS,
    deviceScene(device.model, { level, finding: state.finding }),
  );
  const hero = h(
    'div',
    { class: 'device-hero' },
    h(
      'div',
      {
        class: 'device-art',
        attrs: {
          role: 'img',
          'aria-label': t('device.art', {
            model: modelLabel(device.model),
            battery: level === null ? t('device.artUnknown') : t('device.artLevel', { level }),
          }),
        },
      },
      picture.element,
    ),
    h(
      'div',
      { class: 'device-id' },
      batteryReading(state, ui),
      h('h3', { class: 'device-name dot-text' }, device.name),
      h(
        'p',
        { class: 'chips' },
        h('span', { class: 'chip' }, modelLabel(device.model)),
        h('span', { class: 'chip' }, t(device.kind === 'ble' ? 'device.bluetooth' : 'device.simulated')),
        device.label === undefined ? null : h('span', { class: 'chip' }, device.label),
      ),
    ),
  );

  const rows = rowsFor(state, device);
  const list = h('dl', { class: 'registers' });
  for (const row of rows) {
    const changed = changedSince(ui.memory, row.key, row.text);
    list.append(
      h('dt', {}, row.label),
      h(
        'dd',
        { class: changed ? 'changed' : '' },
        row.value,
        row.unverified ? h('span', { class: 'unverified', attrs: { title: t('device.unverified') } }, ' *') : null,
      ),
    );
  }

  const details = h(
    'details',
    {
      class: 'fold device-details',
      key: 'details',
      attrs: { open: ui.detailsOpen },
      on: {
        toggle: (event) => {
          ui.detailsOpen = (event.currentTarget as HTMLDetailsElement).open;
        },
      },
    },
    h('summary', { key: 'details-summary' }, t('device.details')),
    list,
    rows.some((row) => row.unverified)
      ? h(
          'p',
          { class: 'footnote' },
          t('device.unverifiedNote'),
        )
      : null,
    h(
      'p',
      { class: 'footnote log-note' },
      t('device.logNote'),
      h(
        'button',
        {
          class: 'link',
          key: 'copy-log',
          attrs: { type: 'button' },
          on: { click: (event) => ui.copyLog(event.currentTarget as HTMLButtonElement) },
        },
        t('device.copyLog'),
      ),
    ),
  );

  return [
    hero,
    device.kind === 'simulated'
      ? h('p', { class: 'device-note' }, t('device.simulatedNote'))
      : null,
    device.detectedModel === 'unknown' ? modelPicker(device, run, t) : null,
    h(
      'div',
      { class: 'actions' },
      button('refresh', t('device.refresh'), () => run('refresh')),
      button('diagnosis', t('device.readDiagnosis'), () => {
        // The readings land in the details list; make sure it is in view.
        ui.detailsOpen = true;
        run('diagnosis');
      }),
      button('disconnect', t('device.disconnect'), () => run('disconnect'), 'danger'),
    ),
    details,
  ];
}

function modelPicker(device: ConnectedDevice, run: Run, t: Translate): HTMLElement {
  return h(
    'div',
    { class: 'notice' },
    h('p', {}, t('device.chooseModel', { name: device.name })),
    h(
      'div',
      { class: 'options' },
      ...KNOWN_MODELS.map((model) =>
        h(
          'button',
          {
            class: 'option',
            key: `model-${model}`,
            attrs: { type: 'button', 'aria-pressed': String(device.model === model) },
            on: { click: () => run(`model ${model}`) },
          },
          modelLabel(model),
        ),
      ),
    ),
  );
}

/** Form that saves the connected device under a label. */
export function saveForm(device: ConnectedDevice, run: Run, t: Translate): HTMLElement {
  const input = h('input', {
    key: 'save-label',
    attrs: {
      id: 'save-label',
      type: 'text',
      name: 'label',
      maxlength: '32',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: device.label ?? t('device.labelPlaceholder'),
    },
  });
  return h(
    'form',
    {
      class: 'card inline-form',
      on: {
        submit: (event) => {
          event.preventDefault();
          // The whole text goes to the command, so a label that is not
          // acceptable (one with a space, say) is refused rather than trimmed.
          const label = input.value.trim();
          if (label !== '') run(`device save ${label}`);
        },
      },
    },
    h('label', { attrs: { for: 'save-label' } }, t('device.saveAs')),
    h(
      'div',
      { class: 'inline-form-fields' },
      input,
      h('button', { class: 'button', key: 'save-submit', attrs: { type: 'submit' } }, t('device.save')),
    ),
  );
}

// ── Settings pane ───────────────────────────────────────────────────────────

/** What to say about a setting the device cannot be asked about. */
function lastSet(t: Translate, value: boolean | null, whenTrue: MessageKey, whenFalse: MessageKey): HTMLElement {
  return h(
    'p',
    { class: 'row-note aside' },
    value === null ? t('settings.notReported') : t('settings.lastSet', { value: t(value ? whenTrue : whenFalse) }),
  );
}

export function settingsPane(state: AppState, run: Run, ui: PaneUi): Child[] {
  const device = state.device;
  if (device === null) return [];
  const { t } = state.i18n;
  const can = (capability: Capability): boolean => supports(device.model, capability);
  const { allInOne } = deviceForm(device.model);
  const features: Feature[] = [];

  if (can('brightness')) {
    const level = fieldValue(state.brightness);
    features.push({
      id: 'light',
      title: t('settings.light.title'),
      scene: brightnessScene(level),
      guide: {
        lead: t('settings.light.lead'),
        points: [t('settings.light.low'), t('settings.light.high')],
      },
      rows: [
        choiceRow(
          ui,
          t,
          t('settings.light.brightness'),
          [
            { key: 'brightness-low', label: t('settings.light.optionLow'), selected: level === 'low', choose: () => run('brightness low') },
            { key: 'brightness-high', label: t('settings.light.optionHigh'), selected: level === 'high', choose: () => run('brightness high') },
          ],
          { field: state.brightness },
        ),
      ],
    });
  }

  if (can('vibration')) {
    const settings = fieldValue(state.vibration);
    const withCharge = can('charge-vibration');
    const flags: readonly (readonly [string, string, boolean | undefined])[] = [
      ['heating', t('settings.vibration.heating'), settings?.heating],
      ['starting', t('settings.vibration.starting'), settings?.starting],
      ['puffend', t('settings.vibration.puffEnd'), settings?.puffEnd],
      ['terminated', t('settings.vibration.terminated'), settings?.terminated],
      ...(withCharge ? ([['charge', t('settings.vibration.charge'), settings?.charge]] as const) : []),
    ];
    features.push({
      id: 'vibration',
      title: t('settings.vibration.title'),
      scene: vibrationScene(flags.filter(([, , on]) => on === true).length, flags.length, allInOne),
      guide: {
        lead: t('settings.vibration.lead'),
        points: [t('settings.vibration.separate'), t('settings.vibration.silent')],
      },
      field: state.vibration,
      rows: flags.map(([key, title, on]) =>
        switchRow(ui, t, `vibration-${key}`, title, on, () => run(`vibration ${key} ${on === true ? 'off' : 'on'}`)),
      ),
    });
  }

  if (can('autostart')) {
    const enabled = fieldValue(state.autostart);
    features.push({
      id: 'auto-start',
      title: t('settings.autoStart.title'),
      scene: autoStartScene(enabled, allInOne),
      guide: {
        lead: t('settings.autoStart.lead'),
        points: [t('settings.autoStart.byHand')],
      },
      rows: [
        switchRow(ui, t, 'autostart', t('settings.autoStart.title'), enabled, () => run(`autostart ${enabled === true ? 'off' : 'on'}`), {
          field: state.autostart,
        }),
      ],
    });
  }

  if (can('flexpuff')) {
    const enabled = fieldValue(state.flexpuff);
    features.push({
      id: 'flexpuff',
      title: t('settings.flexPuff.title'),
      scene: flexPuffScene(enabled),
      guide: {
        lead: t('settings.flexPuff.lead'),
        points: [t('settings.flexPuff.pace'), t('settings.flexPuff.paused')],
      },
      rows: [
        switchRow(ui, t, 'flexpuff', t('settings.flexPuff.title'), enabled, () => run(`flexpuff ${enabled === true ? 'disable' : 'enable'}`), {
          field: state.flexpuff,
        }),
      ],
    });
  }

  if (can('smartgesture')) {
    features.push({
      id: 'gestures',
      title: t('settings.gesture.title'),
      scene: gestureScene(state.smartGesture, allInOne),
      guide: {
        lead: t('settings.gesture.lead'),
        points: [t('settings.gesture.lift'), t('settings.gesture.tap')],
      },
      rows: [
        choiceRow(
          ui,
          t,
          t('settings.gesture.title'),
          [
            {
              key: 'smartgesture-enable',
              label: t('settings.gesture.on'),
              selected: state.smartGesture === true,
              choose: () => run('smartgesture enable'),
            },
            {
              key: 'smartgesture-disable',
              label: t('settings.gesture.off'),
              selected: state.smartGesture === false,
              choose: () => run('smartgesture disable'),
            },
          ],
          { aside: lastSet(t, state.smartGesture, 'settings.value.on', 'settings.value.off') },
        ),
      ],
    });
  }

  if (can('flexbattery')) {
    const settings = fieldValue(state.flexbattery);
    features.push({
      id: 'battery',
      title: t('settings.flexBattery.title'),
      scene: batteryScene(settings?.mode, settings?.pause),
      guide: {
        lead: t('settings.flexBattery.lead'),
        points: [
          t('settings.flexBattery.performance'),
          t('settings.flexBattery.eco'),
          t('settings.flexBattery.pause'),
        ],
      },
      field: state.flexbattery,
      rows: [
        choiceRow(ui, t, t('settings.flexBattery.mode'), [
          {
            key: 'flexbattery-performance',
            label: t('settings.flexBattery.optionPerformance'),
            selected: settings?.mode === 'performance',
            choose: () => run('flexbattery performance'),
          },
          {
            key: 'flexbattery-eco',
            label: t('settings.flexBattery.optionEco'),
            selected: settings?.mode === 'eco',
            choose: () => run('flexbattery eco'),
          },
        ]),
        switchRow(ui, t, 'flexbattery-pause', t('settings.flexBattery.pauseMode'), settings?.pause, () =>
          run(`flexbattery pause ${settings?.pause === true ? 'off' : 'on'}`),
        ),
      ],
    });
  }

  if (can('lock')) {
    features.push({
      id: 'lock',
      title: t('settings.lock.title'),
      scene: lockScene(state.locked),
      guide: {
        lead: t('settings.lock.lead'),
        points: [t('settings.lock.lend')],
      },
      rows: [
        choiceRow(
          ui,
          t,
          t('settings.lock.title'),
          [
            { key: 'unlock', label: t('settings.lock.unlocked'), selected: state.locked === false, choose: () => run('unlock') },
            { key: 'lock', label: t('settings.lock.locked'), selected: state.locked === true, choose: () => run('lock') },
          ],
          { aside: lastSet(t, state.locked, 'settings.value.locked', 'settings.value.unlocked') },
        ),
      ],
    });
  }

  features.push({
    id: 'find',
    title: t('settings.find.title'),
    scene: findScene(state.finding),
    guide: {
      lead: t('settings.find.lead'),
      points: [t('settings.find.keeps')],
    },
    rows: [
      h(
        'div',
        { class: 'row find-row' },
        h(
          'div',
          { class: 'row-text' },
          h('span', { class: 'row-title' }, t('settings.find.vibrate')),
          h(
            'p',
            { class: `row-note${state.finding ? ' alarm-text' : ''}` },
            t(state.finding ? 'settings.find.vibrating' : 'settings.find.off'),
          ),
        ),
        state.finding
          ? button('find', t('settings.find.stop'), () => run(''), 'alarm')
          : button('find', t('settings.find.start'), () => run('findmyiqos')),
      ),
    ],
  });

  const children: Child[] = [
    h(
      'nav',
      { class: 'jump', attrs: { 'aria-label': t('settings.nav') } },
      ...features.map((spec) => h('a', { key: `jump-${spec.id}`, attrs: { href: `#${spec.id}` } }, spec.title)),
    ),
    h('div', { class: 'features' }, ...features.map((spec) => feature(ui, t, spec))),
  ];

  const missing = (Object.keys(FEATURE_NAMES) as Capability[])
    .filter((capability) => !can(capability))
    .flatMap((capability) => {
      const name = FEATURE_NAMES[capability];
      return name === undefined ? [] : [t(name)];
    });
  if (missing.length > 0) {
    children.push(
      h(
        'p',
        { class: 'footnote' },
        device.model === 'unknown'
          ? t('settings.missing.unknownModel')
          : t('settings.missing.notOn', {
              model: modelLabel(device.model),
              features: missing.join(t('settings.missing.separator')),
            }),
      ),
    );
  }
  return children;
}

/**
 * One tile per supported model. With a simulator (`simulate`), each tile is a
 * button that starts it as that model; without one, the tiles are pictures.
 */
export function modelTiles(stage: Stage, simulate: Run | null, t: Translate): Child[] {
  return KNOWN_MODELS.map((model) => {
    const content: Child[] = [
      stage.screen(`tile-${model}`, DEVICE_COLUMNS, DEVICE_ROWS, deviceScene(model, { level: 72, finding: false }))
        .element,
      h('span', { class: 'model-name' }, modelLabel(model)),
    ];
    if (simulate === null) return h('div', { class: 'model-tile' }, ...content);
    return h(
      'button',
      {
        class: 'model-tile',
        key: `tile-${model}`,
        attrs: { type: 'button', title: t('page.demoTile', { model: modelLabel(model) }) },
        on: { click: () => simulate(`demo ${model}`) },
      },
      ...content,
    );
  });
}

// ── Saved devices (shown while disconnected) ────────────────────────────────

export function savedDevices(state: AppState, run: Run): Child[] {
  const { book } = state;
  const { t } = state.i18n;
  const labels = sortedLabels(book);
  if (labels.length === 0 && book.last === undefined) return [];

  const list = h('ul', { class: 'saved' });
  for (const label of labels) {
    const device = book.devices[label];
    if (device === undefined) continue;
    list.append(
      h(
        'li',
        {},
        h(
          'div',
          { class: 'saved-id' },
          h('span', { class: 'saved-label' }, label),
          h('span', { class: 'saved-name' }, `${device.name} (${modelLabel(device.model)})`),
        ),
        button(`connect-${label}`, t('saved.connect'), () => run(`connect ${label}`)),
        button(`forget-${label}`, t('saved.forget'), () => run(`device remove ${label}`), 'quiet'),
      ),
    );
  }

  const children: Child[] = [];
  if (labels.length > 0) {
    children.push(h('h2', { class: 'card-title dot-text' }, t('saved.title')), list);
  }
  if (book.last !== undefined) {
    children.push(
      h(
        'p',
        { class: 'last-device' },
        t('saved.last', { name: book.last.name }),
        h(
          'button',
          {
            class: 'link',
            key: 'reconnect',
            attrs: { type: 'button' },
            on: { click: () => run('connect --last') },
          },
          t('saved.reconnect'),
        ),
      ),
    );
  }
  return [h('section', { class: 'card saved-card', attrs: { 'aria-label': t('saved.title') } }, ...children)];
}
