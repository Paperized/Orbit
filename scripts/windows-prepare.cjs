const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  try {
    const host = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
    const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
    assert.equal((await invoke('runtime_info')).identifier, 'dev.orbit.runtime-test');
    const apps = await invoke('list_apps');
    for (const source of await invoke('starter_packages')) {
      const manifest = JSON.parse(source).manifest;
      const installed = apps.find(app => app.manifest.id === manifest.id);
      if (!installed || installed.manifest.version !== manifest.version) {
        const preview = await invoke('preview_package', { source });
        await invoke('install_package', { source, digest: preview.digest });
      }
    }
    console.log('PASS: isolated test runtime has current starter packages');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
