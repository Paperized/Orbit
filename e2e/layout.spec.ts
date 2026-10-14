import { test, expect, type Page } from '@playwright/test';
const key = 'orbit.home-layout';
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
test('typing searches from the canvas and opening the overlay focuses search without stealing form input', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Cerca app e azioni' });
  await page.locator('.app-shell').focus();
  await page.keyboard.type('Chat');
  await expect(search).toHaveValue('Chat');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+e');
  await expect(search).toBeFocused();
  await page.keyboard.type('note');
  await expect(search).toHaveValue('note');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
  await page.locator('.recovery summary').click();
  const x = page.getByLabel('x', { exact: true });
  await x.fill('123');
  await expect(x).toHaveValue('123');
  await expect(search).toHaveValue('');
});
async function drag(page: Page, selector: string, dx: number, dy: number, end = true) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(selector);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 3 });
  if (end) await page.mouse.up();
}
test('all builtins and app widgets resize/move freely, persist and recover from tiny sizes', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ version: 2, favorites: [], clock: false, ai: true,
    widgets: [{ id: 'demo-widget', appId: 'missing', widgetId: 'recent', title: 'App widget', x: 0, y: 0, width: 1, height: 1 }] })), key);
  await page.goto('/');
  await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
  await expect(page.locator('[data-widget-id=search] .widget-handle')).toBeVisible();
  await drag(page, '[data-widget-id=search] .widget-handle', 13, 7);
  let layout = await saved(page);
  expect(layout.version).toBe(3);
  expect(layout.rects.search.x % 20).not.toBe(0);
  const searchRect = layout.rects.search;
  await drag(page, '[data-widget-id=search] .se', 31, 19);
  await expect.poll(async () => (await saved(page)).rects.search.width).toBe(searchRect.width + 31);
  for (const id of ['logo', 'favorites', 'dock', 'demo-widget']) {
    await drag(page, `[data-widget-id="${id}"] .widget-handle`, -7, -9);
    const before = await page.locator(`[data-widget-id="${id}"]`).boundingBox();
    await drag(page, `[data-widget-id="${id}"] .se`, -23, -13);
    const after = await page.locator(`[data-widget-id="${id}"]`).boundingBox();
    expect(after!.width).toBe(before!.width - 23);
    expect(after!.height).toBe(before!.height - 13);
  }
  layout = await saved(page);
  // Remove init script by opening a new page in the same context for persisted reload.
  const reopened = await page.context().newPage(); await reopened.goto('/');
  expect(await saved(reopened)).toEqual(layout);
  await reopened.setViewportSize({ width: 600, height: 650 });
  for (const frame of await reopened.locator('.widget-frame').all()) {
    await expect.poll(async () => {
      const box = await frame.boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 600;
    }).toBe(true);
  }
  expect(await saved(reopened)).toEqual(layout);
  await reopened.setViewportSize({ width: 1440, height: 1000 });
  await reopened.locator('.recovery summary').click();
  await reopened.getByLabel('Elemento layout').selectOption('search');
  await reopened.getByLabel('width', { exact: true }).fill('1');
  await reopened.getByLabel('height', { exact: true }).fill('1');
  await reopened.getByRole('button', { name: 'Applica geometria' }).click();
  await expect.poll(async () => (await saved(reopened)).rects.search.width).toBe(1);
  await expect(reopened.getByRole('button', { name: 'Impostazioni', exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: 'Recupera elemento' }).click();
  await expect.poll(async () => (await saved(reopened)).rects.search.width).toBe(300);
  await reopened.close();
});
test('grid lines appear only while manipulating, chosen step snaps both operations and cancellation is transactional', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
  await page.getByRole('slider', { name: 'Dimensione griglia' }).fill('25');
  await expect.poll(async () => (await saved(page)).gridSize).toBe(25);
  await expect(page.locator('.grid-active')).toHaveCount(0);
  await drag(page, '[data-widget-id=search] .widget-handle', 38, 16, false);
  await expect(page.locator('.grid-active')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.grid-active')).toHaveCount(0);
  let layout = await saved(page);
  for (const value of Object.values(layout.rects.search) as number[]) expect(value % 25).toBe(0);
  await drag(page, '[data-widget-id=search] .se', 39, 39);
  layout = await saved(page);
  for (const value of Object.values(layout.rects.search) as number[]) expect(value % 25).toBe(0);
  await drag(page, '[data-widget-id=search] .widget-handle', 100, 100, false);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await saved(page)).toEqual(layout);
  await expect(page.locator('.home-canvas')).toBeVisible();
  await drag(page, '[data-widget-id=search] .se', -30, 30, false);
  await page.locator('[data-widget-id=search] .se').dispatchEvent('pointercancel');
  await page.mouse.up(); expect(await saved(page)).toEqual(layout);
  await page.reload(); expect(await saved(page)).toEqual(layout);
  await page.getByRole('slider', { name: 'Dimensione griglia' }).fill('0');
  await drag(page, '[data-widget-id=search] .widget-handle', 13, 7, false);
  await expect(page.locator('.grid-active')).toHaveCount(0); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).rects.search.x).toBe(layout.rects.search.x + 13);
});

