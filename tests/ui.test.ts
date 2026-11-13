// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { KNOWN_MODELS } from '../src/protocol/model';
import { STORAGE_KEY } from '../src/storage/devices';
import type { BluetoothGateway, BluetoothSupport } from '../src/transport/link';
import { SimulatedDevice, createSimulator, openSimulatedLink } from '../src/transport/simulator';
import { type Scene, createDotScreen, createStage, sample } from '../src/ui/dots';
import { formatTime, sessionLog, wireText } from '../src/ui/log';
import {
  DEVICE_COLUMNS,
  DEVICE_ROWS,
  GLOBE_SIZE,
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
  globeScene,
  lockScene,
  vibrationScene,
} from '../src/ui/scenes';
import { mount } from '../src/ui/view';

// The page skeleton is the real one, so the tests break if the markup drifts.
const PAGE = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*)<\/body>/.exec(PAGE)?.[1] ?? '';

interface Page {
  app: App;
  storage: Map<string, string>;
  /** Wait until every queued command has finished. */
  settle: () => Promise<void>;
  button: (name: string) => HTMLButtonElement;
  text: (id: string) => string;
  /** Run a command the way a control would, and wait for it. */
  run: (line: string) => Promise<void>;
  /** Everything the commands have printed so far. */
  printed: () => string[];
}

function fakeGateway(support: BluetoothSupport): BluetoothGateway {
  return {
    support: () => support,
    open: async (_request, hooks) => ({
      ...openSimulatedLink(new SimulatedDevice(), hooks, 200),
      kind: 'ble',
      id: 'ble-1',
    }),
  };
}

/** `simulator: false` mounts the page the way a production build does. */
function open(
  options: { support?: BluetoothSupport | null; stored?: unknown; simulator?: boolean } = {},
): Page {
  document.body.innerHTML = BODY;
  const storage = new Map<string, string>();
  if (options.stored !== undefined) storage.set(STORAGE_KEY, JSON.stringify(options.stored));

  const support = options.support === undefined ? 'ok' : options.support;
  const app = new App({
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) },
    bluetooth: support === null ? null : fakeGateway(support),
    version: '1.2.3',
    simulator: options.simulator === false ? null : createSimulator({ latencyMs: 0 }),
  });
  mount(app);

  return {
    app,
    storage,
    settle: () => app.whenIdle(),
    button: (name) => {
      const match = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === name && candidate.closest('[hidden]') === null,
      );
      if (match === undefined) throw new Error(`no visible button "${name}"`);
      return match;
    },
    text: (id) => document.getElementById(id)?.textContent ?? '',
    run: async (line) => {
      await app.run(line);
      await app.whenIdle();
    },
    printed: () => app.store.get().console.map((line) => line.text),
  };
}

async function connectedPage(): Promise<Page> {
  const page = open();
  page.button('Try a simulated device').click();
  await page.settle();
  return page;
}

/** A stand-in 2D context that counts the frames painted onto it. */
function fakeCanvas(): { frames: () => number; inks: () => string[] } {
  let frames = 0;
  const inks: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    clearRect: () => {
      frames++;
    },
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    set fillStyle(value: string) {
      inks.push(value);
    },
  })) as never);
  return { frames: () => frames, inks: () => inks };
}

const toastText = (): string => document.getElementById('toasts')?.textContent ?? '';
const deviceArt = (): HTMLElement => document.querySelector('.device-art') as HTMLElement;

/** How many dots of a scene are clearly lit at `time`. */
function lit(scene: Scene, columns: number, rows: number, time = 1): number {
  return sample(scene, columns, rows, time).filter((level) => level > 0.5).length;
}

beforeEach(() => {
  // A narrow window that asks for reduced motion.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
});

