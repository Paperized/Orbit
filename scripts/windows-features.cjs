const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(page => page.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  assert.equal((await invoke('runtime_info')).identifier, 'dev.orbit.runtime-test', 'Never modify production');
  const pageFor = async id => {
    await expect.poll(() => context.pages().some(p => p.url().includes(`orbitapp.${id}`))).toBe(true);
    const page = context.pages().find(p => p.url().includes(`orbitapp.${id}`));
    await page.waitForFunction(() => typeof Orbit !== 'undefined');
    return page;
  };
  const features = () => context.pages().filter(p => p.url().includes('orbitapp.feature-'));
  const install = async packageValue => {
    const source = JSON.stringify(packageValue);
    const preview = await invoke('preview_package', { source });
    return invoke('install_package', { source, digest: preview.digest });
  };
  try {
    if ((await invoke('list_apps')).some(app => app.manifest.id === 'test-feature')) {
      await invoke('change_app', { id: 'test-feature', action: 'close', deleteData: false });
      await expect.poll(() => features().length).toBe(0);
      await invoke('change_app', { id: 'test-feature', action: 'uninstall', deleteData: true });
    }
    for (const id of ['orbit-chat', 'orbit-capture']) {
      await invoke('change_app', { id, action: 'close', deleteData: false });
      await expect.poll(() => context.pages().some(p => p.url().includes(`orbitapp.${id}`))).toBe(false);
    }
    await invoke('launch_app', { id: 'orbit-capture' });
    const capture = await pageFor('orbit-capture');
    await expect(capture.getByRole('button', { name: 'Nuovo screenshot', exact: true })).toBeEnabled();
    // Generate a non-private fixture entirely inside the isolated webview.
    await capture.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      window.fixture = await Orbit.attachments.create({ dataUrl: canvas.toDataURL('image/png'), width: 2, height: 2 });
    });
    const ref = await capture.evaluate(() => window.fixture);
    await assert.rejects(capture.evaluate(() => Orbit.services.call({ contract: 'image.receive', provider: 'orbit-chat', input: { image: window.fixture }, intent: 'service' })), /Intento non supportato/);
    await assert.rejects(capture.evaluate(() => window.__TAURI_INTERNALS__.invoke('app_request', { action: 'services.call', args: {
      requestId: crypto.randomUUID(), contract: 'image.receive', version: 1, provider: 'orbit-chat', actionId: 'receive-image', input: { image: window.fixture }, intent: 'app',
    } })), /non validi/);
    assert.equal(features().length, 0);
    const callChat = prompt => capture.evaluate(prompt => Orbit.services.call({
      contract: 'image.receive', provider: 'orbit-chat', actionId: 'receive-image', intent: 'interactive', input: { image: window.fixture, prompt },
    }), prompt);
    await callChat('cold feature');
    const cold = features()[0];
    await expect(cold.getByRole('textbox', { name: 'Messaggio' })).toHaveValue('cold feature');
    assert.equal(context.pages().some(p => p.url().includes('orbitapp.orbit-chat')), false);
    await expect(cold.locator('#sessions, #new, #capture')).toHaveCount(0);
    await invoke('launch_app', { id: 'orbit-chat' });
    const chat = await pageFor('orbit-chat');
    await chat.getByRole('textbox', { name: 'Messaggio' }).fill('main untouched');
    await chat.evaluate(() => { localStorage.setItem('isolation-fixture', 'main'); });
    await callChat('second feature');
    const second = features().find(p => p !== cold);
    await expect(second.getByRole('textbox', { name: 'Messaggio' })).toHaveValue('second feature');
    await expect(chat.getByRole('textbox', { name: 'Messaggio' })).toHaveValue('main untouched');
    await expect(chat.locator('#sessions option')).toHaveCount(1);
    assert.equal(await second.evaluate(() => localStorage.getItem('isolation-fixture')), null);
    await assert.rejects(chat.evaluate(ref => Orbit.attachments.read(ref), ref));
    await assert.rejects(second.evaluate(ref => Orbit.attachments.read(ref), ref));
    await assert.rejects(second.evaluate(() => Orbit.preferences.update({ 'send-on-enter': false })), /riservata/);
    await assert.rejects(second.evaluate(() => Orbit.actions.register({ capture() {}, 'new-chat'() {} })), /riservata/);
    await assert.rejects(second.evaluate(() => window.__TAURI_INTERNALS__.invoke('launch_app', { id: 'orbit-chat' })));
    await assert.rejects(install(JSON.parse((await invoke('starter_packages')).find(s => JSON.parse(s).manifest.id === 'orbit-chat'))), /Termina/);
    await second.evaluate(() => Orbit.window.setPinned(true));
    assert.equal((await cold.evaluate(() => Orbit.window.getState())).pinned, false);
    assert.equal((await chat.evaluate(() => Orbit.window.getState())).pinned, false);
    await second.keyboard.press('Escape');
    assert.equal(second.isClosed(), false);
    await cold.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect.poll(() => cold.isClosed()).toBe(true);
    assert.equal(second.isClosed(), false);
    assert.equal(chat.isClosed(), false);
    await second.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect.poll(() => second.isClosed()).toBe(true);
    console.log('PASS: cold/warm scoped UI, no workspace mutation, separate origins/grants/pins, explicit launch and close');

    const providerId = 'test-feature';
    const exportValue = id => ({ id, title: id, description: 'Fixture', contract: 'image.receive', version: 1, accepts: ['image/png'], invocationModes: ['interactive'], interactiveEntry: 'feature.html' });
    const html = '<!doctype html><script src="/orbit-sdk.js"></script><script src="feature.js" defer></script><p>Isolated fixture</p>';
    await install({
      manifest: { id: providerId, name: 'Feature fixture', description: 'Invocation lifecycle fixture', version: '1.0.0', sdk: 1, entry: 'index.html', icon: 'chat', permissions: ['app-actions', 'storage', 'files-read', 'files-write', 'timers'], exports: [exportValue('receive'), exportValue('other')] },
      files: {
        'index.html': Buffer.from('<!doctype html><p>Full app</p>').toString('base64'),
        'feature.html': Buffer.from(html).toString('base64'),
        'feature.js': Buffer.from(`(async () => {
          window.featureContext = await Orbit.context();
          window.registrationRejected = await window.__TAURI_INTERNALS__.invoke('app_request', { action: 'services.register', args: ['receive', 'other'] }).then(() => false, () => true);
          await Orbit.services.register({ [featureContext.invocation.actionId]: async (input, context) => {
            window.reference = input.image;
            await Orbit.attachments.retain(input.image);
            if (input.prompt === 'fail') throw new Error('Fixture failed');
            if (input.prompt === 'wait') {
              window.waiting = true;
              await new Promise(resolve => { window.finish = resolve; context.signal.addEventListener('abort', resolve); });
            }
            return { accepted: true };
          } });
        })();`).toString('base64'),
      },
    });
    await capture.evaluate(() => {
      window.pending = Orbit.services.call({ contract: 'image.receive', provider: 'test-feature', actionId: 'receive', intent: 'interactive', input: { image: window.fixture, prompt: 'wait' } }).then(() => 'ok', String);
    });
    await expect.poll(() => features().length).toBe(1);
    const waiting = features()[0];
    await waiting.waitForFunction(() => window.waiting);
    assert.equal((await waiting.evaluate(() => Orbit.window.getState())).visible, true, 'Interactive UI must be usable before the handler returns');
    const invocation = await waiting.evaluate(() => window.featureContext.invocation);
    await capture.evaluate(() => { window.other = Orbit.services.call({ contract: 'image.receive', provider: 'test-feature', actionId: 'other', intent: 'interactive', input: { image: window.fixture } }); });
    await capture.evaluate(() => window.other);
    const other = features().find(p => p !== waiting);
    assert.equal(await other.evaluate(() => window.registrationRejected), true);
    const featureUrl = other.url();
    await other.evaluate(() => { location.href = '/index.html'; });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(other.url(), featureUrl);
    assert.ok((await other.evaluate(ref => Orbit.attachments.read(ref), ref)).dataUrl);
    await assert.rejects(other.evaluate(requestId => window.__TAURI_INTERNALS__.invoke('app_request', { action: 'services.respond', args: { requestId, output: { accepted: true }, error: null } }), invocation.requestId), /non autorizzata/);
    await assert.rejects(other.evaluate(requestId => window.__TAURI_INTERNALS__.invoke('app_request', { action: 'services.cancel', args: { requestId } }), invocation.requestId), /non autorizzata/);
    await assert.rejects(other.evaluate(() => Orbit.storage.read()), /riservata/);
    await assert.rejects(other.evaluate(() => Orbit.files.list()), /riservata/);
    await assert.rejects(other.evaluate(() => Orbit.timers.list()), /riservata/);
    await capture.evaluate(requestId => window.__TAURI_INTERNALS__.invoke('app_request', { action: 'services.cancel', args: { requestId } }), invocation.requestId);
    assert.match(await capture.evaluate(() => window.pending), /annullata/);
    await expect.poll(() => waiting.isClosed()).toBe(true);
    assert.ok((await other.evaluate(ref => Orbit.attachments.read(ref), ref)).dataUrl);
    await other.evaluate(() => Orbit.attachments.release(window.reference));
    await assert.rejects(other.evaluate(ref => Orbit.attachments.read(ref), ref));
    await other.evaluate(() => { void Orbit.window.close(); }).catch(error => { if (!/closed/i.test(error.message)) throw error; });
    await expect.poll(() => other.isClosed()).toBe(true);
    await assert.rejects(capture.evaluate(() => Orbit.services.call({ contract: 'image.receive', provider: 'test-feature', actionId: 'receive', intent: 'interactive', input: { image: window.fixture, prompt: 'fail' } })), /Fixture failed/);
    await expect.poll(() => features().length).toBe(0);
    await capture.evaluate(() => {
      window.pending = Orbit.services.call({ contract: 'image.receive', provider: 'test-feature', actionId: 'receive', intent: 'interactive', input: { image: window.fixture, prompt: 'wait' } }).then(() => 'ok', String);
    });
    await expect.poll(() => features().length).toBe(1);
    const closing = features()[0];
    await closing.waitForFunction(() => window.waiting);
    await closing.evaluate(() => { void Orbit.window.close(); }).catch(error => { if (!/closed/i.test(error.message)) throw error; });
    assert.match(await capture.evaluate(() => window.pending), /chiusa/);
    await expect.poll(() => features().length).toBe(0);
    await invoke('change_app', { id: providerId, action: 'uninstall', deleteData: true });
    await capture.evaluate(() => Orbit.attachments.release(window.fixture));
    await chat.evaluate(() => localStorage.removeItem('isolation-fixture'));
    console.log('PASS: pending interactive cancellation, per-window response/cancel authority, retained grant isolation and restricted resources');
  } finally {
    await invoke('quit_app').catch(error => { if (!/closed|destroyed|disconnected/i.test(error.message)) throw error; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
