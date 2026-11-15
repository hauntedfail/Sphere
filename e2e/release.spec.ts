import {
  SIMULATOR_MARKERS,
  bundleCode,
  expect,
  expectNoSidewaysScroll,
  expectSecurityPolicy,
  live,
  servedCode,
  test,
  toasts,
} from './support';

/**
 * The production build: what `pnpm build` writes and a host serves. It has
 * no simulator, so these tests cover everything that needs no device. With
 * `SPHERE_URL` set they run against that host instead of a local preview.
 */

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

  await expectSecurityPolicy(page);

  expect(requests.length).toBeGreaterThan(2);
  for (const url of requests) expect(url.startsWith(baseURL ?? ''), url).toBe(true);
  await expectNoSidewaysScroll(page);
});

test('the policy really blocks network requests and inline script', async ({ page, problems }) => {
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
  problems.length = 0;
});

test('ships without the simulator', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect a device' })).toBeVisible();

  // No way in: no button for it, and the model pictures are not controls.
  await expect(page.getByRole('button', { name: /simulat/i })).toHaveCount(0);
  await expect(page.locator('.model-tile')).toHaveCount(6);
  await expect(page.locator('button.model-tile')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/simulat/i);

  // And nothing behind it: the simulated device's own code is not in the bundle.
  const code = live === null ? bundleCode('dist') : await servedCode(page);
  expect(code.length).toBeGreaterThan(10_000);
  for (const marker of SIMULATOR_MARKERS) {
    expect(code.includes(marker), `"${marker}" in the production bundle`).toBe(false);
  }
  await expectNoSidewaysScroll(page);
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
  await expect(page.locator('#support-notice')).toContainText('On an iPhone or iPad, use Bluefy.');
  await expect(page.locator('#support-notice')).not.toContainText(/simulat/i);
  await expect(page.getByRole('button', { name: 'Connect a device' })).toBeHidden();
});

test('serves the picture that link previews show', async ({ page }) => {
  await page.goto('/');
  const address = await page.locator('meta[property="og:image"]').getAttribute('content');
  // The page names it by its public address. Ask this site for the same path.
  expect(address).toMatch(/^https:\/\//);
  const response = await page.request.get(new URL(address ?? '').pathname);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toBe('image/png');
});