describe('intro', () => {
  it('shows the intro, the version and an idle bar, and no console', () => {
    const page = open();
    expect(document.getElementById('intro')?.hidden).toBe(false);
    expect(document.getElementById('workspace')?.hidden).toBe(true);
    expect(page.text('version')).toBe('1.2.3');
    expect(page.text('title-device')).toBe('not connected');
    expect(page.text('title-state')).toBe('idle');
    expect(document.querySelector('#sphere canvas')).not.toBeNull();
    expect(document.getElementById('support-notice')?.hidden).toBe(true);
    expect(document.querySelector('input')).toBeNull();
  });

  it('explains a browser without Web Bluetooth and keeps the simulator', async () => {
    const page = open({ support: null });
    expect(page.text('support-notice')).toMatch(/no Web Bluetooth/);
    expect(document.getElementById('connect-button')?.hidden).toBe(true);
    expect(document.getElementById('connect-all-row')?.hidden).toBe(true);
    page.button('Try a simulated device').click();
    await page.settle();
    expect(page.text('title-state')).toBe('ready');
  });

  it('explains an insecure page', () => {
    const page = open({ support: 'insecure' });
    expect(page.text('support-notice')).toMatch(/HTTPS or from localhost/);
  });

  it('has no way into the simulator when the build ships without one', () => {
    open({ simulator: false });
    const buttons = [...document.querySelectorAll('button')].map((button) => button.textContent?.trim());
    expect(buttons).toContain('Connect a device');
    expect(buttons).not.toContain('Try a simulated device');
    expect(document.getElementById('demo-button')).toBeNull();
    expect(document.body.textContent).not.toMatch(/simulat/i);
  });

  it('shows the supported models as pictures, not buttons, without the simulator', () => {
    open({ simulator: false });
    const tiles = [...document.querySelectorAll<HTMLElement>('.model-tile')];
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'ILUMA i',
      'ILUMA i ONE',
      'ILUMA i PRIME',
      'ILUMA',
      'ILUMA ONE',
      'ILUMA PRIME',
    ]);
    expect(tiles.every((tile) => tile.querySelector('canvas') !== null)).toBe(true);
    expect(tiles.some((tile) => tile instanceof HTMLButtonElement)).toBe(false);
    expect(tiles.some((tile) => tile.hasAttribute('title'))).toBe(false);
    expect(document.querySelector('#model-tiles button')).toBeNull();
  });

  it('explains a missing or insecure Web Bluetooth without mentioning the simulator', () => {
    const page = open({ support: null, simulator: false });
    expect(page.text('support-notice')).toBe(
      'This browser has no Web Bluetooth, so it cannot reach a device. Use Chrome, Edge or Opera on desktop or Android.',
    );
    const insecure = open({ support: 'insecure', simulator: false });
    expect(insecure.text('support-notice')).toBe(
      'Bluetooth only works on a secure page. Open Sphere over HTTPS or from localhost.',
    );
  });

  it('offers the simulator beside Connect, with a line about it over the models', () => {
    const page = open();
    expect(page.button('Try a simulated device').id).toBe('demo-button');
    expect(page.button('Try a simulated device').parentElement).toBe(
      page.button('Connect a device').parentElement,
    );
    expect(document.querySelector('.card-lead')?.textContent).toBe(
      'No device at hand? Pick a model to try it simulated.',
    );
    expect(page.text('support-notice')).toBe('');
    const unsupported = open({ support: null });
    expect(unsupported.text('support-notice')).toMatch(/The simulated device still works here\.$/);
  });

  it('offers every supported model as a simulated device, each with its own picture', async () => {
    const page = open();
    const tiles = [...document.querySelectorAll<HTMLButtonElement>('.model-tile')];
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'ILUMA i',
      'ILUMA i ONE',
      'ILUMA i PRIME',
      'ILUMA',
      'ILUMA ONE',
      'ILUMA PRIME',
    ]);
    expect(tiles.every((tile) => tile.querySelector('canvas') !== null)).toBe(true);
    expect(tiles[5]?.title).toBe('Try a simulated ILUMA PRIME');

    page.button('ILUMA PRIME').click();
    await page.settle();
    expect(page.text('title-device')).toBe('simulated ILUMA PRIME');
    expect(deviceArt().getAttribute('aria-label')).toBe('ILUMA PRIME, battery 85%');
  });

  it('lists saved devices and forgets one', async () => {
    const saved = { id: 'ble-1', name: 'IQOS ILUMA i', model: 'iluma-i' };
    const page = open({ stored: { last: saved, devices: { minera: saved } } });
    const list = page.text('saved-devices');
    expect(list).toMatch(/minera/);
    expect(list).toMatch(/IQOS ILUMA i \(ILUMA i\)/);
    expect(list).toMatch(/Last connected: IQOS ILUMA i/);

    page.button('Forget').click();
    await page.settle();
    expect(page.text('saved-devices')).not.toMatch(/minera/);
    expect(JSON.parse(page.storage.get(STORAGE_KEY) ?? '{}').devices).toEqual({});
    expect(toastText()).toBe('Removed device label: minera');
  });

  it('connects through the chooser, a saved label, and the last device', async () => {
    const saved = { id: 'ble-1', name: 'IQOS ILUMA i', model: 'iluma-i' };
    const page = open({ stored: { last: saved, devices: { minera: saved } } });

    page.button('Connect').click();
    await page.settle();
    expect(page.text('title-device')).toBe('ILUMA i [minera]');
    page.button('Disconnect').click();
    await page.settle();

    page.button('Reconnect').click();
    await page.settle();
    expect(page.text('title-device')).toBe('ILUMA i');
    page.button('Disconnect').click();
    await page.settle();

    page.button('Connect a device').click();
    await page.settle();
    expect(page.text('title-state')).toBe('ready');
    page.button('Disconnect').click();
    await page.settle();

    page.button('List every nearby device').click();
    await page.settle();
    expect(document.getElementById('workspace')?.hidden).toBe(false);
  });
});

