/** What the panes are built from: rows, switches, choices, and what is kept between redraws. */
import type { Field } from '../app/state';
import type { Translate } from '../i18n/i18n';
import { render } from '../i18n/message';
import { type Child, h } from './dom';
import type { Scene, Stage } from './dots';
import { GUIDE_COLUMNS, GUIDE_ROWS } from './scenes';

/** Run a console line, exactly as if it had been typed at a prompt. */
export type Run = (line: string) => void;

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

export function button(key: string, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
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

export function fieldValue<T>(field: Field<T>): T | undefined {
  return 'value' in field ? field.value : undefined;
}

/** Text for a field that is not ready, or `null` when it has a value to show. */
export function fieldPlaceholder<T>(t: Translate, field: Field<T>): Child {
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
export function switchRow(
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
export function choiceRow(
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

export interface Feature {
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
export function feature(ui: PaneUi, t: Translate, spec: Feature): HTMLElement {
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
