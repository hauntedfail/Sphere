import type { Page } from '@playwright/test';
import {
  SIMULATOR_MARKERS,
  bundleCode,
  expect,
  expectNoSidewaysScroll,
  expectSecurityPolicy,
  servedCode,
  test,
  toasts,
} from './support';

/**
 * The debug build (`pnpm build:debug`), which carries the simulated device.
 * These are the flows that need a device to talk to. The debug build keeps
 * the production security policy, so they run under it too.
 */

async function connectSimulator(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a simulated device' }).click();
  await expect(page.locator('#title-state')).toHaveText('ready');
}

test('carries the simulator under the same security policy', async ({ page }) => {
  await page.goto('/');
  await expectSecurityPolicy(page);
  await expect(page.getByRole('button', { name: 'Try a simulated device' })).toBeVisible();
  await expect(page.locator('button.model-tile')).toHaveCount(6);
  await expectNoSidewaysScroll(page);

  // The markers the production build is checked against are real: they are here.
  const code = bundleCode('dist-debug');
  for (const marker of SIMULATOR_MARKERS) {
    expect(code.includes(marker), `"${marker}" in the debug bundle`).toBe(true);
  }

  // A deployed site is checked through its served scripts instead. That has
  // to reach a chunk nothing has loaded yet, which is where the simulator is.
  const served = await servedCode(page);
  for (const marker of SIMULATOR_MARKERS) {
    expect(served.includes(marker), `"${marker}" in the served debug scripts`).toBe(true);
  }
});

test('connects to the simulated device and reads it', async ({ page }) => {
  await connectSimulator(page);
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('#title-device')).toHaveText('simulated ILUMA i');

  const device = page.locator('#device-pane');
  await expect(page.locator('#battery-level')).toHaveText('85%');
  await expect(page.getByRole('img', { name: 'ILUMA i, battery 85%' })).toBeVisible();
  await expect(device).toContainText('SIMCHARGER0001');
  await expect(device).toContainText('v1.2.3.24');
  await expect(toasts(page)).toContainText('Connected to a simulated ILUMA i');
  await expectNoSidewaysScroll(page);
});

test('changes settings from the controls', async ({ page }) => {
  await connectSimulator(page);

  const low = page.getByRole('button', { name: 'Low', exact: true });
  await expect(low).toHaveAttribute('aria-pressed', 'false');
  await low.click();
  await expect(low).toHaveAttribute('aria-pressed', 'true');
  // The outcome of a click is announced on the page.
  await expect(toasts(page)).toHaveText('Brightness set to low');

  const charging = page.getByRole('switch', { name: 'Charging starts' });
  await expect(charging).toBeChecked();
  await charging.click();
  await expect(charging).not.toBeChecked();
  await expect(toasts(page)).toHaveText('Vibration settings updated');

  await page.getByRole('button', { name: 'Eco' }).click();
  await expect(page.getByRole('button', { name: 'Eco' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await expect(page.locator('#settings-pane')).toContainText('Last set here: locked.');
  await expectNoSidewaysScroll(page);
});

test('vibrates until stopped, then disconnects back to the intro', async ({ page }) => {
  await connectSimulator(page);

  await page.getByRole('button', { name: 'Start vibrating' }).click();
  await expect(page.locator('#title-state')).toHaveText('vibrating');
  await page.getByRole('button', { name: 'Stop vibrating' }).click();
  await expect(toasts(page)).toHaveText('Stopped.');
  await expect(page.locator('#title-state')).toHaveText('ready');

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#title-device')).toHaveText('not connected');
  await expect(page.locator('#main')).toBeFocused();
});

test('works from the keyboard alone', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard navigation is a desktop concern');
  await page.goto('/');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to the controls' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const demo = page.getByRole('button', { name: 'Try a simulated device' });
  await demo.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#title-state')).toHaveText('ready');
  await expect(page.locator('#main')).toBeFocused();

  const high = page.getByRole('button', { name: 'High', exact: true });
  await high.focus();
  await page.keyboard.press('Tab');
  // Brightness was "High"; the next stop is the first vibration switch.
  const heating = page.getByRole('switch', { name: 'Heating starts' });
  await expect(heating).toBeFocused();
  await page.keyboard.press('Space');
  await expect(heating).not.toBeChecked();
  // Redrawing the pane must not throw the keyboard user out of it.
  await expect(heating).toBeFocused();
});

test('shows every setting with its picture and guide, and jumps between them', async ({ page }) => {
  await connectSimulator(page);
  const features = page.locator('.feature');
  await expect(features).toHaveCount(8);
  for (const id of ['light', 'vibration', 'auto-start', 'flexpuff', 'gestures', 'battery', 'lock', 'find']) {
    const feature = page.locator(`#${id}`);
    await expect(feature.locator('canvas')).toHaveCount(1);
    await expect(feature.locator('.guide-lead')).not.toBeEmpty();
  }

  await page.getByRole('link', { name: 'Lock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lock', exact: true })).toBeInViewport();
  await expectNoSidewaysScroll(page);
});

test('draws the connected model, and a different one for each', async ({ page }) => {
  await page.goto('/');
  const tiles = page.locator('.model-tile');
  await expect(tiles).toHaveCount(6);

  const picture = (model: string) =>
    page
      .getByRole('img', { name: `${model}, battery 85%` })
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

  await page.getByRole('button', { name: 'ILUMA ONE', exact: true }).click();
  await expect(page.locator('#title-device')).toHaveText('simulated ILUMA ONE');
  await expect(page.locator('#flexpuff')).toHaveCount(0);
  const allInOne = await picture('ILUMA ONE');

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'ILUMA i PRIME', exact: true }).click();
  await expect(page.locator('#title-device')).toHaveText('simulated ILUMA i PRIME');
  await expect(page.locator('#flexpuff')).toHaveCount(1);
  // A holder beside a charger is not the same drawing as a single body.
  const kit = await picture('ILUMA i PRIME');
  expect(kit.length).toBeGreaterThan(1000);
  expect(kit).not.toBe(allInOne);
});

