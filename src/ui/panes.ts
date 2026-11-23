/** The device card, and what the start page lists: functions from state to DOM nodes. */
import type { AppState, ConnectedDevice } from '../app/state';
import type { Translate } from '../i18n/i18n';
import type { Messages } from '../i18n/messages/en';
import { formatFirmware } from '../protocol/identity';
import { KNOWN_MODELS, modelLabel, supports } from '../protocol/model';
import { sortedLabels } from '../storage/devices';
import { type Child, h } from './dom';
import type { Stage } from './dots';
import { type Memory, type PaneUi, type Run, button, fieldPlaceholder, fieldValue } from './pane-parts';
import { DEVICE_COLUMNS, DEVICE_ROWS, deviceScene } from './scenes';

/**
 * Stands in a message for a value the page draws as an element of its own,
 * so that the message can say where among its words the element goes. A
 * private-use character: no dictionary and no device name contains it.
 */
const SLOT = '\uE000';

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

/** Stands for a voltage reading that failed, where a row's text is compared between draws. */
const VOLTAGE_FAILED = 'failed';

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
  const voltageFailed = status !== undefined && status.batteryVoltage === undefined;
  rows.push(
    {
      ...statusRow(
        'batteryVoltage',
        status?.batteryVoltage === undefined
          ? voltageFailed
            ? t('field.readFailed')
            : undefined
          : `${status.batteryVoltage.toFixed(3)}V`,
        true,
      ),
      // What is compared between draws must not change with the language.
      ...(voltageFailed ? { text: VOLTAGE_FAILED } : {}),
    },
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
    const pending = h('span', { class: 'battery-label' }, t('device.batteryPending'));
    return h('p', { class: 'battery' }, pending, placeholder);
  }
  const changed = changedSince(ui.memory, 'battery', String(level));
  const reading = h(
    'span',
    { class: `battery-level dot-text${changed ? ' changed' : ''}`, attrs: { id: 'battery-level' } },
    String(level),
    h('span', { class: 'battery-unit' }, '%'),
  );
  // The message says where the level goes among its words; the level itself is the element above.
  const [before = '', after = ''] = t('device.batteryLevel', { level: SLOT }).split(SLOT);
  const label = (text: string): Child => (text.trim() === '' ? null : h('span', { class: 'battery-label' }, text));
  return h('p', { class: 'battery' }, label(before), reading, label(after));
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