describe('workspace', () => {
  it('swaps the intro for the device and its settings, and back', async () => {
    const page = await connectedPage();
    expect(document.getElementById('intro')?.hidden).toBe(true);
    expect(document.getElementById('workspace')?.hidden).toBe(false);
    expect(page.text('title-device')).toBe('simulated ILUMA i');
    expect(page.text('title-state')).toBe('ready');
    expect(document.activeElement).toBe(document.getElementById('main'));

    const device = page.text('device-pane');
    expect(page.text('battery-level')).toBe('85%');
    expect(deviceArt().getAttribute('aria-label')).toBe('ILUMA i, battery 85%');
    expect(deviceArt().querySelector('canvas')).not.toBeNull();
    expect(device).toMatch(/IQOS ILUMA iILUMA iSimulated/);
    expect(device).toMatch(/product numberSIMCHARGER0001/);
    expect(device).toMatch(/holder firmwarev1\.2\.3\.24/);
    expect(device).toMatch(/serial numberN\/A/);
    expect(device).not.toMatch(/total puffs/);

    page.button('Disconnect').click();
    await page.settle();
    expect(document.getElementById('intro')?.hidden).toBe(false);
    expect(page.text('device-pane')).toBe('');
  });

  it('gives each setting a picture, a guide and then its controls', async () => {
    await connectedPage();
    const features = [...document.querySelectorAll<HTMLElement>('.feature')];
    expect(features.map((feature) => feature.id)).toEqual([
      'light',
      'vibration',
      'auto-start',
      'flexpuff',
      'gestures',
      'battery',
      'lock',
      'find',
    ]);
    for (const feature of features) {
      const parts = [...feature.children].map((child) => child.className);
      expect(parts).toEqual(['feature-art', 'feature-text', 'rows']);
      expect(feature.querySelector('.feature-art canvas')).not.toBeNull();
      expect(feature.querySelector('.guide-lead')?.textContent?.length).toBeGreaterThan(20);
      expect(feature.querySelector('.rows button')).not.toBeNull();
      const title = feature.querySelector('.feature-title');
      expect(feature.getAttribute('aria-labelledby')).toBe(title?.id);
    }

    // The jump links name the same settings, in the same order.
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.jump a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(features.map((feature) => `#${feature.id}`));
    expect(links[5]?.textContent).toBe('FlexBattery');
  });

  it('keeps each picture across redraws instead of rebuilding it', async () => {
    const page = await connectedPage();
    const before = document.querySelector('#light canvas');
    const device = deviceArt().querySelector('canvas');
    page.button('Low').click();
    await page.settle();
    page.button('Refresh').click();
    await page.settle();
    expect(document.querySelector('#light canvas')).toBe(before);
    expect(deviceArt().querySelector('canvas')).toBe(device);
  });

  it('applies settings from the controls and records the command', async () => {
    const page = await connectedPage();
    expect(page.button('High').getAttribute('aria-pressed')).toBe('true');

    page.button('Low').click();
    await page.settle();
    expect(page.button('Low').getAttribute('aria-pressed')).toBe('true');
    expect(page.button('High').getAttribute('aria-pressed')).toBe('false');
    expect(page.printed()).toContain('iqos> brightness low');
    expect(page.printed()).toContain('Brightness set to low');

    expect(page.button('Heating starts').getAttribute('role')).toBe('switch');
    expect(page.button('Heating starts').getAttribute('aria-checked')).toBe('true');
    page.button('Heating starts').click();
    page.button('Eco').click();
    page.button('Pause mode').click();
    await page.settle();
    expect(page.button('Heating starts').getAttribute('aria-checked')).toBe('false');
    expect(page.button('Eco').getAttribute('aria-pressed')).toBe('true');
    expect(page.button('Pause mode').getAttribute('aria-checked')).toBe('false');

    page.button('FlexPuff').click();
    page.button('Auto start').click();
    await page.settle();
    expect(page.printed()).toContain('FlexPuff disabled');
    expect(page.printed()).toContain('Autostart disabled');
    expect(page.button('FlexPuff').getAttribute('aria-checked')).toBe('false');
    expect(page.button('Auto start').getAttribute('aria-checked')).toBe('false');
  });

  it('replays a change as motion, once', async () => {
    const page = await connectedPage();
    expect(document.querySelector('.turned')).toBeNull();

    page.button('Heating starts').click();
    await page.settle();
    expect(page.button('Heating starts').classList.contains('turned')).toBe(true);

    // The next change belongs to another control; this one is at rest again.
    page.button('Low').click();
    await page.settle();
    expect(page.button('Heating starts').classList.contains('turned')).toBe(false);
    expect(page.button('Low').classList.contains('turned')).toBe(true);
    expect(page.button('High').classList.contains('turned')).toBe(false);
  });

  it('marks a pressed control as waiting until the device has answered', async () => {
    const page = await connectedPage();
    const low = page.button('Low');
    low.click();
    expect(low.classList.contains('is-waiting')).toBe(true);
    expect(document.getElementById('bar')?.dataset['busy']).toBe('true');
    await page.settle();
    expect(document.querySelector('.is-waiting')).toBeNull();
    expect(document.getElementById('bar')?.dataset['busy']).toBe('false');
  });

  it('remembers write-only settings for the session', async () => {
    const page = await connectedPage();
    expect(page.text('settings-pane')).toMatch(/The device does not report this setting\./);
    // Neither choice is marked until one has been made here.
    for (const name of ['On', 'Off', 'Locked', 'Unlocked']) {
      expect(page.button(name).getAttribute('aria-pressed')).toBe('false');
    }
    page.button('Off').click();
    page.button('Locked').click();
    await page.settle();
    const settings = page.text('settings-pane');
    expect(settings).toMatch(/Last set here: off\./);
    expect(settings).toMatch(/Last set here: locked\./);
    expect(page.button('Off').getAttribute('aria-pressed')).toBe('true');
    expect(page.button('Locked').getAttribute('aria-pressed')).toBe('true');

    page.button('On').click();
    page.button('Unlocked').click();
    await page.settle();
    expect(page.text('settings-pane')).toMatch(/Last set here: on\./);
    expect(page.text('settings-pane')).toMatch(/Last set here: unlocked\./);
  });

  it('starts and stops Find My IQOS from one button', async () => {
    const page = await connectedPage();
    page.button('Start vibrating').click();
    await page.settle();
    expect(page.text('title-state')).toBe('vibrating');
    expect(document.getElementById('workspace')?.dataset['finding']).toBe('true');
    expect(page.text('settings-pane')).toMatch(/The device is vibrating\./);

    page.button('Stop vibrating').click();
    await page.settle();
    expect(page.printed()).toContain('Stopped.');
    expect(page.text('title-state')).toBe('ready');
    expect(page.button('Start vibrating')).toBeDefined();
  });

  it('adds diagnosis rows and marks changed readings', async () => {
    const page = await connectedPage();
    const details = (): HTMLDetailsElement | null => document.querySelector('.device-details');
    // The test window is narrow, where the details start folded.
    expect(details()?.open).toBe(false);
    page.button('Read diagnosis').click();
    await page.settle();
    expect(details()?.open).toBe(true);
    expect(page.text('device-pane')).toMatch(/total puffs1234 \*/);
    expect(page.text('device-pane')).toMatch(/Decoded the way the iqos CLI does/);
    expect(document.querySelector('#device-pane .changed')).toBeNull();

    const link = page.app.session().link;
    vi.spyOn(link, 'readBatteryLevel').mockResolvedValue(40);
    page.button('Refresh').click();
    await page.settle();
    expect(document.querySelector('#device-pane .changed')?.textContent).toBe('40%');
    expect(deviceArt().getAttribute('aria-label')).toBe('ILUMA i, battery 40%');

    // The mark lasts until the next command, then the reading is old news.
    page.button('Refresh').click();
    await page.settle();
    expect(document.querySelector('#device-pane .changed')).toBeNull();
  });

  it('keeps the details list as the user left it', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width') }));
    const page = await connectedPage();
    const details = (): HTMLDetailsElement => document.querySelector('.device-details') as HTMLDetailsElement;
    // On a wide window there is room, so the list starts unfolded.
    expect(details().open).toBe(true);

    details().open = false;
    details().dispatchEvent(new Event('toggle'));
    page.button('Refresh').click();
    await page.settle();
    expect(details().open).toBe(false);
  });

  it('shows a failed read where the value would be', async () => {
    const page = await connectedPage();
    vi.spyOn(page.app.session().link, 'readBatteryLevel').mockRejectedValue(new Error('GATT read failed'));
    page.button('Refresh').click();
    await page.settle();
    const failed = document.querySelector('#device-pane .battery .bad');
    expect(failed?.textContent).toBe('read failed');
    expect(failed?.getAttribute('title')).toBe('GATT read failed');
    expect(deviceArt().getAttribute('aria-label')).toBe('ILUMA i, battery not read');
  });

  it('hides what the model lacks and says so', async () => {
    const page = open();
    page.button('ILUMA ONE').click();
    await page.settle();
    const settings = page.text('settings-pane');
    expect(document.getElementById('flexpuff')).toBeNull();
    expect(document.getElementById('battery')).toBeNull();
    expect(document.getElementById('light')).not.toBeNull();
    expect(settings).toMatch(/Not on ILUMA ONE: FlexPuff, FlexBattery, auto start, smart gesture\./);
    expect(settings).not.toMatch(/Charging starts/);
    expect(settings).toMatch(/Heating starts/);
    expect(page.text('device-pane')).not.toMatch(/holder/);
  });

  it('saves a real device under a label from the form', async () => {
    const page = open();
    page.button('Connect a device').click();
    await page.settle();

    const input = document.getElementById('save-label') as HTMLInputElement;
    const form = input.closest('form');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await page.settle();
    expect(page.printed().some((line) => line.startsWith('iqos> device save'))).toBe(false);

    // A label with a space is refused, not quietly cut down to its first word.
    input.value = 'my phone';
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await page.settle();
    expect(page.printed()).toContain('Usage: device save <label>');

    input.value = '  minera ';
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await page.settle();
    expect(page.printed()).toContain('Saved device label: minera');
    expect(JSON.parse(page.storage.get(STORAGE_KEY) ?? '{}').devices.minera).toMatchObject({ id: 'ble-1' });
  });

  it('keeps what is being typed in the save form while readings arrive', async () => {
    const page = open();
    page.button('Connect a device').click();
    await page.settle();

    const input = document.getElementById('save-label') as HTMLInputElement;
    input.value = 'half-typed';
    page.button('Refresh').click();
    await page.settle();
    expect(document.getElementById('save-label')).toBe(input);
    expect(input.value).toBe('half-typed');
  });

  it('has no save form for the simulated device', async () => {
    await connectedPage();
    expect(document.getElementById('save-label')).toBeNull();
  });

  it('fails loudly when the page skeleton is not what the code expects', () => {
    document.body.innerHTML = BODY.replace('id="toasts"', 'id="elsewhere"');
    const app = new App({
      storage: { getItem: () => null, setItem: () => undefined },
      bluetooth: null,
      version: '0',
    });
    expect(() => mount(app)).toThrow(/#toasts/);
  });

  it('offers a model picker when the name is not recognised', async () => {
    const page = open();
    const app = page.app;
    const device = new SimulatedDevice({ name: 'IQOS3_AABBCC' });
    // Reach in through the simulator path with an unrecognisable name.
    vi.spyOn(app, 'demo').mockImplementation(async () => {
      const attach = (app as unknown as { attach: (link: unknown, generation: number) => Promise<void> }).attach;
      const generation = ++(app as unknown as { generation: number }).generation;
      const hooks = (app as unknown as { hooks: (generation: number) => object }).hooks(generation);
      await attach.call(app, openSimulatedLink(device, hooks, 200), generation);
    });
    await page.run('demo');

    expect(page.text('device-pane')).toMatch(/does not say which model this is/);
    expect(page.text('settings-pane')).toMatch(/Settings appear once the model is known\./);
    // Find My IQOS needs no model, so it is there from the start.
    expect([...document.querySelectorAll('.feature')].map((feature) => feature.id)).toEqual(['find']);
    page.button('ILUMA PRIME').click();
    await page.settle();
    expect(page.text('title-device')).toBe('simulated ILUMA PRIME');
    expect(page.button('ILUMA PRIME').getAttribute('aria-pressed')).toBe('true');
    expect(page.button('High')).toBeDefined();
  });
});

