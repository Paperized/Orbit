const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const host = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  try {
    const english = await invoke('get_locale') === 'en';
    const source = await invoke('get_home_layout');
    const layout = JSON.parse(source);
    assert.equal(layout.editing, false, 'Keyboard browsing requires layout editing to be off');
    const instance = layout.widgets.find(widget => widget.appId === 'orbit-capture');
    assert.ok(instance, 'A Screenshot widget must already exist; this check never modifies the layout');
    await invoke('hide_overlay');
    await expect(host.locator('.app-shell')).toHaveCount(0);
    await invoke('open_tool', { tool: 'home' });
    await expect(host.locator('[data-home-search]')).toBeFocused();
    const widget = host.locator(`[data-widget-id="${instance.id}"]`);
    const images = widget.locator('.image-preview');
    await expect(images.first()).toBeVisible();
    for (let index = 0; index < await host.locator('.widget-frame').count(); index++) {
      await host.keyboard.press('Tab');
      if (await images.first().evaluate(element => element === document.activeElement)) break;
    }
    await expect(images.first()).toBeFocused();
    await host.keyboard.press('ArrowLeft');
    await expect(images.last()).toBeFocused();
    await host.keyboard.press('ArrowRight');
    await expect(images.first()).toBeFocused();
    const index = (await images.count()) > 1 ? 1 : 0;
    await host.keyboard.press('ArrowRight');
    await expect(images.nth(index)).toBeFocused();
    const filename = await images.nth(index).locator('img').getAttribute('alt');
    await host.keyboard.press('Enter');
    const dialog = host.getByRole('dialog', { name: 'Anteprima screenshot' });
    await expect(dialog.getByRole('img', { name: filename, exact: true })).toBeVisible();
    await host.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Chiudi anteprima' })).toBeFocused();
    await host.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(images.nth(index)).toBeFocused();
    await host.keyboard.press('Tab');
    await expect(widget.locator(':focus')).toHaveCount(0);
    await host.keyboard.press('Shift+Tab');
    await expect(images.nth(index)).toBeFocused();
    if (index > 0) await host.keyboard.press('ArrowLeft');
    await expect(images.first()).toBeFocused();
    await host.keyboard.press('ArrowUp');
    await expect(widget.locator('.widget-options-button')).toBeFocused();
    await host.keyboard.press('Enter');
    const settings = host.getByRole('dialog', { name: instance.title, exact: true });
    await expect(settings).toBeVisible();
    await settings.getByLabel('Righe').focus();
    await host.keyboard.press('Tab');
    await expect(settings.getByLabel('Colonne')).toBeFocused();
    await host.keyboard.press('Escape');
    await host.getByRole('button', { name: english ? 'Settings' : 'Impostazioni', exact: true }).click();
    await expect(host.getByRole('tab', { name: english ? 'AI provider' : 'Provider AI', exact: true })).toBeVisible();
    await host.keyboard.press('Escape');
    await expect(host.locator('[data-home-search]')).toBeFocused();
    await host.getByRole('button', { name: english ? 'Settings' : 'Impostazioni', exact: true }).click();
    await host.getByRole('button', { name: english ? 'Close settings' : 'Chiudi impostazioni', exact: true }).click();
    await expect(host.locator('[data-home-search]')).toBeFocused();
    assert.equal(await invoke('get_home_layout'), source);
    console.log('PASS: native widget keyboard navigation, preview, contextual settings close via Esc/X and unchanged layout');
  } finally {
    await invoke('quit_app').catch(error => { if (!/closed|destroyed|disconnected/i.test(error.message)) throw error; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
