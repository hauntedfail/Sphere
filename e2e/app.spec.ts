import { expect, test, type Page } from '@playwright/test';

/**
 * Critical flows against the production build, using the simulated device.
 * Every test also fails on a console error or a CSP violation.
 */

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  problems.set(page, seen);
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') seen.push(message.text());
  });
  page.on('pageerror', (error) => seen.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page) ?? [], 'console errors and CSP violations').toEqual([]);
});

async function connectSimulator(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a simulated device' }).click();
  await expect(page.locator('#title-state')).toHaveText('ready');
}

const toasts = (page: Page) => page.locator('#toasts');

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

test('loads under its security policy without leaving its origin', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sphere' })).toBeVisible();
  await expect(page.locator('#version')).toHaveText(/^\d+\.\d+\.\d+$/);
  // The globe is drawn, not downloaded: some of its dots must be lit.
  const litPixels = await page.locator('#sphere canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    let lit = 0;
    for (let index = 3; index < data.length; index += 4) if ((data[index] ?? 0) > 200) lit++;
    return lit;
  });
  expect(litPixels).toBeGreaterThan(1000);
  // Sphere is a control surface: there is no console to type into.
  await expect(page.locator('input')).toHaveCount(0);

  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("require-trusted-types-for 'script'");

  expect(requests.length).toBeGreaterThan(2);
  for (const url of requests) expect(url.startsWith(baseURL ?? ''), url).toBe(true);
  await expectNoSidewaysScroll(page);
});

test('the policy really blocks network requests and inline script', async ({ page }) => {
  await page.goto('/');
  const blocked = await page.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(event.effectiveDirective);
    });
    const fetched = await fetch('https://example.com/').then(
      () => 'allowed',
      () => 'blocked',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { fetched, violations };
  });
  expect(blocked.fetched).toBe('blocked');
  expect(blocked.violations).toContain('connect-src');

  // The probe above is expected to complain; it is not a defect.
  problems.set(page, []);
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

test('keeps saved devices across visits and can forget them', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') !== null) return;
    sessionStorage.setItem('seeded', '1');
    const device = { id: 'opaque-id', name: 'IQOS ILUMA i', model: 'iluma-i' };
    localStorage.setItem('sphere.devices.v1', JSON.stringify({ last: device, devices: { minera: device } }));
  });
  await page.goto('/');

  const saved = page.locator('#saved-devices');
  await expect(saved).toContainText('minera');
  await expect(saved).toContainText('Last connected: IQOS ILUMA i');

  await saved.getByRole('button', { name: 'Forget' }).click();
  await expect(toasts(page)).toHaveText('Removed device label: minera');

  await page.reload();
  await expect(page.locator('#saved-devices')).not.toContainText('minera');
  await expect(page.locator('#saved-devices')).toContainText('Last connected');
});

test('never renders stored text as markup', async ({ page }) => {
  await page.addInitScript(() => {
    const device = { id: 'x', name: '<img src=x onerror=alert(1)>', model: 'iluma-i' };
    localStorage.setItem('sphere.devices.v1', JSON.stringify({ last: device, devices: { ok: device } }));
  });
  await page.goto('/');
  await expect(page.locator('#saved-devices')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('#saved-devices img').count()).toBe(0);
});

test('says so when the browser has no Web Bluetooth', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'bluetooth', { get: () => undefined });
  });
  await page.goto('/');
  await expect(page.locator('#support-notice')).toContainText('no Web Bluetooth');
  await expect(page.getByRole('button', { name: 'Connect a device' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Try a simulated device' })).toBeVisible();
});