describe('toasts', () => {
  it('says what a control did', async () => {
    const page = await connectedPage();
    expect(toastText()).toMatch(/^Connected to a simulated ILUMA i/);

    page.button('Low').click();
    await page.settle();
    expect(toastText()).toBe('Brightness set to low');
    expect(document.querySelector('.toast')?.classList.contains('error')).toBe(false);
  });

  it('reports a failure in its own colour, without the prefix', async () => {
    const page = await connectedPage();
    vi.spyOn(page.app.session().iqos, 'lock').mockRejectedValue(new Error('the device said no'));
    page.button('Locked').click();
    await page.settle();
    expect(toastText()).toBe('the device said no');
    expect(document.querySelector('.toast')?.classList.contains('error')).toBe(true);
  });

  it('stays quiet about output too long for one line', async () => {
    const page = await connectedPage();
    document.getElementById('toasts')?.replaceChildren();
    page.button('Read diagnosis').click();
    await page.settle();
    expect(toastText()).toBe('');
  });

  it('clears a toast after a few seconds', async () => {
    const page = await connectedPage();
    vi.useFakeTimers();
    page.button('Low').click();
    await vi.advanceTimersByTimeAsync(100);
    expect(toastText()).toBe('Brightness set to low');
    await vi.advanceTimersByTimeAsync(4000);
    expect(toastText()).toBe('');
    vi.useRealTimers();
  });
});

