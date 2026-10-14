import { test, expect, type Page } from '@playwright/test';

async function create(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nuovo preset', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome del preset', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('orbit.presets')!));

test('preset editor isolates hub, saves geometry and click behavior, applies, replaces, hides and restarts inactive', async ({ page }) => {
  await page.goto('/');
  const original = await page.evaluate(() => localStorage.getItem('orbit.home-layout'));
  await create(page, 'Gaming');
  await expect(page.getByRole('button', { name: 'APPLY', exact: true })).toBeDisabled();
  await page.locator('.widget-picker summary').click();
  await page.getByRole('checkbox', { name: 'Logo e orologio', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Avvio rapido', exact: true }).check();
  await page.locator('.widget-picker summary').click();
  await page.getByRole('button', { name: 'Lascia passare i clic: Logo e orologio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lascia passare i clic: Logo e orologio', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Sposta Logo e orologio', exact: true }).press('ArrowRight');
  await expect.poll(async () => (await saved(page)).presets[0].layout.rects.logo.x).toBe(13);
  expect((await saved(page)).presets[0].clickThrough).toEqual(['logo']);
  await page.getByRole('button', { name: 'APPLY', exact: true }).click();
  await expect(page.getByRole('button', { name: 'HIDE', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Gaming', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+e');
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('tab', { name: 'Hub', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Hub', exact: true }).click();
  await expect(page.locator('.active-preset-badge')).toContainText('Gaming');
  expect(await page.evaluate(() => localStorage.getItem('orbit.home-layout'))).toBe(original);
  await create(page, 'Work');
  await page.getByRole('button', { name: 'Copia il layout dell’hub', exact: true }).click();
  await page.getByRole('button', { name: 'APPLY', exact: true }).click();
  await page.getByRole('tab', { name: 'Gaming', exact: true }).click();
  await expect(page.getByRole('button', { name: 'APPLY', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'HIDE', exact: true }).click();
  await expect(page.getByRole('button', { name: 'APPLY', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'APPLY', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Hub', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.live-dot')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Gaming', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lascia passare i clic: Logo e orologio', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-widget-id=logo]')).toHaveCSS('left', '13px');
});

test('rename, keyboard and touch navigation, delete confirmation and recoverable save failure', async ({ page }) => {
  await page.goto('/');
  await create(page, 'Work');
  await page.getByRole('textbox', { name: 'Rinomina preset' }).fill('Focus');
  await page.getByRole('textbox', { name: 'Rinomina preset' }).press('Tab');
  await expect(page.getByRole('tab', { name: 'Focus', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Hub', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('.workspace').evaluate(element => {
    const touch = (x: number) => new Touch({ identifier: 1, target: element, clientX: x, clientY: 400 });
    element.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(500)], bubbles: true }));
    element.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(300)], bubbles: true }));
  });
  await expect(page.getByRole('tab', { name: 'Focus', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'orbit.presets') throw new Error('Disco pieno'); original.call(this, key, value); };
    Object.assign(window, { restoreStorage: () => { Storage.prototype.setItem = original; } });
  });
  await page.getByRole('textbox', { name: 'Rinomina preset' }).fill('Failed');
  await page.getByRole('textbox', { name: 'Rinomina preset' }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Disco pieno');
  expect((await saved(page)).presets[0].name).toBe('Focus');
  await page.evaluate(() => (window as unknown as { restoreStorage(): void }).restoreStorage());
  await page.getByRole('button', { name: 'Elimina preset', exact: true }).click();
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Focus', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Elimina preset', exact: true }).click();
  await page.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Focus', exact: true })).toHaveCount(0);
  expect((await saved(page)).presets).toEqual([]);
});
