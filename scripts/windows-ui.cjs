const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(page => page.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  assert.equal((await invoke('runtime_info')).identifier, 'dev.orbit.runtime-test');
  const errors = [];
  try {
    for (const source of await invoke('starter_packages')) {
      const manifest = JSON.parse(source).manifest;
      const installed = (await invoke('list_apps')).find(app => app.manifest.id === manifest.id);
      if (installed?.manifest.version !== manifest.version) {
        if (installed) await invoke('change_app', { id: manifest.id, action: 'close', deleteData: false });
        const preview = await invoke('preview_package', { source });
        await invoke('install_package', { source, digest: preview.digest });
      }
    }
    for (const id of ['orbit-capture', 'orbit-chat', 'orbit-notes', 'orbit-timer']) {
      await invoke('set_locale', { locale: 'en' });
      await invoke('launch_app', { id });
      await expect.poll(() => context.pages().some(page => page.url().includes(`orbitapp.${id}`))).toBe(true);
      const page = context.pages().find(page => page.url().includes(`orbitapp.${id}`));
      page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof Orbit !== 'undefined');
      assert.equal(await page.evaluate(() => Orbit.locale.get()), 'en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      if (id === 'orbit-chat') await expect(page.locator('#new')).toHaveText('New chat');
      if (id === 'orbit-capture') await expect(page.locator('#capture')).toHaveText('New screenshot');
      if (id === 'orbit-notes') await expect(page.locator('#drag')).toHaveText('Notes');
      if (id === 'orbit-timer') await expect(page.locator('#form .primary')).toHaveText('Start');
      await page.evaluate(() => { window.localeChanges = []; Orbit.locale.onChange(value => window.localeChanges.push(value)); });
      await invoke('set_locale', { locale: 'it' });
      await expect(page.locator('html')).toHaveAttribute('lang', 'it');
      assert.deepEqual(await page.evaluate(() => window.localeChanges), ['it']);
      await assert.rejects(page.evaluate(() => window.__TAURI_INTERNALS__.invoke('set_locale', { locale: 'en' })), /denied|not allowed|autorizzat/i);
      await page.setViewportSize({ width: 360, height: 600 });
      for (const mode of ['dark', 'light']) {
        await invoke('set_theme', { mode });
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        await expect(page.locator('#close')).toBeVisible();
        await expect(page.locator('#hide')).toBeVisible();
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.body.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.width, `${id} horizontal overflow`);
        await page.locator('#close').focus();
        await expect(page.locator('#close')).toHaveCSS('outline-style', 'solid');
        await page.screenshot({ path: join(__dirname, `${id}-${mode}.png`) });
      }
      await invoke('change_app', { id, action: 'close', deleteData: false });
      console.log(`PASS: ${id} dark/light, keyboard focus, readable controls and narrow-window layout`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await invoke('quit_app').catch(error => { if (!/closed|destroyed|disconnected/i.test(error.message)) throw error; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
