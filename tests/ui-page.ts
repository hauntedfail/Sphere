import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App, type AppDeps } from '../src/app/app';
import type { BluetoothGateway, BluetoothSupport } from '../src/transport/link';
import { SimulatedDevice, createSimulator, openSimulatedLink } from '../src/transport/simulator';
import { mount } from '../src/ui/view';

// The page skeleton is the real one, so the tests break if the markup drifts.
const PAGE = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
export const BODY = /<body>([\s\S]*)<\/body>/.exec(PAGE)?.[1] ?? '';

export interface Page {
  readonly app: App;
  readonly storage: Map<string, string>;
  /** Wait until every queued command has finished. */
  settle(): Promise<void>;
  /** A visible button, found by the key the page gave it rather than by its words. */
  buttonByKey(key: string): HTMLButtonElement;
  text(id: string): string;
  /** Run a command the way a control would, and wait for it. */
  run(line: string): Promise<void>;
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

export type PageOptions = Partial<Pick<AppDeps, 'i18n' | 'loadI18n'>> & {
  readonly stored?: Readonly<Record<string, string>>;
};

/** Put the real page in the document and bind an app to it. */
export function openPage(options: PageOptions = {}): Page {
  document.documentElement.setAttribute('lang', 'en');
  document.body.innerHTML = BODY;
  const storage = new Map<string, string>(Object.entries(options.stored ?? {}));
  const app = new App({
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) },
    bluetooth: fakeGateway('ok'),
    version: '1.2.3',
    simulator: createSimulator({ latencyMs: 0 }),
    ...(options.i18n === undefined ? {} : { i18n: options.i18n }),
    ...(options.loadI18n === undefined ? {} : { loadI18n: options.loadI18n }),
  });
  mount(app);
  return {
    app,
    storage,
    settle: () => app.whenIdle(),
    buttonByKey: (key) => {
      const match = [...document.querySelectorAll<HTMLButtonElement>('button[data-key]')].find(
        (candidate) => candidate.dataset['key'] === key && candidate.closest('[hidden]') === null,
      );
      if (match === undefined) throw new Error(`no visible button with key "${key}"`);
      return match;
    },
    text: (id) => document.getElementById(id)?.textContent ?? '',
    run: async (line) => {
      await app.run(line);
      await app.whenIdle();
    },
  };
}

/** A page with the simulated device connected and every reading in. */
export async function connectedPage(options: PageOptions = {}): Promise<Page> {
  const page = openPage(options);
  await page.run('demo');
  return page;
}

/** The same, connected the way a real device is, so the page offers to save it. */
export async function bluetoothPage(options: PageOptions = {}): Promise<Page> {
  const page = openPage(options);
  await page.run('connect');
  return page;
}
