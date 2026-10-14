// Explicitly approved release migration: install through the host, never edit user package data.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(page => page.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  try {
    assert.equal((await invoke('runtime_info')).identifier, 'dev.orbit.overlay');
    const root = await invoke('data_location');
    assert.ok(root.endsWith('\\Orbit'));
    const data = join(root, 'apps', 'data');
    const hashes = directory => {
      const result = {};
      const visit = path => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          const file = join(path, entry.name);
          if (entry.isDirectory()) visit(file);
          else if (entry.isFile()) result[file.slice(directory.length)] = createHash('sha256').update(readFileSync(file)).digest('hex');
        }
      };
      visit(directory); return result;
    };
    const beforeData = hashes(data);
    const before = await invoke('list_apps');
    const shortcuts = await invoke('list_shortcuts');
    const targets = { 'orbit-capture': '3.4.0', 'orbit-chat': '1.4.0', 'orbit-notes': '1.4.0', 'orbit-timer': '1.4.0' };
    for (const [id, version] of Object.entries(targets)) {
      const installed = before.find(app => app.manifest.id === id);
      assert.ok(installed, `Missing user package ${id}`);
      const preferences = await invoke('get_app_preferences', { id });
      await invoke('change_app', { id, action: 'close', deleteData: false });
      await expect.poll(async () => {
        for (const page of context.pages().filter(p => p.url().includes('orbitapp.'))) {
          const owner = await page.evaluate(() => Orbit.context()).catch(() => null);
          if (owner?.id === id) return true;
        }
        return false;
      }).toBe(false);
      const source = (await invoke('starter_packages')).find(source => JSON.parse(source).manifest.id === id);
      const preview = await invoke('preview_package', { source });
      assert.equal(preview.manifest.version, version);
      if (installed.manifest.version !== version) await invoke('install_package', { source, digest: preview.digest });
      const after = (await invoke('list_apps')).find(app => app.manifest.id === id);
      assert.equal(after.manifest.version, version);
      assert.equal(after.enabled, installed.enabled);
      assert.equal(after.hidden, installed.hidden);
      assert.deepEqual(await invoke('get_app_preferences', { id }), preferences);
      console.log(`UPDATED ${id} ${version}: host approval, preferences and visibility preserved`);
    }
    const currentBindings = await invoke('list_shortcuts');
    for (const binding of shortcuts.filter(binding => Object.hasOwn(targets, binding.appId ?? ''))) {
      const current = currentBindings.find(current => current.appId === binding.appId && current.actionId === binding.actionId);
      if (current && current.shortcut !== binding.shortcut) {
        await invoke('set_action_shortcut', { id: binding.appId, actionId: binding.actionId, shortcut: binding.shortcut ?? '', replace: null });
      }
    }
    const stableBindings = bindings => bindings.map(({ registered, ...binding }) => binding);
    assert.deepEqual(stableBindings(await invoke('list_shortcuts')), stableBindings(shortcuts));
    assert.deepEqual(hashes(data), beforeData);
    console.log(`VERIFIED: ${Object.keys(beforeData).length} user data files unchanged; hotkeys preserved`);
    const priorSource = await invoke('get_home_layout');
    const priorLayout = JSON.parse(priorSource ?? '{"favorites":[],"ai":false}');
    await invoke('hide_overlay');
    await expect(host.locator('.app-shell')).toHaveCount(0);
    await invoke('open_tool', { tool: 'home' });
    const capture = (await invoke('list_apps')).find(app => app.manifest.id === 'orbit-capture');
    assert.equal(await invoke('get_home_layout'), priorSource);
    const layout = JSON.parse(await invoke('get_home_layout'));
    assert.deepEqual(layout.favorites, priorLayout.favorites);
    assert.equal(layout.ai, priorLayout.ai);
    for (const widget of priorLayout.widgets ?? []) assert.deepEqual(layout.widgets.find(item => item.id === widget.id), widget);
    const instance = priorLayout.widgets?.find(widget => widget.appId === 'orbit-capture' && widget.widgetId === 'recent-captures');
    if (capture.enabled && instance) {
      const widget = host.getByRole('region', { name: 'Ultimi screenshot', exact: true });
      await expect(widget.locator('.widget-actions')).toHaveCount(0);
      const grid = instance.settings ?? capture.manifest.widgets[0].grid;
      const limit = grid.rows * grid.columns;
      const content = await invoke('get_widget_data', { appId: 'orbit-capture', widgetId: 'recent-captures', limit });
      await expect(widget.locator('img')).toHaveCount(content.entries.length);
      assert.ok(content.entries.length <= limit);
      await widget.getByRole('button', { name: 'Impostazioni Ultimi screenshot' }).click();
      const dialog = host.getByRole('dialog', { name: 'Ultimi screenshot' });
      await expect(dialog.getByLabel('Righe')).toHaveValue(String(grid.rows));
      await expect(dialog.getByLabel('Colonne')).toHaveValue(String(grid.columns));
      await host.keyboard.press('Escape');
      assert.equal(await invoke('get_home_layout'), priorSource);
      await host.screenshot({ path: join(__dirname, 'widgets-production.png') });
      console.log(`VERIFIED: production home widget renders ${content.entries.length} actual previews; previous home layout retained`);
    }
    assert.deepEqual(hashes(data), beforeData);
    await expect(host.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
    const search = host.getByRole('textbox', { name: 'Cerca app e azioni' });
    await search.fill('Screenshot');
    const results = host.getByRole('region', { name: 'Risultati app e azioni' });
    await expect(results).toBeVisible();
    await expect.poll(async () => {
      const field = await host.locator('.launcher-search').boundingBox();
      const panel = await results.boundingBox();
      return Math.min(Math.abs(panel.y - field.y - field.height - 8), Math.abs(panel.y + panel.height + 8 - field.y));
    }).toBeLessThan(2);
    await search.press('Escape');
    await expect(results).toHaveCount(0);
    assert.equal(await invoke('get_home_layout'), priorSource);
    console.log('VERIFIED: search results anchor to the actual user-positioned search field; layout bytes unchanged');
  } finally {
    await invoke('quit_app').catch(error => { if (!/closed|destroyed|disconnected/i.test(error.message)) throw error; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
