import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('initial UI, keyboard access, narrow screen and accessibility', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pianissimo');
  await expect(page.locator('#file')).toBeDisabled();
  await expect(page.locator('#record')).toBeDisabled();
  await expect(page.locator('#load')).toBeEnabled();
  await page.keyboard.press('Tab');
  await expect(page.locator('#settings-open')).toBeFocused();
  await page.locator('#live-tab').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#file-tab')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#live-tab')).toBeFocused();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await expect(page.locator('#load')).toBeVisible();
  expect(requests.filter((url) => !url.startsWith('http://127.0.0.1'))).toEqual([]);
});
test('download failure is actionable and retry works; cancellation restores controls', async ({
  page,
  context,
}) => {
  await context.route('https://huggingface.co/**', (route) =>
    route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto('/');
  await page.locator('#load').click();
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.locator('#load')).toBeEnabled();
  await context.unroute('https://huggingface.co/**');
  await context.route('https://huggingface.co/**', () => {});
  await page.locator('#load').click();
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('Cancelled');
  await expect(page.locator('#load')).toBeEnabled();
  await expect(page.locator('#quantization')).toBeEnabled();
});
test('partial model cannot enter the cache', async ({ page, context }) => {
  await context.route('https://huggingface.co/**', (route) =>
    route.fulfill({ body: 'bad model', headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto('/');
  await page.locator('#load').click();
  await expect(page.getByRole('alert')).toContainText('integrity check');
  await page.locator('#settings-open').click();
  await page.locator('#clear-cache').click();
  await expect(page.locator('#status')).toContainText('Downloaded models deleted.');
});

test('popup art, local font and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 420, height: 590 });
  await page.goto('/popup.html');
  await expect(page.locator('.signal-contours img')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('300 32px Geist'))).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(590);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('popup-ready.png') });
  await page.locator('#settings-open').click();
  await expect(page.locator('#settings')).toBeVisible();
  const settingsAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(settingsAxe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-open')).toBeFocused();
});

test('multilingual selection shows its download, precision and supported languages', async ({
  page,
}) => {
  await page.goto('/popup.html');
  await page.locator('#language').selectOption('parakeet-tdt-v3');
  await expect(page.locator('#language option:checked')).toHaveText('Multilingual · Parakeet');
  await expect(page.locator('#download-size')).toHaveText('671 MB on first download');
  await page.locator('#settings-open').click();
  await expect(page.locator('#model-name')).toHaveText('Parakeet TDT v3');
  await expect(page.locator('#quantization option')).toHaveCount(1);
  await page.locator('#supported-languages summary').click();
  await expect(page.locator('#language-list')).toContainText('English');
  await expect(page.locator('#language-list')).toContainText('Ukrainian');
  await expect(page.locator('#language-list')).not.toContainText('Norwegian');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.locator('#settings-close').click();
  await page.locator('#language').selectOption('pianissimo-sv');
  await expect(page.locator('#download-size')).toHaveText('661 MB on first download');
  await expect(page.locator('#quantization option')).toHaveCount(2);
});