describe('session log', () => {
  it('copies what the controls sent and what came back', async () => {
    const page = await connectedPage();
    page.button('Low').click();
    await page.settle();

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const copy = page.button('Copy session log');
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledOnce();
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text).toMatch(/^Sphere 1\.2\.3 session log\n/);
    expect(text).toMatch(/iqos> brightness low\nBrightness set to low/);
    expect(text).toMatch(/\d\d:\d\d:\d\d\.\d{3} TX 00 C0 /);
    expect(text).toMatch(/ RX 00 /);
    expect(copy.textContent).toBe('Copied');

    writeText.mockRejectedValue(new Error('denied'));
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(copy.textContent).toBe('Copy failed');
    vi.unstubAllGlobals();
  });

  it('restores the button label after a moment', async () => {
    const page = await connectedPage();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const copy = page.button('Copy session log');
    copy.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(copy.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.textContent).toBe('Copy session log');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('formats times, flagged frames and an empty session as text', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();
    expect(formatTime(at)).toBe('03:04:05.006');
    expect(
      wireText([
        { id: 1, at, direction: 'tx', hex: '00 C0' },
        { id: 2, at, direction: 'stray', hex: '00 08', note: 'no request is waiting for this frame' },
      ]),
    ).toBe('03:04:05.006 TX 00 C0\n03:04:05.006 ?? 00 08  ; no request is waiting for this frame');
    expect(sessionLog({ console: [], wire: [] }, '9.9.9')).toBe(
      'Sphere 9.9.9 session log\n\n== Commands ==\n(none)\n\n== Frames ==\n(none)\n',
    );
  });
});

