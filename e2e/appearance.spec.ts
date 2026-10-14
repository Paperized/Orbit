import { test, expect } from '@playwright/test';

test('light, dark and automatic persist independently and follow system changes only in automatic mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText('Nel tuo spazio.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('tab', { name: 'Generali' }).click();
  await page.getByRole('button', { name: 'Chiaro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(240, 237, 245)');
  await expect(page.getByRole('button', { name: 'Chiaro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.app-shell').screenshot({ path: test.info().outputPath('light-settings.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.app-shell').screenshot({ path: test.info().outputPath('light-home.png') });
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('tab', { name: 'Generali' }).click();
  await page.getByRole('button', { name: 'Scuro', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Automatico', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('light theme covers floating chat and keeps the capture image unmodified', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat rapida', exact: true }).click();
  await expect(page.locator('.composer')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.locator('.app-shell').screenshot({ path: test.info().outputPath('light-chat.png') });
  await page.keyboard.press('Control+1');
  await page.getByLabel('Carica immagine').setInputFiles({
    name: 'small.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.locator('.screen-image')).toHaveCSS('filter', 'none');
  await page.getByRole('button', { name: 'Seleziona tutto' }).click();
  await expect(page.getByAltText('Anteprima selezione da inviare')).toHaveCSS('filter', 'none');
});
