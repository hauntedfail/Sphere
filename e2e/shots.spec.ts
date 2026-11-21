import { test } from '@playwright/test';

/**
 * Not assertions: screenshots for reviewing the design by eye. Runs on the
 * debug build. `SHOTS_LANG=ja` takes them in that language; the controls are
 * found by their keys, which are the same in every language.
 */
test('screenshots', async ({ page }, info) => {
  test.skip(process.env['SHOTS'] === undefined, 'set SHOTS=1 to capture screenshots');
  const language = process.env['SHOTS_LANG'];
  const suffix = language === undefined ? '' : `-${language}`;
  const shot = (name: string) =>
    page.screenshot({ path: `e2e/.shots/${info.project.name}-${name}${suffix}.png`, fullPage: true });
  const control = (key: string) => page.locator(`[data-key="${key}"]`);

  await page.goto(language === undefined ? '/' : `/?lang=${language}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await shot('1-intro');

  await page.locator('#demo-button').click();
  await control('refresh').waitFor();
  await page.locator('#title-state[data-state="ready"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await shot('2-connected');

  await control('diagnosis').click();
  await control('brightness-low').click();
  await control('vibration-heating').click();
  await control('find').click();
  await page.locator('#workspace[data-finding="true"]').waitFor();
  await page.waitForTimeout(200);
  await shot('3-busy');
});