describe('dot screens', () => {
  it('samples a scene row by row and holds every level to 0..1', () => {
    const levels = sample((column, row) => column - row, 3, 2, 0);
    expect([...levels]).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it('paints every dot, lit or resting, in the canvas colour', () => {
    const canvas = fakeCanvas();
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ color: 'rgb(10, 20, 30)' } as CSSStyleDeclaration);
    const screen = createDotScreen(2, 1, (column) => column);
    expect(screen.element.width).toBe(screen.element.height * 2);
    screen.paint(0);
    expect(canvas.inks()).toEqual(['rgba(10, 20, 30, 0.110)', 'rgba(10, 20, 30, 1.000)']);

    // A new scene repaints at once; a colour that cannot be read falls back to white.
    vi.restoreAllMocks();
    const fallback = fakeCanvas();
    const plain = createDotScreen(1, 1, () => 1);
    plain.show(() => 0);
    expect(fallback.frames()).toBe(1);
    expect(fallback.inks()).toEqual(['rgba(255, 255, 255, 0.110)']);
    vi.restoreAllMocks();
  });

  it('moves the pictures on the page unless reduced motion is requested', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const moving = fakeCanvas();
    open();
    const first = moving.frames();
    expect(first).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(500);
    // The globe and the six model tiles are all on the page.
    expect(moving.frames()).toBeGreaterThan(first + 20);
    vi.restoreAllMocks();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }));
    const still = fakeCanvas();
    open();
    const frames = still.frames();
    await vi.advanceTimersByTimeAsync(500);
    expect(still.frames()).toBe(frames);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('repaints only what is on the page and in view, and can be stopped', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    let report: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe(): void {}
      },
    );
    const canvas = fakeCanvas();
    const stage = createStage();
    const screen = stage.screen('one', 2, 2, () => 1);
    // Asking again by name hands back the same screen with the new scene.
    expect(stage.screen('one', 2, 2, () => 0)).toBe(screen);
    expect(stage.screen('one', 3, 2, () => 0)).not.toBe(screen);
    const fresh = stage.screen('one', 3, 2, () => 0);
    stage.start();
    stage.start();

    const painted = canvas.frames();
    await vi.advanceTimersByTimeAsync(300);
    expect(canvas.frames()).toBe(painted); // not in the document yet

    document.body.replaceChildren(fresh.element);
    await vi.advanceTimersByTimeAsync(300);
    const visible = canvas.frames();
    expect(visible).toBeGreaterThan(painted);

    report([{ target: fresh.element, isIntersecting: false }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(canvas.frames()).toBe(visible);

    report([{ target: fresh.element, isIntersecting: true }]);
    await vi.advanceTimersByTimeAsync(300);
    const again = canvas.frames();
    expect(again).toBeGreaterThan(visible);

    stage.stop();
    stage.stop();
    await vi.advanceTimersByTimeAsync(300);
    expect(canvas.frames()).toBe(again);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows nothing, and breaks nothing, without a 2D context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('no canvas here');
    });
    const page = open();
    page.button('Try a simulated device').click();
    await page.settle();
    expect(page.text('title-state')).toBe('ready');
    vi.restoreAllMocks();
  });
});

