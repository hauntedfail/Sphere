import { expect, headerRules, live, scriptUrls, test } from './support';

/**
 * A deployed site: `SPHERE_URL=https://… pnpm e2e`. These are the checks a
 * local preview cannot make, because they are about the host: the response
 * headers it sends, and whether it leaves the page as it was built.
 */

const rules = headerRules();
const everywhere = rules.get('/*') ?? [];
const fingerprinted = rules.get('/assets/*') ?? [];
const pageOnly = rules.get('/') ?? [];

test('the page arrives with the headers public/_headers asks for', async ({ page }) => {
  const response = await page.goto('/');
  const sent = response?.headers() ?? {};

  expect(everywhere.length).toBeGreaterThan(5);
  for (const [name, value] of everywhere) expect(sent[name.toLowerCase()], name).toBe(value);
  // The page is asked for again on every visit, and is not to be rewritten.
  expect(pageOnly.length).toBeGreaterThan(0);
  for (const [name, value] of pageOnly) expect(sent[name.toLowerCase()], name).toBe(value);
});

test('so does every other file, and the fingerprinted ones may be kept', async ({ page }) => {
  await page.goto('/');
  const [script] = await scriptUrls(page);
  expect(script).toContain('/assets/');

  const sent = (await page.request.get(script ?? '')).headers();
  for (const [name, value] of everywhere) expect(sent[name.toLowerCase()], name).toBe(value);
  expect(fingerprinted.length).toBeGreaterThan(0);
  for (const [name, value] of fingerprinted) expect(sent[name.toLowerCase()], name).toBe(value);
});

test('the host adds nothing to the page', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect a device' })).toBeVisible();

  // A host can rewrite HTML on its way out (analytics beacons, script
  // loaders, bot checks). Some of those are served from the site's own
  // origin, where the security policy would let them run.
  await expect(page.locator('script:not([src])')).toHaveCount(0);
  const scripts = await scriptUrls(page);
  expect(scripts.length).toBeGreaterThan(0);
  for (const url of scripts) expect(url.startsWith(`${baseURL}/assets/`), url).toBe(true);
  for (const url of requests) expect(url, url).not.toContain('/cdn-cgi/');
});

test('is a secure context, which Web Bluetooth needs', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
});

test('sends plain HTTP on to HTTPS', async ({ request, baseURL }) => {
  test.skip(live?.loopback !== false, 'a server on this machine speaks plain HTTP on purpose');

  // On Cloudflare this is the zone's "Always Use HTTPS" setting.
  const secure = new URL(baseURL ?? '');
  const response = await request.get(`http://${secure.host}/`, { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(response.status());
  expect(response.headers()['location']).toBe(`${secure.origin}/`);
});
