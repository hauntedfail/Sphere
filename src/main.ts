import './styles.css';
import { App } from './app/app';
import type { KeyValueStore } from './storage/devices';
import { createBluetoothGateway } from './transport/web-bluetooth';
import { mount } from './ui/view';

/** `localStorage` can throw on access when storage is blocked; fall back to memory. */
function openStorage(): KeyValueStore {
  try {
    const storage = window.localStorage;
    storage.getItem('sphere.probe');
    return storage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    };
  }
}

const app = new App({
  storage: openStorage(),
  bluetooth: createBluetoothGateway(),
  version: __APP_VERSION__,
});

mount(app);

// Closing the tab drops the link; say so to the device rather than timing out.
window.addEventListener('pagehide', () => {
  if (app.store.get().phase === 'connected') void app.disconnect().catch(() => undefined);
});
