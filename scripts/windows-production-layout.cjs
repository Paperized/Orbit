const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(p => p.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  assert.equal((await invoke('runtime_info')).identifier, 'dev.orbit.overlay');
  const root = await invoke('data_location');
  assert.ok(root.endsWith('\\Orbit'));
  const before = readFileSync(join(root, 'host/home.json'), 'utf8');
  const errors = [];
  host.on('pageerror', e => errors.push(e.message));
  try {
    await expect(host.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
    const editing = JSON.parse(before).editing;
    const toggle = host.getByRole('button', { name: editing ? 'Termina modifica layout' : 'Modifica layout', exact: true });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('');
    const hide = await host.getByRole('button', { name: 'Nascondi overlay' }).boundingBox();
    const edit = await toggle.boundingBox();
    assert.ok(edit.y > hide.y + hide.height);
    const canvas = await host.locator('.home-canvas').boundingBox();
    assert.equal(canvas.y, 0);
    assert.equal(canvas.height, await host.evaluate(() => window.innerHeight));
    const slider = host.getByRole('slider', { name: 'Dimensione griglia' });
    await expect(slider).toHaveCount(editing ? 1 : 0);
    await expect(host.getByRole('textbox', { name: 'Cerca app e azioni' })).toHaveCount(1);
    await expect(host.locator('.home-brand')).toHaveCount(1);
    await expect(host.getByRole('button', { name: 'Impostazioni', exact: true })).toBeVisible();
    const raw = JSON.parse(before);
    if (editing) await expect(slider).toHaveValue(String(raw.grid ? raw.gridSize : 0));
    for (const widget of raw.widgets ?? []) await expect(host.locator(`[data-widget-id="${widget.id}"]`)).toBeVisible();
    await host.reload();
    await expect(host.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
    await expect(host.getByRole('textbox', { name: 'Cerca app e azioni' })).toBeVisible();
    assert.equal(readFileSync(join(root, 'host/home.json'), 'utf8'), before);
    assert.equal(context.pages().filter(p => p.url().includes('orbitapp.')).length, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: deployed release has compact edit controls below hide, conditional grid slider and preserves exact user home bytes across reload; no app windows launched');
  } finally {
    await invoke('quit_app').catch(e => { if (!/closed|destroyed|disconnected/i.test(e.message)) throw e; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
