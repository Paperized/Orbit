import { test, expect } from '@playwright/test';

test('preview search supports repeated down and up arrows', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Cerca app e azioni' });
  await search.press('ArrowDown');
  const results = page.locator('.results-list .result-run');
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(results.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(results.nth(1)).toBeFocused();
});

test('closing settings restores the originating tool and explicit navigation clears the return context', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Appunti al volo', exact: true }).click();
  const notes = page.getByRole('textbox', { name: 'Appunti', exact: true });
  await expect(notes).toBeVisible();
  await notes.fill('Il mio contesto');
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Provider AI' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notes).toBeVisible();
  await expect(notes).toHaveValue('Il mio contesto');
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('button', { name: 'Torna allo spazio', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Cerca app e azioni' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveCount(0);
});

test('dashboard, exact hotkeys, settings and persistent notes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Cerca app e azioni' })).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('textbox', { name: 'Cerca app e azioni' })).toBeHidden();
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('textbox', { name: 'Cerca app e azioni' })).toBeVisible();
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('button', { name: /Compatibile OpenAI/ }).click();
  await expect(page.getByRole('textbox', { name: 'Base URL' })).toBeVisible();
  await page.getByRole('tab', { name: 'Backend agent' }).click();
  await expect(page.getByText('Non esegue ancora task agentici.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Appunti al volo', exact: true }).click();
  await page.getByRole('textbox', { name: 'Appunti', exact: true }).fill('Un pensiero da ritrovare.');
  await expect(page.getByText('Salvato sul dispositivo')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Appunti al volo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Appunti', exact: true })).toHaveValue('Un pensiero da ritrovare.');
  expect(errors).toEqual([]);
});

test('capture selection opens chat with only the cropped image', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('heading', { name: /Una schermata/ })).toBeVisible();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000; canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#304060'; context.fillRect(0, 0, 1000, 600);
    context.fillStyle = '#fff'; context.font = '30px sans-serif'; context.fillText('Hello Orbit', 150, 150);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Carica immagine').setInputFiles({
    name: 'screenshot.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByText('Seleziona un dettaglio')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usa selezione' })).toHaveCount(0);
  await page.mouse.move(100, 100); await page.mouse.down();
  await page.mouse.move(500, 400);
  await expect(page.getByAltText('Anteprima selezione da inviare')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: 'Parliamo di questa schermata.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Strumenti' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apri dashboard' })).toBeVisible();
  const preview = page.getByAltText('Anteprima selezione da inviare');
  await expect(preview).toBeVisible();
  const size = await preview.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  expect(size).toEqual({ width: 279, height: 180 });
  await page.getByRole('textbox', { name: 'Messaggio', exact: true }).fill('Spiegami questo testo');
  await expect(page.getByRole('button', { name: 'Invia messaggio' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Messaggio', exact: true })).toBeHidden();
  await page.keyboard.press('Control+e');
  await page.getByRole('button', { name: 'Chat rapida', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Messaggio', exact: true })).toHaveValue('Spiegami questo testo');
  await expect(page.getByAltText('Anteprima selezione da inviare')).toBeVisible();
});

test('keyboard users can select a full image without upscaling', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+1');
  await page.getByLabel('Carica immagine').setInputFiles({
    name: 'small.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByRole('button', { name: 'Usa selezione' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Seleziona tutto' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('1 x 1 px', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Rimuovi immagine' }).click();
  await expect(page.getByAltText('Anteprima selezione da inviare')).toHaveCount(0);
});

test('clicks and tiny selections stay in capture; a reverse drag confirms on release', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+1');
  await page.getByLabel('Carica immagine').setInputFiles({
    name: 'small.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByText('Seleziona un dettaglio')).toBeVisible();
  await page.mouse.click(100, 100);
  await expect(page.getByAltText('Anteprima selezione da inviare')).toHaveCount(0);
  await page.mouse.move(100, 100); await page.mouse.down();
  await page.mouse.move(104, 104); await page.mouse.up();
  await expect(page.getByText('Seleziona un dettaglio')).toBeVisible();
  await expect(page.getByAltText('Anteprima selezione da inviare')).toHaveCount(0);
  await page.mouse.move(500, 400); await page.mouse.down();
  await page.mouse.move(100, 100); await page.mouse.up();
  await expect(page.getByAltText('Anteprima selezione da inviare')).toBeVisible();
  await expect(page.getByText('1 x 1 px', { exact: false })).toBeVisible();
});

test('invalid images are rejected and capture can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+1');
  await page.getByLabel('Carica immagine').setInputFiles({
    name: 'not-image.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toContainText('PNG, JPEG o WebP');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Orbit AI overlay' })).toHaveCount(0);
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('textbox', { name: 'Cerca app e azioni' })).toBeVisible();
});

test('small screens retain accessible navigation and focus stays in overlay', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 760 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Provider AI' })).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.app-shell'))).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('floating tools are compact, draggable and do not block the page outside them', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const background = document.querySelector('.preview-desktop')!;
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'App sottostante');
    input.style.cssText = 'position:absolute;left:30px;top:30px;z-index:2;width:180px';
    background.append(input);
  });
  await page.getByRole('button', { name: 'Chat rapida', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Orbit AI overlay' });
  const before = await panel.boundingBox();
  expect(before?.width).toBe(440);
  expect(before?.height).toBe(520);
  expect(await page.locator('.tool-mode').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const background = page.getByRole('textbox', { name: 'App sottostante' });
  await background.click();
  await page.keyboard.type('Sotto');
  const message = page.getByRole('textbox', { name: 'Messaggio', exact: true });
  await message.click();
  await page.keyboard.type('Solo Orbit');
  await expect(message).toHaveValue('Solo Orbit');
  await expect(background).toHaveValue('Sotto');
  const handle = await page.getByRole('button', { name: 'Sposta pannello' }).boundingBox();
  if (!handle || !before) throw new Error('Panel drag handle missing');
  await page.mouse.move(handle.x + 40, handle.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle.x - 80, handle.y + 60);
  await page.mouse.up();
  const after = await panel.boundingBox();
  expect(after?.x).toBe(before.x - 120);
  expect(after?.y).toBe(before.y + 40);
  await expect(message).toHaveValue('Solo Orbit');
  await panel.evaluate(element => {
    element.style.width = '340px';
    element.style.height = '300px';
  });
  const minimum = await panel.boundingBox();
  const send = await page.getByRole('button', { name: 'Invia messaggio' }).boundingBox();
  if (!minimum || !send) throw new Error('Minimum panel controls missing');
  expect(send.y + send.height).toBeLessThanOrEqual(minimum.y + minimum.height);
  expect(send.x + send.width).toBeLessThanOrEqual(minimum.x + minimum.width);
  await expect(message).toBeVisible();
  await panel.evaluate(element => {
    element.style.width = '';
    element.style.height = '';
  });
  await page.getByRole('button', { name: 'Apri dashboard' }).click();
  expect(await page.locator('.overlay').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('auto');
});