test('compact edit icon sits below hide controls and slider zero means free movement', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Modifica layout', exact: true });
  const slider = page.getByRole('slider', { name: 'Dimensione griglia' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('');
  await expect(slider).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Griglia', exact: true })).toHaveCount(0);
  const hide = await page.getByRole('button', { name: 'Nascondi overlay' }).boundingBox();
  const edit = await toggle.boundingBox();
  expect(edit!.y).toBeGreaterThan(hide!.y + hide!.height);
  expect(Math.abs(edit!.x - hide!.x)).toBeLessThan(10);
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Termina modifica layout' })).toBeVisible();
  await expect(slider).toHaveValue('0');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Libero');
  const before = await page.locator('.home-canvas').boundingBox();
  await slider.fill('40');
  await expect.poll(async () => (await saved(page)).gridSize).toBe(40);
  await expect(slider).toHaveAttribute('aria-valuetext', '40 pixel');
  await page.getByRole('button', { name: 'Termina modifica layout' }).click();
  await expect(slider).toHaveCount(0);
  expect(await page.locator('.home-canvas').boundingBox()).toEqual(before);
  await page.reload();
  await toggle.click();
  await expect(slider).toHaveValue('40');
  await slider.focus();
  await slider.press('Home');
  await expect.poll(async () => (await saved(page)).grid).toBe(false);
  await expect(slider).toHaveAttribute('aria-valuetext', 'Libero');
  await page.screenshot({ path: test.info().outputPath('compact-layout-controls.png') });
});

for (const width of [1440, 600]) {
  test(`layout reaches screen top without blocking host controls at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
    const canvas = await page.locator('.home-canvas').boundingBox();
    expect(canvas!.y).toBe(0);
    expect(canvas!.height).toBe(1000);
    const logo = page.locator('[data-widget-id=logo]');
    // Drag within the previously reserved header, then release exactly at the screen edge.
    await drag(page, '[data-widget-id=logo] .widget-handle', 0, -26);
    await expect.poll(async () => (await saved(page)).rects.logo.y).toBe(0);
    expect((await logo.boundingBox())!.y).toBe(0);
    await logo.locator('.widget-handle').press('ArrowDown');
    await expect.poll(async () => (await saved(page)).rects.logo.y).toBe(1);
    await drag(page, '[data-widget-id=logo] .n', 0, -1);
    await expect.poll(async () => (await saved(page)).rects.logo.y).toBe(0);
    expect((await logo.boundingBox())!.y).toBe(0);
    await page.getByRole('slider', { name: 'Dimensione griglia' }).fill('25');
    await logo.locator('.widget-handle').press('ArrowDown');
    await expect.poll(async () => (await saved(page)).rects.logo.y).toBe(25);
    await drag(page, '[data-widget-id=logo] .widget-handle', 0, -39);
    await expect.poll(async () => (await saved(page)).rects.logo.y).toBe(0);
    await drag(page, '[data-widget-id=logo] .e', width, 0);
    expect((await logo.boundingBox())!.width).toBeGreaterThan(width - 50);
    const layout = await saved(page);
    await page.reload();
    expect(await saved(page)).toEqual(layout);
    expect((await logo.boundingBox())!.y).toBe(0);
    // The header's empty area must pass pointer input to the widget below it.
    await logo.locator('.widget-handle').click();
    const settings = page.getByRole('button', { name: 'Impostazioni', exact: true });
    await settings.click();
    await expect(page.locator('.home-canvas')).toHaveCount(0);
    await page.getByRole('button', { name: 'Torna allo spazio' }).click();
    await page.getByRole('button', { name: 'Nascondi overlay' }).click();
    await expect(page.locator('.home-shell')).toHaveCount(0);
  });
}

test('search results follow the moved and resized field and flip above at the bottom', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
  await page.getByRole('textbox', { name: 'Cerca app e azioni' }).fill('chat');
  const results = page.getByRole('region', { name: 'Risultati app e azioni' });
  const field = page.locator('.launcher-search');
  async function aligned() {
    await expect.poll(async () => {
      const a = (await field.boundingBox())!, b = (await results.boundingBox())!;
      return Math.abs(b.x - a.x) + Math.abs(b.y - a.y - a.height - 8) + Math.abs(b.width - a.width);
    }).toBeLessThan(2);
  }
  await aligned();
  await drag(page, '[data-widget-id=search] .widget-handle', -137, 51, false);
  await aligned();
  await page.mouse.up();
  await drag(page, '[data-widget-id=search] .se', -103, 18);
  await aligned();
  await page.locator('.recovery summary').click();
  await page.getByLabel('Elemento layout').selectOption('search');
  await page.getByLabel('y', { exact: true }).fill('900');
  await page.getByRole('button', { name: 'Applica geometria' }).click();
  await page.locator('.recovery summary').click();
  await expect.poll(async () => {
    const a = (await field.boundingBox())!, b = (await results.boundingBox())!;
    return Math.abs(b.y + b.height + 8 - a.y);
  }).toBeLessThan(2);
  await page.reload();
  await page.getByRole('textbox', { name: 'Cerca app e azioni' }).fill('chat');
  await expect.poll(async () => {
    const a = await field.boundingBox(), b = await results.boundingBox();
    return !!a && !!b && b.y + b.height < a.y;
  }).toBe(true);
});