test('keeps the simulator when the browser has no Web Bluetooth', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'bluetooth', { get: () => undefined });
  });
  await page.goto('/');
  await expect(page.locator('#support-notice')).toContainText('The simulated device still works here.');
  await expect(page.getByRole('button', { name: 'Connect a device' })).toBeHidden();
  await page.getByRole('button', { name: 'Try a simulated device' }).click();
  await expect(page.locator('#title-state')).toHaveText('ready');
});

test('changing the language keeps the device connected', async ({ page }) => {
  await connectSimulator(page);
  const level = await page.locator('#battery-level').textContent();
  await page.locator('#language').selectOption('ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#title-state')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#battery-level')).toHaveText(level ?? '');
  await expect(page.locator('#device-pane [data-key="disconnect"]')).toBeVisible();
  await expect(toasts(page)).toBeEmpty();
});

for (const locale of ['ja', 'zh-Hans', 'zh-Hant', 'ko', 'ru', 'it']) {
  test(`${locale}: the connected page fits the screen`, async ({ page }) => {
    await page.goto(`/?lang=${locale}`);
    await page.locator('#demo-button').click();
    await expect(page.locator('#title-state')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(() => document.fonts.ready);
    await expectNoSidewaysScroll(page);
    await page.locator('[data-key="details-summary"]').click();
    await expectNoSidewaysScroll(page);
  });
}

/** Elements that reach past the right edge of the screen, apart from what sits in a box that scrolls. */
function pastTheEdge(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth;
    return [...document.querySelectorAll('.shell *')]
      .filter((element) => element.closest('.table-scroll') === null)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.right > edge + 0.5;
      })
      .map((element) => `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}.${element.className}`);
  });
}

for (const locale of ['en', 'ja', 'zh-Hans', 'zh-Hant', 'ko', 'ru', 'it']) {
  test(`${locale}: everything stays inside a 320px screen`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`/?lang=${locale}`);
    await expect(page.locator('main[data-mounted]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await pastTheEdge(page), 'on the start page').toEqual([]);

    await page.locator('#demo-button').click();
    await expect(page.locator('#title-state')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(() => document.fonts.ready);
    expect(await pastTheEdge(page), 'connected').toEqual([]);

    // A set of choices must also stay inside its own row, not only inside the screen.
    const choices = await page.evaluate(() =>
      [...document.querySelectorAll('.segmented')].map((element) =>
        Math.round(
          element.getBoundingClientRect().right - (element.closest('.row') as Element).getBoundingClientRect().right,
        ),
      ),
    );
    expect(Math.max(...choices), 'choices past the edge of their row, px').toBeLessThanOrEqual(0);
  });
}
