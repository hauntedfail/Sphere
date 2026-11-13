/** Binds the page to the app: draws state, forwards input. */
import type { App } from '../app/app';
import type { AppState, ConsoleLine } from '../app/state';
import { modelLabel } from '../protocol/model';
import { byId, h, redraw } from './dom';
import { createStage } from './dots';
import { sessionLog } from './log';
import {
  commitMemory,
  createPaneUi,
  devicePane,
  modelTiles,
  resetPaneUi,
  saveForm,
  savedDevices,
  settingsPane,
} from './panes';
import { GLOBE_SIZE, globeScene } from './scenes';

const SUPPORT_NOTICE: Record<AppState['support'], string> = {
  ok: '',
  unsupported:
    'This browser has no Web Bluetooth, so it cannot reach a device. Use Chrome, Edge or Opera on desktop or Android. The simulated device still works here.',
  insecure:
    'Bluetooth only works on a secure page. Open Sphere over HTTPS or from localhost. The simulated device still works here.',
};

/** Which parts of the state each region depends on. */
const DEVICE_KEYS = ['device', 'battery', 'status', 'diagnosis', 'finding'] as const;
const SETTINGS_KEYS = [
  'device',
  'brightness',
  'vibration',
  'flexpuff',
  'flexbattery',
  'autostart',
  'smartGesture',
  'locked',
  'finding',
] as const;

const TOAST_MS = 3600;
/** Wide enough for the device card and the settings to sit side by side. */
const WIDE_LAYOUT = '(min-width: 960px)';

function changed(state: AppState, previous: AppState | null, keys: readonly (keyof AppState)[]): boolean {
  return previous === null || keys.some((key) => state[key] !== previous[key]);
}

function titleState(state: AppState): string {
  if (state.phase === 'connecting') return 'connecting';
  if (state.finding) return 'vibrating';
  if (state.busy > 0) return 'working';
  return state.phase === 'connected' ? 'ready' : 'idle';
}

function titleDevice(state: AppState): string {
  const device = state.device;
  if (device === null) return 'not connected';
  const label = device.label === undefined ? '' : ` [${device.label}]`;
  return `${device.kind === 'simulated' ? 'simulated ' : ''}${modelLabel(device.model)}${label}`;
}

