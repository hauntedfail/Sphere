import { test } from '@playwright/test';

/** Not assertions: screenshots for reviewing the design by eye. */
test('screenshots', async ({ page }, info) => {
  test.skip(process.env['SHOTS'] === undefined, 'set SHOTS=1 to capture screenshots');
  const shot = (name: string) =>
    page.screenshot({ path: `e2e/.shots/${info.project.name}-${name}.png`, fullPage: true });

  await page.goto('/');
  await page.waitForTimeout(300);
  await shot('1-intro');

  await page.getByRole('button', { name: 'Try a simulated device' }).click();
  await page.getByRole('button', { name: 'Refresh' }).waitFor();
  await page.waitForFunction(() => document.getElementById('title-state')?.textContent === 'ready');
  await shot('2-connected');

  await page.getByRole('button', { name: 'Read diagnosis' }).click();
  await page.getByRole('button', { name: 'Low', exact: true }).click();
  await page.getByRole('switch', { name: 'Heating starts' }).click();
  await page.getByRole('button', { name: 'Start vibrating' }).click();
  await page.getByRole('button', { name: 'Stop vibrating' }).waitFor();
  await page.waitForTimeout(200);
  await shot('3-busy');

});