describe('pictures', () => {
  const guide = (scene: Scene, time = 1): number => lit(scene, GUIDE_COLUMNS, GUIDE_ROWS, time);
  const device = (scene: Scene, time = 1): Float32Array => sample(scene, DEVICE_COLUMNS, DEVICE_ROWS, time);

  it('draws a round globe that turns', () => {
    const scene = globeScene();
    const frame = sample(scene, GLOBE_SIZE, GLOBE_SIZE, 1);
    const corner = (frame[0] ?? 0) + (frame[GLOBE_SIZE - 1] ?? 0) + (frame[frame.length - 1] ?? 0);
    expect(corner).toBe(0);
    expect(frame.filter((level) => level > 0.5).length).toBeGreaterThan(200);
    expect(sample(scene, GLOBE_SIZE, GLOBE_SIZE, 1)).toEqual(frame);
    expect(sample(scene, GLOBE_SIZE, GLOBE_SIZE, 2)).not.toEqual(frame);
  });

  it('draws each supported model differently', () => {
    const view = { level: 60, finding: false };
    const pictures = KNOWN_MODELS.map((model) => device(deviceScene(model, view)).join());
    expect(new Set(pictures).size).toBe(KNOWN_MODELS.length);

    expect(deviceForm('iluma-i-one')).toEqual({ allInOne: true, wrap: false, screen: true, known: true });
    expect(deviceForm('iluma-prime')).toEqual({ allInOne: false, wrap: true, screen: false, known: true });
    expect(deviceForm('iluma')).toEqual({ allInOne: false, wrap: false, screen: false, known: true });
    expect(deviceForm('unknown').known).toBe(false);

    // An unrecognised device is an outline only, and a faint one.
    const unknown = device(deviceScene('unknown', view));
    expect(Math.max(...unknown)).toBeLessThan(0.5);
    expect(unknown.some((level) => level > 0)).toBe(true);
  });

  it('fills the device with its battery level', () => {
    for (const model of ['iluma-i', 'iluma-prime', 'iluma-one', 'iluma-i-one'] as const) {
      const count = (level: number | null): number =>
        lit(deviceScene(model, { level, finding: false }), DEVICE_COLUMNS, DEVICE_ROWS, 2);
      expect(count(100)).toBeGreaterThan(count(50));
      expect(count(50)).toBeGreaterThan(count(1));
      // Any charge at all shows; none shows nothing.
      expect(count(1)).toBeGreaterThan(count(0));
    }

    // A low battery blinks; an unread one sweeps a single row.
    const low = deviceScene('iluma-i', { level: 10, finding: false });
    expect(device(low, 0.2)).not.toEqual(device(low, 0.65));
    const unread = deviceScene('iluma-i', { level: null, finding: false });
    expect(device(unread, 0.1)).not.toEqual(device(unread, 0.9));
  });

  it('shakes the device while it is being found', () => {
    for (const model of ['iluma-i', 'iluma-one'] as const) {
      const calm = deviceScene(model, { level: 50, finding: false });
      const found = deviceScene(model, { level: 50, finding: true });
      const top = (scene: Scene, time: number): string => [...device(scene, time).slice(0, DEVICE_COLUMNS * 6)].join();
      expect(top(calm, 0)).toBe(top(calm, 0.1));
      expect(top(found, 0)).not.toBe(top(found, 0.1));
    }
  });

  it('makes each guide picture follow its setting', () => {
    expect(guide(brightnessScene('high'))).toBeGreaterThan(guide(brightnessScene('low')));
    const unsure = brightnessScene(undefined);
    expect(guide(unsure, 0.5)).not.toBe(guide(unsure, 2.3));

    const wavesAt = (enabled: number): number =>
      Math.max(...[0.2, 0.5, 0.8, 1.1, 1.4].map((time) => guide(vibrationScene(enabled, 5, false), time)));
    expect(wavesAt(5)).toBeGreaterThan(wavesAt(1));
    expect(wavesAt(1)).toBeGreaterThan(wavesAt(0));
    expect(guide(vibrationScene(0, 5, true))).toBeGreaterThan(guide(vibrationScene(0, 5, false)));
    expect(guide(vibrationScene(3, 0, false))).toBe(guide(vibrationScene(0, 5, false)));

    // Once the stick is in, auto start heats the holder; without it, nothing glows.
    expect(guide(autoStartScene(true, false), 3)).toBeGreaterThan(guide(autoStartScene(false, false), 3));
    expect(guide(autoStartScene(undefined, true), 3)).toBeGreaterThan(guide(autoStartScene(true, false), 3));
    expect(guide(autoStartScene(true, false), 0.4)).not.toBe(guide(autoStartScene(true, false), 3));
    const waiting = sample(autoStartScene(false, false), GUIDE_COLUMNS, GUIDE_ROWS, 3.4);
    expect(waiting[8 * GUIDE_COLUMNS + 23]).toBeGreaterThan(0);

    // At the end of the count, FlexPuff has lit four more puffs.
    expect(guide(flexPuffScene(true), 6.3) - guide(flexPuffScene(false), 6.3)).toBe(8);
    expect(guide(flexPuffScene(undefined), 0.1)).toBeLessThan(guide(flexPuffScene(undefined), 3));

    const gestures = (on: boolean | null): number =>
      Math.max(...[0.5, 0.85, 1.2].map((time) => guide(gestureScene(on, false), time)));
    expect(gestures(true)).toBeGreaterThan(gestures(false));
    expect(gestures(null)).toBe(gestures(true));
    expect(guide(gestureScene(true, true), 2.5)).toBeGreaterThan(guide(gestureScene(true, false), 2.5));

    const performance = guide(batteryScene('performance', false));
    const paused = guide(batteryScene('performance', true));
    const eco = guide(batteryScene('eco', true));
    expect(performance).toBeGreaterThan(paused);
    expect(paused).toBeGreaterThan(eco);
    const unread = batteryScene(undefined, undefined);
    expect(guide(unread, 0.2)).not.toBe(guide(unread, 3));

    expect(guide(lockScene(true))).toBeGreaterThan(guide(lockScene(false)));
    const either = lockScene(null);
    expect(sample(either, GUIDE_COLUMNS, GUIDE_ROWS, 0.4)).not.toEqual(
      sample(either, GUIDE_COLUMNS, GUIDE_ROWS, 2.2),
    );

    const rings = (finding: boolean): number =>
      Math.max(...[0.3, 0.6, 0.9, 1.2].map((time) => guide(findScene(finding), time)));
    expect(rings(true)).toBeGreaterThan(rings(false));
  });

  it('redraws the picture when its setting changes on the page', async () => {
    const canvas = fakeCanvas();
    const page = await connectedPage();
    const before = canvas.frames();
    page.button('Start vibrating').click();
    await page.settle();
    // The find picture and the device both change, without the stage running.
    expect(canvas.frames()).toBeGreaterThan(before + 1);
    vi.restoreAllMocks();
  });
});