export function mount(app: App): void {
  const main = byId('main');
  const bar = byId('bar');
  const intro = byId('intro');
  const workspace = byId('workspace');
  const titleDeviceElement = byId('title-device');
  const titleStateElement = byId('title-state');
  const supportNotice = byId('support-notice');
  const connectButton = byId('connect-button', HTMLButtonElement);
  const connectAllButton = byId('connect-all-button', HTMLButtonElement);
  const connectAllRow = byId('connect-all-row');
  const demoButton = byId('demo-button', HTMLButtonElement);
  const savedContainer = byId('saved-devices');
  const deviceContainer = byId('device-pane');
  const saveContainer = byId('save-pane');
  const settingsContainer = byId('settings-pane');
  const toasts = byId('toasts');

  byId('version').textContent = app.version;

  // Every picture on the page is a dot screen on one stage.
  const stage = createStage();
  byId('sphere').replaceChildren(stage.screen('globe', GLOBE_SIZE, GLOBE_SIZE, globeScene()).element);
  stage.start();

  const wide = typeof matchMedia === 'function' && matchMedia(WIDE_LAYOUT).matches;
  const ui = createPaneUi(stage, wide, (button) => {
    const restore = (): void => {
      setTimeout(() => (button.textContent = 'Copy session log'), 1800);
    };
    navigator.clipboard.writeText(sessionLog(app.store.get(), app.version)).then(
      () => {
        button.textContent = 'Copied';
        restore();
      },
      () => {
        button.textContent = 'Copy failed';
        restore();
      },
    );
  });

  // ── Toasts ────────────────────────────────────────────────────────────────
  // Every control runs a command, and commands answer in text. The outcome of
  // a click surfaces here: any error, or a result that fits on one line.

  /** Id of the newest console line when a control was pressed, or `null`. */
  let reportFrom: number | null = null;

  const toast = (text: string, tone: 'out' | 'error'): void => {
    const item = h('p', { class: `toast ${tone}` }, text);
    toasts.replaceChildren(item);
    setTimeout(() => {
      if (item.parentNode === toasts) item.remove();
    }, TOAST_MS);
  };

  const report = (lines: readonly ConsoleLine[]): void => {
    const from = reportFrom;
    reportFrom = null;
    if (from === null) return;
    const fresh = lines.filter((line) => line.id > from && line.tone !== 'input' && line.text !== '');
    const failure = fresh.find((line) => line.tone === 'error');
    const [only] = fresh;
    if (failure !== undefined) toast(failure.text.replace(/^Error: /, ''), 'error');
    else if (fresh.length === 1 && only !== undefined) toast(only.text, 'out');
  };

  /** The button most recently clicked inside the page's main region. */
  let pressed: HTMLButtonElement | null = null;
  main.addEventListener(
    'click',
    (event) => {
      pressed = event.target instanceof Element ? event.target.closest('button') : null;
    },
    true,
  );

  /** Run a line on behalf of a control: mark the control busy, then report. */
  const run = (line: string): void => {
    const before = app.store.get().busy;
    const newest = app.store.get().console.at(-1)?.id ?? 0;
    void app.run(line);
    // Lines that hang up never queue, so there is nothing to wait for.
    if (app.store.get().busy === before) return;
    if (reportFrom === null) reportFrom = newest;
    pressed?.classList.add('is-waiting');
    pressed = null;
  };

  // ── Controls that are always on the page ──────────────────────────────────

  connectButton.addEventListener('click', () => run('connect'));
  connectAllButton.addEventListener('click', () => run('connect --all'));
  demoButton.addEventListener('click', () => run('demo'));
  redraw(byId('model-tiles'), modelTiles(stage, run));

  // ── Drawing ───────────────────────────────────────────────────────────────

  const draw = (state: AppState, previous: AppState | null): void => {
    const connected = state.phase === 'connected';

    if (changed(state, previous, ['phase'])) {
      intro.hidden = connected;
      workspace.hidden = !connected;
      if (!connected) resetPaneUi(ui);

      const connecting = state.phase === 'connecting';
      connectButton.textContent = connecting ? 'Connecting' : 'Connect a device';
      for (const control of [connectButton, connectAllButton, demoButton]) {
        control.setAttribute('aria-disabled', String(connecting));
      }
      // Moving between the intro and the workspace removes whatever had
      // focus, so start at the top of the view that just appeared.
      if (previous !== null && (connected || previous.phase === 'connected')) {
        main.focus({ preventScroll: true });
        if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      }
    }

    // A command is starting: readings that differ from now on are news.
    if (previous !== null && previous.busy === 0 && state.busy > 0) commitMemory(ui.memory);

    if (changed(state, previous, ['support'])) {
      supportNotice.textContent = SUPPORT_NOTICE[state.support];
      supportNotice.hidden = state.support === 'ok';
      connectButton.hidden = state.support !== 'ok';
      connectAllButton.hidden = state.support !== 'ok';
      connectAllRow.hidden = state.support !== 'ok';
    }

    if (changed(state, previous, ['phase', 'device', 'busy', 'finding'])) {
      titleDeviceElement.textContent = titleDevice(state);
      titleStateElement.textContent = titleState(state);
      titleStateElement.dataset['state'] = titleState(state);
      bar.dataset['busy'] = String(state.busy > 0 || state.phase === 'connecting');
      workspace.dataset['finding'] = String(state.finding);
    }

    if (changed(state, previous, ['book', 'phase'])) {
      redraw(savedContainer, connected ? [] : savedDevices(state, run));
    }
    // The save form lives outside the device pane so that a reading arriving
    // mid-keystroke does not rebuild the field the user is typing in.
    if (changed(state, previous, ['device'])) {
      const device = state.device;
      redraw(saveContainer, device?.kind === 'ble' ? [saveForm(device, run)] : []);
    }
    if (changed(state, previous, DEVICE_KEYS)) {
      redraw(deviceContainer, devicePane(state, run, ui));
    }
    if (changed(state, previous, SETTINGS_KEYS)) {
      redraw(settingsContainer, settingsPane(state, run, ui));
    }
    // The queue has drained: release the controls and say how it went.
    if (previous !== null && previous.busy > 0 && state.busy === 0) {
      for (const waiting of main.querySelectorAll('.is-waiting')) waiting.classList.remove('is-waiting');
      report(state.console);
    }
  };

  app.store.subscribe(draw);
  draw(app.store.get(), null);
}
