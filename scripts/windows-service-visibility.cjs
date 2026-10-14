const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(page => page.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  if ((await invoke('runtime_info')).identifier !== 'dev.orbit.runtime-test') {
    await browser.close();
    throw new Error('Refusing to modify a user installation');
  }
  async function appPage(id) {
    await expect.poll(() => context.pages().some(page => page.url().includes(`orbitapp.${id}`))).toBe(true);
    const page = context.pages().find(page => page.url().includes(`orbitapp.${id}`));
    await page.waitForFunction(() => typeof Orbit !== 'undefined');
    return page;
  }
  async function terminate(page) {
    const { id } = await page.evaluate(() => Orbit.context());
    await invoke('change_app', { id, action: 'close', deleteData: false });
    await expect.poll(() => page.isClosed()).toBe(true);
  }
  try {
    await expect(host.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
    for (const id of ['orbit-capture', 'orbit-chat']) {
      const existing = context.pages().find(page => page.url().includes(`orbitapp.${id}`));
      if (existing) await terminate(existing);
      const installed = (await invoke('list_apps')).find(app => app.manifest.id === id);
      if (installed) {
        await invoke('change_app', { id, action: 'disable', deleteData: false });
        await invoke('change_app', { id, action: 'uninstall', deleteData: true });
      }
      const source = (await invoke('starter_packages')).find(source => JSON.parse(source).manifest.id === id);
      const preview = await invoke('preview_package', { source });
      await invoke('install_package', { source, digest: preview.digest });
    }
    await invoke('set_app_preferences', { id: 'orbit-capture', values: { 'auto-capture': false }, reset: false });
    await invoke('launch_app', { id: 'orbit-chat' });
    const chat = await appPage('orbit-chat');
    await expect(chat.getByRole('button', { name: 'Allega cattura', exact: true })).toBeEnabled();
    async function request(existing, expectedVisible, promote = false) {
      if (await chat.getByRole('button', { name: 'Rimuovi allegato' }).isVisible()) {
        await chat.getByRole('button', { name: 'Rimuovi allegato' }).click();
      }
      await chat.getByRole('button', { name: 'Allega cattura', exact: true }).click();
      await expect(host.getByText('Seleziona un dettaglio')).toBeVisible({ timeout: 20000 });
      const provider = existing || await appPage('orbit-capture');
      assert.equal(await provider.evaluate(async () => (await Orbit.window.getState()).visible), false);
      await provider.evaluate(() => {
        const save = Orbit.attachments.save;
        Orbit.attachments.save = async reference => {
          window.savingForTest = true;
          await new Promise(resolve => { window.finishSaveForTest = resolve; });
          return save(reference);
        };
      });
      await host.mouse.move(100, 100); await host.mouse.down();
      await host.mouse.move(280, 220); await host.mouse.up();
      await provider.waitForFunction(() => window.savingForTest === true);
      assert.equal(await provider.evaluate(async () => (await Orbit.window.getState()).visible), expectedVisible,
        'Service must preserve provider visibility while saving after selection');
      if (promote) await invoke('launch_app', { id: 'orbit-capture' });
      await provider.evaluate(() => window.finishSaveForTest());
      await expect(chat.getByAltText('Immagine da inviare')).toBeVisible({ timeout: 20000 });
      if (!existing && !promote) await expect.poll(() => provider.isClosed()).toBe(true);
      else assert.equal(await provider.evaluate(async () => (await Orbit.window.getState()).visible), promote || expectedVisible);
      assert.equal(await chat.evaluate(async () => (await Orbit.window.getState()).visible), true);
      return provider;
    }
    await invoke('launch_app', { id: 'orbit-capture' });
    let provider = await appPage('orbit-capture');
    await expect(provider.getByRole('button', { name: 'Nuovo screenshot', exact: true })).toBeEnabled();
    await provider.getByRole('button', { name: 'Nascondi', exact: true }).click();
    await request(provider, false);
    await terminate(provider);
    console.log('PASS: warm hidden Screenshot remains hidden during saving and after Chat receives attachment');

    await request(null, false);
    console.log('PASS: cold service stays hidden and is destroyed after returning attachment');

    await invoke('launch_app', { id: 'orbit-capture' });
    provider = await appPage('orbit-capture');
    await expect(provider.getByRole('button', { name: 'Nuovo screenshot', exact: true })).toBeEnabled();
    await provider.evaluate(() => Orbit.window.setPinned(true));
    await provider.getByRole('button', { name: 'Nascondi', exact: true }).click();
    await request(provider, false);
    await terminate(provider);
    console.log('PASS: pin does not reveal an explicitly hidden provider');

    await invoke('launch_app', { id: 'orbit-capture' });
    provider = await appPage('orbit-capture');
    await expect(provider.getByRole('button', { name: 'Nuovo screenshot', exact: true })).toBeEnabled();
    await request(provider, true);
    await terminate(provider);
    console.log('PASS: a previously visible provider is restored normally');

    provider = await request(null, false, true);
    await terminate(provider);
    console.log('PASS: explicit launch promotes an on-demand provider and keeps it visible');

    await chat.getByRole('button', { name: 'Rimuovi allegato' }).click();
    await chat.getByRole('button', { name: 'Allega cattura', exact: true }).click();
    await expect(host.getByText('Seleziona un dettaglio')).toBeVisible({ timeout: 20000 });
    provider = await appPage('orbit-capture');
    assert.equal(await provider.evaluate(async () => (await Orbit.window.getState()).visible), false);
    await chat.evaluate(() => selecting.abort());
    await expect.poll(() => provider.isClosed()).toBe(true);
    await expect(chat.getByRole('alert')).toContainText('annullata');
    console.log('PASS: cancelling a cold request never opens the provider panel');
  } finally {
    await invoke('quit_app').catch(error => { if (!/closed|destroyed|disconnected/i.test(error.message)) throw error; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
