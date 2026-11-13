/** Device and settings panes: functions from state to DOM nodes. */
import { serialText } from '../app/format';
import type { AppState, ConnectedDevice, Field } from '../app/state';
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

const FEATURE_NAMES: Partial<Record<Capability, string>> = {
  brightness: 'brightness',
  vibration: 'vibration',
  flexpuff: 'FlexPuff',
  flexbattery: 'FlexBattery',
  autostart: 'auto start',
  smartgesture: 'smart gesture',
  lock: 'lock',
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
function fieldPlaceholder<T>(field: Field<T>): Child {
  if (field.status === 'error') {
    return h('span', { class: 'bad', attrs: { title: field.error } }, 'read failed');
  }
  if (fieldValue(field) !== undefined) return null;
  return h('span', { class: 'pending' }, field.status === 'loading' ? 'reading' : 'not read');
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
      options.field === undefined ? null : fieldPlaceholder(options.field),
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
  title: string,
  choices: readonly Choice[],
  options: RowOptions & { readonly aside?: Child } = {},
): HTMLElement {
  const selected = choices.find((choice) => choice.selected);
  const moved = turned(ui, `choice-${title}`, selected?.key ?? UNKNOWN);
  return h(
    'div',
    { class: 'row choice-row' },
    h(
      'div',
      { class: 'row-text' },
      h('span', { class: 'row-title' }, title),
      options.note === undefined ? null : h('p', { class: 'row-note' }, options.note),
      options.aside ?? null,
      options.field === undefined ? null : fieldPlaceholder(options.field),
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
function feature(ui: PaneUi, spec: Feature): HTMLElement {
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
        spec.field === undefined ? null : fieldPlaceholder(spec.field),
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
  readonly label: string;
  readonly value: Child;
  /** Plain text of the value, compared between draws to mark what changed. */
  readonly text?: string;
  readonly unverified?: boolean;
}

function rowsFor(state: AppState, device: ConnectedDevice): Row[] {
  const status = fieldValue(state.status);
  const pending = fieldPlaceholder(state.status);
  const statusRow = (label: string, text: string | undefined, unverified = false): Row => ({
    label,
    value: pending ?? text ?? 'n/a',
    ...(text === undefined ? {} : { text }),
    ...(unverified ? { unverified } : {}),
  });

  const rows: Row[] = [
    statusRow('product number', status?.productNumber),
    statusRow('stick firmware', status && formatFirmware(status.stickFirmware)),
  ];
  if (status?.holderError !== undefined) {
    rows.push({
      label: 'holder',
      value: h('span', { class: 'bad', attrs: { title: status.holderError } }, 'no answer'),
    });
  } else if (supports(device.model, 'charge-vibration')) {
    rows.push(
      statusRow('holder product', status?.holderProductNumber),
      statusRow('holder firmware', status?.holderFirmware && formatFirmware(status.holderFirmware)),
    );
  }
  rows.push(
    statusRow(
      'battery voltage',
      status === undefined
        ? undefined
        : status.batteryVoltage === undefined
          ? 'read failed'
          : `${status.batteryVoltage.toFixed(3)}V`,
      true,
    ),
    { label: 'model number', value: device.info.modelNumber ?? 'n/a' },
    { label: 'software rev', value: device.info.softwareRevision ?? 'n/a' },
    { label: 'manufacturer', value: device.info.manufacturerName ?? 'n/a' },
    { label: 'serial number', value: serialText(device) },
  );

  const diagnosis = fieldValue(state.diagnosis);
  if (state.diagnosis.status !== 'idle') {
    const waiting = fieldPlaceholder(state.diagnosis);
    const diagnosisRow = (label: string, text: string | undefined): Row => ({
      label,
      value: waiting ?? text ?? 'n/a',
      ...(text === undefined ? {} : { text }),
      unverified: true,
    });
    rows.push(
      diagnosisRow('total puffs', diagnosis?.puffCount?.toString()),
      diagnosisRow('days used', diagnosis?.daysUsed?.toString()),
    );
  }
  return rows;
}

/** Whether `text` differs from what the row showed when the command began. */
function changedSince(memory: Memory, label: string, text: string | undefined): boolean {
  if (text === undefined) return false;
  const before = memory.baseline.get(label);
  memory.latest.set(label, text);
  return before !== undefined && before !== text;
}

function batteryReading(state: AppState, ui: PaneUi): HTMLElement {
  const level = fieldValue(state.battery);
  const placeholder = fieldPlaceholder(state.battery);
  if (placeholder !== null || level === undefined) {
    return h('p', { class: 'battery' }, h('span', { class: 'battery-label' }, 'Battery '), placeholder);
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
    h('span', { class: 'battery-label' }, ' battery'),
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
          'aria-label': `${modelLabel(device.model)}, ${level === null ? 'battery not read' : `battery ${level}%`}`,
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
        h('span', { class: 'chip' }, device.kind === 'ble' ? 'Bluetooth' : 'Simulated'),
        device.label === undefined ? null : h('span', { class: 'chip' }, device.label),
      ),
    ),
  );

  const rows = rowsFor(state, device);
  const list = h('dl', { class: 'registers' });
  for (const row of rows) {
    const changed = changedSince(ui.memory, row.label, row.text);
    list.append(
      h('dt', {}, row.label),
      h(
        'dd',
        { class: changed ? 'changed' : '' },
        row.value,
        row.unverified ? h('span', { class: 'unverified', attrs: { title: 'unverified reading' } }, ' *') : null,
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
    h('summary', { key: 'details-summary' }, 'Details'),
    list,
    rows.some((row) => row.unverified)
      ? h(
          'p',
          { class: 'footnote' },
          '* Decoded the way the iqos CLI does. The upstream project has not confirmed what these numbers measure.',
        )
      : null,
    h(
      'p',
      { class: 'footnote log-note' },
      'Reporting a problem? The session log lists what each control sent and every frame that came back. ',
      h(
        'button',
        {
          class: 'link',
          key: 'copy-log',
          attrs: { type: 'button' },
          on: { click: (event) => ui.copyLog(event.currentTarget as HTMLButtonElement) },
        },
        'Copy session log',
      ),
    ),
  );

  return [
    hero,
    device.kind === 'simulated'
      ? h('p', { class: 'device-note' }, 'This device is simulated. Nothing is transmitted.')
      : null,
    device.detectedModel === 'unknown' ? modelPicker(device, run) : null,
    h(
      'div',
      { class: 'actions' },
      button('refresh', 'Refresh', () => run('refresh')),
      button('diagnosis', 'Read diagnosis', () => {
        // The readings land in the details list; make sure it is in view.
        ui.detailsOpen = true;
        run('diagnosis');
      }),
      button('disconnect', 'Disconnect', () => run('disconnect'), 'danger'),
    ),
    details,
  ];
}

function modelPicker(device: ConnectedDevice, run: Run): HTMLElement {
  return h(
    'div',
    { class: 'notice' },
    h(
      'p',
      {},
      `The name "${device.name}" does not say which model this is. Choose it to unlock its settings:`,
    ),
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
export function saveForm(device: ConnectedDevice, run: Run): HTMLElement {
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
      placeholder: device.label ?? 'label',
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
    h('label', { attrs: { for: 'save-label' } }, 'Save this device as'),
    h(
      'div',
      { class: 'inline-form-fields' },
      input,
      h('button', { class: 'button', key: 'save-submit', attrs: { type: 'submit' } }, 'Save'),
    ),
  );
}

// ── Settings pane ───────────────────────────────────────────────────────────

/** What to say about a setting the device cannot be asked about. */
function lastSet(value: boolean | null, whenTrue: string, whenFalse: string): HTMLElement {
  return h(
    'p',
    { class: 'row-note aside' },
    value === null
      ? 'The device does not report this setting.'
      : `Last set here: ${value ? whenTrue : whenFalse}.`,
  );
}

export function settingsPane(state: AppState, run: Run, ui: PaneUi): Child[] {
  const device = state.device;
  if (device === null) return [];
  const can = (capability: Capability): boolean => supports(device.model, capability);
  const { allInOne } = deviceForm(device.model);
  const features: Feature[] = [];

  if (can('brightness')) {
    const level = fieldValue(state.brightness);
    features.push({
      id: 'light',
      title: 'Light',
      scene: brightnessScene(level),
      guide: {
        lead: 'How strongly the status lights shine.',
        points: [
          'Low is easier on the eyes in the dark.',
          'High is easier to read in daylight.',
        ],
      },
      rows: [
        choiceRow(
          ui,
          'Brightness',
          [
            { key: 'brightness-low', label: 'Low', selected: level === 'low', choose: () => run('brightness low') },
            { key: 'brightness-high', label: 'High', selected: level === 'high', choose: () => run('brightness high') },
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
      ['heating', 'Heating starts', settings?.heating],
      ['starting', 'A session starts', settings?.starting],
      ['puffend', 'A session is ending', settings?.puffEnd],
      ['terminated', 'A session is stopped by hand', settings?.terminated],
      ...(withCharge ? ([['charge', 'Charging starts', settings?.charge]] as const) : []),
    ];
    features.push({
      id: 'vibration',
      title: 'Vibration',
      scene: vibrationScene(flags.filter(([, , on]) => on === true).length, flags.length, allInOne),
      guide: {
        lead: 'The device taps out where a session stands, so you can follow it without looking. Choose which moments it marks.',
        points: [
          'Each signal is separate: keep the ones you rely on, silence the rest.',
          'Switching every signal off makes the device silent, not disabled.',
        ],
      },
      field: state.vibration,
      rows: flags.map(([key, title, on]) =>
        switchRow(ui, `vibration-${key}`, title, on, () => run(`vibration ${key} ${on === true ? 'off' : 'on'}`)),
      ),
    });
  }

  if (can('autostart')) {
    const enabled = fieldValue(state.autostart);
    features.push({
      id: 'auto-start',
      title: 'Auto start',
      scene: autoStartScene(enabled, allInOne),
      guide: {
        lead: 'With auto start on, heating begins the moment a stick is inserted.',
        points: ['With it off, insert the stick and hold the button to start a session yourself.'],
      },
      rows: [
        switchRow(ui, 'autostart', 'Auto start', enabled, () => run(`autostart ${enabled === true ? 'off' : 'on'}`), {
          field: state.autostart,
        }),
      ],
    });
  }

  if (can('flexpuff')) {
    const enabled = fieldValue(state.flexpuff);
    features.push({
      id: 'flexpuff',
      title: 'FlexPuff',
      scene: flexPuffScene(enabled),
      guide: {
        lead: 'Near the end of a session the device checks whether the stick is used up. If it is not, FlexPuff can add up to four puffs.',
        points: [
          'It follows your pace, so not every session is extended.',
          'A session that was paused is not extended.',
        ],
      },
      rows: [
        switchRow(ui, 'flexpuff', 'FlexPuff', enabled, () => run(`flexpuff ${enabled === true ? 'disable' : 'enable'}`), {
          field: state.flexpuff,
        }),
      ],
    });
  }

  if (can('smartgesture')) {
    features.push({
      id: 'gestures',
      title: 'Smart gesture',
      scene: gestureScene(state.smartGesture, allInOne),
      guide: {
        lead: 'Gestures let the device answer without its button.',
        points: [
          'Lift it between sessions and its lights show how many uses are left.',
          'Double-tap it during a session and it vibrates to say how much remains.',
        ],
      },
      rows: [
        choiceRow(
          ui,
          'Smart gesture',
          [
            {
              key: 'smartgesture-enable',
              label: 'On',
              selected: state.smartGesture === true,
              choose: () => run('smartgesture enable'),
            },
            {
              key: 'smartgesture-disable',
              label: 'Off',
              selected: state.smartGesture === false,
              choose: () => run('smartgesture disable'),
            },
          ],
          { aside: lastSet(state.smartGesture, 'on', 'off') },
        ),
      ],
    });
  }

  if (can('flexbattery')) {
    const settings = fieldValue(state.flexbattery);
    features.push({
      id: 'battery',
      title: 'FlexBattery',
      scene: batteryScene(settings?.mode, settings?.pause),
      guide: {
        lead: 'How the holder spends a charge.',
        points: [
          'Performance: up to three sessions in a row before the holder goes back in the charger.',
          'Eco: one session per charge, which is gentler on the battery over its life. Pause is not available.',
          'Pause mode: put a session on hold for up to eight minutes. With it on, Performance gives two sessions in a row.',
        ],
      },
      field: state.flexbattery,
      rows: [
        choiceRow(ui, 'Mode', [
          {
            key: 'flexbattery-performance',
            label: 'Performance',
            selected: settings?.mode === 'performance',
            choose: () => run('flexbattery performance'),
          },
          {
            key: 'flexbattery-eco',
            label: 'Eco',
            selected: settings?.mode === 'eco',
            choose: () => run('flexbattery eco'),
          },
        ]),
        switchRow(ui, 'flexbattery-pause', 'Pause mode', settings?.pause, () =>
          run(`flexbattery pause ${settings?.pause === true ? 'off' : 'on'}`),
        ),
      ],
    });
  }

  if (can('lock')) {
    features.push({
      id: 'lock',
      title: 'Lock',
      scene: lockScene(state.locked),
      guide: {
        lead: 'A locked device cannot be used until it is unlocked again.',
        points: ['Lock it before you lend it out or put it away, and unlock it here when you want it back.'],
      },
      rows: [
        choiceRow(
          ui,
          'Lock',
          [
            { key: 'unlock', label: 'Unlocked', selected: state.locked === false, choose: () => run('unlock') },
            { key: 'lock', label: 'Locked', selected: state.locked === true, choose: () => run('lock') },
          ],
          { aside: lastSet(state.locked, 'locked', 'unlocked') },
        ),
      ],
    });
  }

  features.push({
    id: 'find',
    title: 'Find my IQOS',
    scene: findScene(state.finding),
    guide: {
      lead: 'Mislaid it nearby? Make it vibrate and follow the sound.',
      points: ['It keeps vibrating until you stop it, and it has to be connected to hear you.'],
    },
    rows: [
      h(
        'div',
        { class: 'row find-row' },
        h(
          'div',
          { class: 'row-text' },
          h('span', { class: 'row-title' }, 'Vibrate'),
          h(
            'p',
            { class: `row-note${state.finding ? ' alarm-text' : ''}` },
            state.finding ? 'The device is vibrating.' : 'Off',
          ),
        ),
        state.finding
          ? button('find', 'Stop vibrating', () => run(''), 'alarm')
          : button('find', 'Start vibrating', () => run('findmyiqos')),
      ),
    ],
  });

  const children: Child[] = [
    h(
      'nav',
      { class: 'jump', attrs: { 'aria-label': 'Settings' } },
      ...features.map((spec) => h('a', { key: `jump-${spec.id}`, attrs: { href: `#${spec.id}` } }, spec.title)),
    ),
    h('div', { class: 'features' }, ...features.map((spec) => feature(ui, spec))),
  ];

  const missing = (Object.keys(FEATURE_NAMES) as Capability[])
    .filter((capability) => !can(capability))
    .map((capability) => FEATURE_NAMES[capability]);
  if (missing.length > 0) {
    children.push(
      h(
        'p',
        { class: 'footnote' },
        device.model === 'unknown'
          ? 'Settings appear once the model is known.'
          : `Not on ${modelLabel(device.model)}: ${missing.join(', ')}.`,
      ),
    );
  }
  return children;
}

/**
 * One tile per supported model. With a simulator (`simulate`), each tile is a
 * button that starts it as that model; without one, the tiles are pictures.
 */
export function modelTiles(stage: Stage, simulate: Run | null): Child[] {
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
        attrs: { type: 'button', title: `Try a simulated ${modelLabel(model)}` },
        on: { click: () => simulate(`demo ${model}`) },
      },
      ...content,
    );
  });
}

// ── Saved devices (shown while disconnected) ────────────────────────────────

export function savedDevices(state: AppState, run: Run): Child[] {
  const { book } = state;
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
        button(`connect-${label}`, 'Connect', () => run(`connect ${label}`)),
        button(`forget-${label}`, 'Forget', () => run(`device remove ${label}`), 'quiet'),
      ),
    );
  }

  const children: Child[] = [];
  if (labels.length > 0) {
    children.push(h('h2', { class: 'card-title dot-text' }, 'Saved devices'), list);
  }
  if (book.last !== undefined) {
    children.push(
      h(
        'p',
        { class: 'last-device' },
        `Last connected: ${book.last.name}. `,
        h(
          'button',
          {
            class: 'link',
            key: 'reconnect',
            attrs: { type: 'button' },
            on: { click: () => run('connect --last') },
          },
          'Reconnect',
        ),
      ),
    );
  }
  return [h('section', { class: 'card saved-card', attrs: { 'aria-label': 'Saved devices' } }, ...children)];
}
