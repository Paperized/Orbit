const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

(async () => {
  const requests = [];
  const tls = { key: readFileSync(join(__dirname, 'network-key.pem')), cert: readFileSync(join(__dirname, 'network-cert.pem')) };
  const server = https.createServer(tls, (req, res) => {
    requests.push(req.url);
    if (req.url !== '/no-cors') res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/redirect') { res.writeHead(302, { Location: `https://denied.orbit-network.test:${server.address().port}/target` }); res.end(); }
    else if (req.url === '/code.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('window.remoteExecuted=true;'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true })); }
  });
  server.on('upgrade', (req, socket) => {
    requests.push('/websocket');
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', () => socket.end(Buffer.from([0x88, 0x00])));
    socket.on('error', error => { if (error.code !== 'ECONNRESET') console.error(error); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(page => page.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  if ((await invoke('runtime_info')).identifier !== 'dev.orbit.runtime-test') {
    await browser.close(); server.close(); throw new Error('Refusing production installation');
  }
  const origin = `https://api.orbit-network.test:${server.address().port}`;
  const ws = `wss://api.orbit-network.test:${server.address().port}`;
  const id = 'network-fixture';
  const source = version => JSON.stringify({
    manifest: { id, name: 'Network fixture', description: 'Isolated network regression', version, sdk: 1, entry: 'index.html', permissions: [],
      network: { connect: version === '1.0.0' ? [origin, ws] : [] } },
    files: { 'index.html': Buffer.from('<!doctype html><script src="/orbit-sdk.js"></script><p>Network fixture</p>').toString('base64') },
  });
  let fixture;
  try {
    await expect(host.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
    const installed = (await invoke('list_apps')).find(app => app.manifest.id === id);
    if (installed) await invoke('change_app', { id, action: 'uninstall', deleteData: true });
    const text = source('1.0.0');
    const preview = await invoke('preview_package', { source: text });
    assert.deepEqual(preview.manifest.network.connect, [origin, ws]);
    await invoke('install_package', { source: text, digest: preview.digest });
    await invoke('launch_app', { id });
    await expect.poll(() => context.pages().some(page => page.url().includes(`orbitapp.${id}`))).toBe(true);
    fixture = context.pages().find(page => page.url().includes(`orbitapp.${id}`));
    await fixture.waitForFunction(() => typeof Orbit !== 'undefined');
    assert.deepEqual(await fixture.evaluate(async url => (await fetch(url + '/json')).json(), origin), { ok: true });
    assert.equal(await fixture.evaluate(url => new Promise((resolve, reject) => {
      const socket = new WebSocket(url); socket.onopen = () => { socket.close(); resolve(true); }; socket.onerror = () => reject(new Error('WebSocket failed'));
    }), ws), true);
    console.log('PASS: native fetch and WebSocket reach declared TLS origins without an SDK network wrapper');
    await assert.rejects(fixture.evaluate(url => fetch(url + '/no-cors'), origin));
    const before = requests.length;
    await assert.rejects(fixture.evaluate(url => fetch(url), `https://denied.orbit-network.test:${server.address().port}/denied`));
    await assert.rejects(fixture.evaluate(url => fetch(url), `https://127.0.0.1:${server.address().port}/loopback`));
    assert.equal(requests.length, before);
    await assert.rejects(fixture.evaluate(url => fetch(url + '/redirect'), origin));
    assert.ok(!requests.includes('/target'));
    assert.equal(await fixture.evaluate(url => new Promise(resolve => {
      const script = document.createElement('script'); script.src = url + '/code.js';
      script.onload = () => resolve(false); script.onerror = () => resolve(true); document.head.append(script);
    }), origin), true);
    assert.equal(await fixture.evaluate(() => window.remoteExecuted), undefined);
    assert.ok(!requests.includes('/code.js'));
    await assert.rejects(fixture.evaluate(async url => {
      const code = await (await fetch(url + '/code.js')).text(); (0, eval)(code);
    }, origin));
    await assert.rejects(fixture.evaluate(() => window.__TAURI_INTERNALS__.invoke('check_agent', { executable: 'anything' })));
    await assert.rejects(fixture.evaluate(() => Orbit.files.write('../escape.txt', 'aGk=')));
    console.log('PASS: CORS, undeclared origins, redirect escape, remote scripts, eval, processes and unauthorized file writes stay blocked');
    await invoke('change_app', { id, action: 'close', deleteData: false });
    await expect.poll(() => fixture.isClosed()).toBe(true);
    const update = source('1.1.0');
    const next = await invoke('preview_package', { source: update });
    await invoke('install_package', { source: update, digest: next.digest });
    await assert.rejects(invoke('change_app', { id, action: 'rollback', deleteData: false }), /permessi/);
    await invoke('launch_app', { id });
    await expect.poll(() => context.pages().some(page => page.url().includes(`orbitapp.${id}`))).toBe(true);
    fixture = context.pages().find(page => page.url().includes(`orbitapp.${id}`));
    await fixture.waitForFunction(() => typeof Orbit !== 'undefined');
    const previous = requests.length;
    await assert.rejects(fixture.evaluate(url => fetch(url + '/revoked'), origin));
    assert.equal(requests.length, previous);
    console.log('PASS: removing network permissions takes effect and rollback cannot silently restore them');
  } catch (error) {
    console.error('Network regression failure:', error);
    throw error;
  } finally {
    try {
    if (fixture && !fixture.isClosed()) {
      await invoke('change_app', { id, action: 'close', deleteData: false });
      await expect.poll(() => fixture.isClosed()).toBe(true);
    }
    if ((await invoke('list_apps')).some(app => app.manifest.id === id)) await invoke('change_app', { id, action: 'uninstall', deleteData: true });
    await invoke('quit_app').catch(error => { if (!/closed|destroyed|disconnected/i.test(error.message)) throw error; });
    } finally {
      await browser.close(); server.close(); server.closeAllConnections();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
