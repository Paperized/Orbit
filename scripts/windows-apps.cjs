const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, readdirSync, unlinkSync, symlinkSync, rmdirSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(page => page.url().includes('tauri.localhost'));
  assert.ok(host);
  const invoke = (command, args = {}) => host.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  const environment = await invoke('runtime_info');
  if (environment.identifier !== 'dev.orbit.runtime-test') {
    await browser.close();
    throw new Error('Refusing to modify a user installation: build with identifier dev.orbit.runtime-test');
  }
  const dataRoot = await invoke('data_location');
  assert.ok(dataRoot.endsWith('Orbit-dev.orbit.runtime-test'));
  async function reloadHost() {
    await host.reload();
    await expect(host.locator('.app-shell')).toHaveAttribute('aria-busy','false');
  }
  const errors = [];
  const watch = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') console.log('WebView console:', message.text());
    });
  };
  watch(host);
  context.on('page', watch);
  async function appPage(id) {
    await expect.poll(() => context.pages().some(page => page.url().includes(`orbitapp.${id}`)), { timeout: 20000 }).toBe(true);
    const page = context.pages().find(page => page.url().includes(`orbitapp.${id}`));
    await page.waitForFunction(() => typeof Orbit !== 'undefined', undefined, { timeout: 20000 });
    return page;
  }
  async function checkWebviewMenu(page) {
    assert.equal(await page.evaluate(() => document.body.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles:true,cancelable:true }),
    )), false);
    assert.equal(await page.evaluate(() => window.dispatchEvent(
      new KeyboardEvent('keydown', { key:'F12',cancelable:true }),
    )), false);
  }
  async function recordShortcut(input, keys) {
    await input.click();
    await expect(input).toHaveAttribute('data-recording','ready');
    await input.press(keys);
  }
  async function terminate(page) {
    const { id } = await page.evaluate(() => Orbit.context());
    await invoke('change_app', { id,action:'close',deleteData:false });
    await expect.poll(() => page.isClosed()).toBe(true);
  }
  const requests = [];
  const tray = (commandId = 0) => JSON.parse(execFileSync('powershell.exe', [
    '-NoProfile','-NonInteractive','-File',join(__dirname,'windows-tray.ps1'),'-CommandId',String(commandId),
  ], { windowsHide:true,encoding:'utf8',timeout:20000 }));
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const data of req) body += data;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"Risposta pacchetto verificata"}}]}\n\ndata: [DONE]\n\n');
  });
  try {
    // Reset only the dedicated test installation so this suite is repeatable.
    for (const app of (await invoke('list_apps')).sort((a,b) => Number(b.manifest.id === 'test-consumer') - Number(a.manifest.id === 'test-consumer'))) {
      assert.ok(['orbit-capture','orbit-chat','orbit-notes','orbit-timer','local-counter','test-provider','test-consumer'].includes(app.manifest.id));
      await invoke('change_app', { id:app.manifest.id,action:'close',deleteData:false });
      await expect.poll(() => context.pages().some(page => page.url().includes(`orbitapp.${app.manifest.id}`))).toBe(false);
      await invoke('change_app', { id:app.manifest.id,action:'disable',deleteData:false });
    }
    for (const app of await invoke('list_apps')) {
      await invoke('change_app', { id:app.manifest.id,action:'uninstall',deleteData:true });
    }
    for (const source of await invoke('starter_packages')) {
      const preview = await invoke('preview_package', { source });
      await invoke('install_package', { source, digest:preview.digest });
    }
    const installed = await invoke('list_apps');
    assert.equal(installed.length, 4);
    assert.deepEqual(installed.map(app => app.manifest.id).sort(), ['orbit-capture','orbit-chat','orbit-notes','orbit-timer']);
    console.log('PASS: four independently installed starter packages');
    const defaults = await invoke('list_shortcuts');
    for (const app of installed) {
      assert.equal(defaults.find(binding => binding.appId===app.manifest.id && binding.actionId==='open').shortcut,app.manifest.shortcut);
      for (const action of app.manifest.actions) {
        assert.ok(action.shortcut);
        assert.equal(defaults.find(binding => binding.appId===app.manifest.id && binding.actionId===action.id).shortcut,action.shortcut);
      }
      const preferences = await invoke('get_app_preferences',{ id:app.manifest.id });
      for (const preference of app.manifest.preferences) assert.equal(preferences[preference.id],preference.default);
    }
    await invoke('set_action_shortcut',{ id:'orbit-notes',actionId:'open',shortcut:'',replace:null });
    await invoke('set_action_shortcut',{ id:'orbit-notes',actionId:'focus-editor',shortcut:'',replace:null });
    await invoke('open_tool',{ tool:'settings' });
    await host.getByRole('button',{ name:'Torna allo spazio',exact:true }).click();
    await expect(host.locator('.sidebar')).toHaveCount(0);
    await host.getByRole('navigation',{ name:'Avvio rapido app' }).getByRole('button',{ name:'Apri Appunti',exact:true }).click();
    let launcherNotes = await appPage('orbit-notes');
    await expect(launcherNotes.getByRole('textbox',{ name:'Appunti',exact:true })).toBeEnabled();
    await terminate(launcherNotes);
    await invoke('open_tool',{ tool:'home' });
    const homeSearch = host.getByRole('textbox',{ name:'Cerca app e azioni' });
    await homeSearch.fill('Scrivi un appunto');
    const homeResults = host.getByRole('region',{ name:'Risultati app e azioni' });
    await expect(homeResults.getByRole('button',{ name:'Esegui Scrivi un appunto',exact:true })).toBeEnabled();
    await expect(homeResults.locator('kbd')).toHaveCount(0);
    await homeResults.getByRole('button',{ name:'Aggiungi Scrivi un appunto ai preferiti',exact:true }).click();
    assert.ok(!context.pages().some(page=>page.url().includes('orbitapp.orbit-notes')));
    await homeSearch.press('Escape');
    const homeFavorites = host.getByRole('region',{ name:'Preferiti',exact:true });
    await homeFavorites.getByRole('button',{ name:'Esegui Scrivi un appunto',exact:true }).click();
    launcherNotes = await appPage('orbit-notes');
    await expect(launcherNotes.getByRole('textbox',{ name:'Appunti',exact:true })).toBeFocused();
    await terminate(launcherNotes);
    await invoke('open_tool',{ tool:'home' });
    await host.locator('.widget-picker summary').click();
    await expect(host.getByRole('checkbox',{ name:'Orologio',exact:true })).toHaveCount(0);
    await expect(host.getByLabel('Ora corrente')).toBeVisible();
    await host.getByRole('checkbox',{ name:'Modello AI',exact:true }).check();
    await host.keyboard.press('Escape');
    await reloadHost();
    await expect(homeFavorites.getByRole('button',{ name:'Esegui Scrivi un appunto',exact:true })).toBeVisible();
    await expect(host.getByRole('region',{ name:'Orologio',exact:true })).toHaveCount(0);
    await expect(host.getByRole('region',{ name:'Modello AI',exact:true })).toBeVisible();
    await host.getByRole('button',{ name:'Impostazioni',exact:true }).click();
    await expect(host.getByRole('navigation',{ name:'Impostazioni delle app',exact:true })).toBeVisible();
    await host.getByRole('button',{ name:'Torna allo spazio',exact:true }).click();
    await expect(homeSearch).toBeVisible();
    await invoke('save_home_layout',{ source:JSON.stringify({ version:1,favorites:[],clock:false,ai:false }) });
    await invoke('change_app',{ id:'orbit-notes',action:'disable',deleteData:false });
    await invoke('set_action_shortcut',{ id:'orbit-notes',actionId:'open',shortcut:'Ctrl+3',replace:null });
    await invoke('set_action_shortcut',{ id:'orbit-notes',actionId:'focus-editor',shortcut:'Ctrl+Shift+3',replace:null });
    await invoke('change_app',{ id:'orbit-notes',action:'enable',deleteData:false });
    await reloadHost();
    console.log('PASS: sparse home, real app/action clicks without hotkeys, persisted stars/widgets and settings round trip');
    let trayItems = tray();
    assert.deepEqual(trayItems.filter(item => item.children.length).map(item => item.text).sort(),['Appunti','Chat','Screenshot','Timer']);
    assert.ok(trayItems.find(item=>item.text==='Chat').children.some(item=>item.text==='Apri (Ctrl+2)'));
    const notesOpen = trayItems.find(item=>item.text==='Appunti').children.find(item=>item.text==='Apri (Ctrl+3)');
    tray(notesOpen.id);
    await checkWebviewMenu(host);
    let notes = await appPage('orbit-notes');
    await checkWebviewMenu(notes);
    await expect(notes.getByRole('textbox', { name: 'Appunti' })).toBeEnabled({ timeout: 15000 });
    await notes.getByRole('textbox', { name: 'Appunti' }).fill('Persistent isolated note');
    await expect(notes.getByRole('status')).toHaveText('Salvato sul dispositivo');
    const own = await notes.evaluate(() => Orbit.context());
    assert.equal(own.id, 'orbit-notes');
    const blocked = await notes.evaluate(async () => {
      const attempt = async fn => { try { await fn(); return false; } catch { return true; } };
      return {
        host: await attempt(() => window.__TAURI_INTERNALS__.invoke('get_settings')),
        shell: await attempt(() => window.__TAURI_INTERNALS__.invoke('check_agent', { executable: 'anything' })),
        recording: await attempt(() => window.__TAURI_INTERNALS__.invoke('set_shortcut_recording', { active:true })),
        capture: await attempt(() => Orbit.capture.select()),
        timer: await attempt(() => Orbit.timers.list()),
        network: await attempt(() => fetch('https://example.com/')),
        crossApp: await attempt(() => fetch('https://orbitapp.orbit-timer/index.html')),
      };
    });
    assert.deepEqual(blocked, { host:true,shell:true,recording:true,capture:true,timer:true,network:true,crossApp:true });
    await assert.rejects(notes.evaluate(() => Orbit.files.read('note.txt')), /Permesso/);
    await assert.rejects(notes.evaluate(() => Orbit.files.write('note.txt','aGk=')), /Permesso/);
    await assert.rejects(notes.evaluate(() => window.__TAURI_INTERNALS__.invoke('data_location')));
    console.log('PASS: sender-bound permissions; host IPC, capture/timers, network and cross-app access denied');
    await invoke('set_theme', { mode:'light' });
    await expect(host.locator('html')).toHaveAttribute('data-theme','light');
    await expect(notes.locator('html')).toHaveAttribute('data-theme','light');
    await expect(notes.locator('html')).toHaveCSS('background-color','rgb(250, 249, 253)');
    assert.equal(await notes.evaluate(() => Orbit.appearance.get()),'light');
    await assert.rejects(notes.evaluate(() => window.__TAURI_INTERNALS__.invoke('set_theme', { mode:'dark' })));
    await assert.rejects(invoke('set_theme',{ mode:'invalid' }));
    await reloadHost();
    await expect(host.locator('html')).toHaveAttribute('data-theme','light');
    await invoke('set_theme',{ mode:'dark' });
    await expect(notes.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(notes.locator('html')).toHaveCSS('background-color','rgb(17, 18, 26)');
    await invoke('set_theme',{ mode:'system' });
    await host.emulateMedia({ colorScheme:'light' });
    await notes.emulateMedia({ colorScheme:'light' });
    await expect(host.locator('html')).toHaveAttribute('data-theme','light');
    await expect(notes.locator('html')).toHaveAttribute('data-theme','light');
    await host.emulateMedia({ colorScheme:'dark' });
    await notes.emulateMedia({ colorScheme:'dark' });
    await expect(host.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(notes.locator('html')).toHaveAttribute('data-theme','dark');
    await invoke('set_theme',{ mode:'light' });
    console.log('PASS: persisted host theme, live app theme, automatic OS media changes and denied app theme writes');
    const pin = notes.getByRole('button', { name:'Fissa pannello', exact:true });
    await expect(pin).toHaveAttribute('aria-pressed','false');
    await expect(notes.getByRole('button', { name:'Chiudi', exact:true })).toHaveCount(0);
    await invoke('set_app_shortcut',{ id:'orbit-notes',shortcut:'Ctrl+Shift+8' });
    const toggleNotes = () => execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^+8"); Start-Sleep -Milliseconds 250'], { windowsHide:true });
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed','true');
    await notes.keyboard.press('Escape');
    assert.deepEqual(await notes.evaluate(() => Orbit.window.getState()),{ pinned:true,visible:true });
    toggleNotes();
    assert.deepEqual(await notes.evaluate(() => Orbit.window.getState()),{ pinned:true,visible:true });
    await notes.reload();
    await expect(pin).toHaveAttribute('aria-pressed','true');
    await notes.getByRole('button', { name:'Nascondi',exact:true }).click();
    await expect.poll(() => notes.evaluate(() => Orbit.window.getState())).toEqual({ pinned:true,visible:false });
    assert.equal(notes.isClosed(),false);
    toggleNotes();
    await expect.poll(() => notes.evaluate(() => Orbit.window.getState())).toEqual({ pinned:true,visible:true });
    await expect(notes.getByRole('textbox', { name:'Appunti' })).toHaveValue('Persistent isolated note');
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed','false');
    await notes.keyboard.press('Escape');
    await expect.poll(() => notes.evaluate(() => Orbit.window.getState())).toEqual({ pinned:false,visible:false });
    await invoke('launch_app',{ id:'orbit-notes' });
    toggleNotes();
    await expect.poll(() => notes.evaluate(() => Orbit.window.getState())).toEqual({ pinned:false,visible:false });
    await invoke('launch_app',{ id:'orbit-notes' });
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed','true');
    await invoke('change_app',{ id:'orbit-notes',action:'close',deleteData:false });
    await expect.poll(() => notes.isClosed()).toBe(true);
    console.log('PASS: X hides without destroying, pin blocks Escape/global toggle, survives hide/reload, catalog terminates');
    await invoke('launch_app', { id:'orbit-notes' });
    notes = await appPage('orbit-notes');
    assert.equal((await notes.evaluate(() => Orbit.window.getState())).pinned,false);
    await expect(notes.locator('html')).toHaveAttribute('data-theme','light');
    await expect(notes.getByRole('textbox', { name:'Appunti' })).toHaveValue('Persistent isolated note');
    await terminate(notes);
    await expect.poll(() => notes.isClosed()).toBe(true);
    console.log('PASS: notes flush on close and restore from namespaced storage');
    await invoke('set_theme',{ mode:'system' });

    const starters = await invoke('starter_packages');
    const source = starters.find(source => JSON.parse(source).manifest.id === 'orbit-notes');
    await invoke('set_app_shortcut', { id:'orbit-notes',shortcut:'Ctrl+Shift+9' });
    assert.ok(tray().find(item=>item.text==='Appunti').children.some(item=>item.text==='Apri (Ctrl+Shift+9)'));
    await assert.rejects(invoke('set_app_shortcut', { id:'orbit-notes',shortcut:'Ctrl+E' }));
    await invoke('set_app_shortcut', { id:'orbit-notes',shortcut:'' });
    const update = JSON.parse(source);
    update.manifest.version = '1.4.1';
    update.manifest.name = 'Appunti aggiornati';
    const updated = JSON.stringify(update);
    const preview = await invoke('preview_package', { source: updated });
    await invoke('install_package', { source: updated, digest: preview.digest });
    assert.equal((await invoke('list_apps')).find(app => app.manifest.id === 'orbit-notes').manifest.version, update.manifest.version);
    assert.ok(tray().some(item=>item.text==='Appunti aggiornati'));
    await invoke('change_app', { id:'orbit-notes',action:'rollback',deleteData:false });
    assert.equal((await invoke('list_apps')).find(app => app.manifest.id === 'orbit-notes').manifest.version, JSON.parse(source).manifest.version);
    assert.ok(tray().some(item=>item.text==='Appunti'));
    await invoke('change_app', { id:'orbit-notes',action:'disable',deleteData:false });
    assert.ok(!tray().some(item=>item.text==='Appunti'));
    await assert.rejects(invoke('launch_app', { id:'orbit-notes' }));
    await invoke('change_app', { id:'orbit-notes',action:'uninstall',deleteData:false });
    const original = await invoke('preview_package', { source });
    await invoke('install_package', { source, digest:original.digest });
    assert.ok(tray().some(item=>item.text==='Appunti'));
    await invoke('launch_app', { id:'orbit-notes' });
    notes = await appPage('orbit-notes');
    await expect(notes.getByRole('textbox', { name:'Appunti' })).toHaveValue('Persistent isolated note');
    await terminate(notes);
    await expect.poll(() => notes.isClosed()).toBe(true);
    console.log('PASS: dynamic update, rollback, disable, uninstall/reinstall with retained data');

    const thirdParty = JSON.parse(source);
    thirdParty.manifest.id = 'local-counter';
    thirdParty.manifest.name = 'Utility locale';
    thirdParty.manifest.permissions = ['storage','files-read','files-write'];
    thirdParty.manifest.shortcut = 'Ctrl+E';
    const imported = JSON.stringify(thirdParty);
    await invoke('open_tool', { tool:'catalog' });
    await host.getByLabel('Pacchetto Orbit').setInputFiles({
      name:'local-counter.orbit',mimeType:'application/json',buffer:Buffer.from(imported),
    });
    await expect(host.getByRole('button', { name:'Installa pacchetto', exact:true })).toBeDisabled();
    await host.getByRole('checkbox', { name:/Autorizzo questi permessi/ }).check();
    await host.getByRole('button', { name:'Installa pacchetto', exact:true }).click();
    await expect(host.getByRole('button', { name:'Apri Utility locale', exact:true })).toBeVisible();
    await expect(host.getByText(/Hotkey Ctrl\+E gia assegnata/)).toBeVisible();
    await host.getByRole('button', { name:'Apri Utility locale', exact:true }).click();
    const utility = await appPage('local-counter');
    await expect(utility.getByRole('textbox', { name:'Appunti' })).toHaveValue('');
    await utility.getByRole('textbox', { name:'Appunti' }).fill('Distinct package data');
    await expect(utility.getByRole('status')).toHaveText('Salvato sul dispositivo');
    const externalFile = join(__dirname,'external-read.txt');
    writeFileSync(externalFile,'External reading permitted');
    try {
      assert.equal((await utility.evaluate(path => Orbit.files.read(path),externalFile)).base64,Buffer.from('External reading permitted').toString('base64'));
      await utility.evaluate(() => Orbit.files.write('example/data.txt',btoa('Own app data')));
      assert.equal(readFileSync(join(dataRoot,'apps/data/local-counter/files/example/data.txt'),'utf8'),'Own app data');
      assert.equal((await utility.evaluate(() => Orbit.files.list('example')))[0].name,'data.txt');
      for (const path of ['../orbit-notes/file.txt',externalFile,'C:\\outside.txt','example/../../escape.txt','NUL.txt']) {
        await assert.rejects(utility.evaluate(path => Orbit.files.write(path,btoa('No')),path));
        await assert.rejects(utility.evaluate(path => Orbit.files.remove(path),path));
      }
      const junction = join(dataRoot,'apps/data/local-counter/files/escape');
      symlinkSync(__dirname,junction,'junction');
      try {
        await assert.rejects(utility.evaluate(() => Orbit.files.write('escape/no.txt',btoa('No'))), /Collegamenti/);
        await assert.rejects(utility.evaluate(() => Orbit.files.remove('escape/external-read.txt')), /Collegamenti/);
      } finally { rmdirSync(junction); }
      await utility.evaluate(() => Orbit.files.remove('example/data.txt'));
      assert.equal((await utility.evaluate(() => Orbit.files.list('example'))).length,0);
    } finally { unlinkSync(externalFile); }
    console.log('PASS: unrestricted authorized file reading, app-scoped writes/removal, traversal rejection and centralized storage');
    await terminate(utility);
    await expect.poll(() => utility.isClosed()).toBe(true);
    await invoke('open_tool', { tool:'catalog' });
    await host.getByRole('button', { name:'Disinstalla Utility locale',exact:true }).click();
    await host.getByRole('checkbox', { name:'Elimina anche i dati di questa app' }).check();
    await host.getByRole('button', { name:'Conferma rimozione',exact:true }).click();
    await expect(host.getByRole('button', { name:'Apri Utility locale',exact:true })).toHaveCount(0);
    console.log('PASS: arbitrary package installed and removed through real catalog UI with explicit approval and isolated data');

    const appNav = host.getByRole('navigation', { name:'Impostazioni delle app',exact:true });
    await appNav.getByRole('button', { name:'Impostazioni Appunti',exact:true }).click();
    await expect(host.getByRole('spinbutton', { name:'Dimensione testo' })).toHaveValue('14');
    assert.ok(!context.pages().some(page => page.url().includes('orbitapp.orbit-notes')));
    await host.getByRole('spinbutton', { name:'Dimensione testo' }).fill('18');
    await host.getByRole('button', { name:'Salva preferenze',exact:true }).click();
    await expect.poll(async () => (await invoke('get_app_preferences', { id:'orbit-notes' }))['font-size']).toBe(18);
    await recordShortcut(host.getByRole('textbox', { name:'Hotkey Scrivi un appunto',exact:true }), 'Control+Shift+9');
    await host.getByRole('button', { name:'Salva hotkey Scrivi un appunto',exact:true }).click();
    await expect.poll(async () => (await invoke('list_shortcuts')).find(b => b.appId==='orbit-notes' && b.actionId==='focus-editor')?.registered).toBe(true);
    await appNav.getByRole('button', { name:'Impostazioni Timer',exact:true }).click();
    await host.getByLabel('Durata predefinita').selectOption('60');
    await host.getByRole('button', { name:'Salva preferenze',exact:true }).click();
    await expect.poll(async () => (await invoke('get_app_preferences', { id:'orbit-timer' })).duration).toBe('60');
    const quickShortcut = host.getByRole('textbox', { name:'Hotkey Avvia timer rapido',exact:true });
    await quickShortcut.click();
    await expect(quickShortcut).toHaveAttribute('data-recording','ready');
    assert.equal((await invoke('list_shortcuts')).find(b => b.appId==='orbit-notes' && b.actionId==='focus-editor').registered,false);
    const keyPoint = await quickShortcut.evaluate(input => {
      const box = input.getBoundingClientRect();
      return { x:Math.round((box.x+box.width/2)*devicePixelRatio),y:Math.round((box.y+box.height/2)*devicePixelRatio) };
    });
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      `Add-Type -AssemblyName System.Windows.Forms
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class KeyProbe {
        [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
      }'
      [void][KeyProbe]::SetProcessDPIAware()
      $p = @(Get-Process | Where-Object { $_.Path -eq (Join-Path $env:LOCALAPPDATA 'Orbit-interop-test\\orbit-overlay.exe') })
      if ($p.Count -ne 1) { throw 'Expected isolated host process' }
      $point = New-Object KeyProbe+Point
      if (![KeyProbe]::ClientToScreen($p[0].MainWindowHandle,[ref]$point)) { throw 'Host client origin unavailable' }
      [void][KeyProbe]::SetCursorPos($point.X+${keyPoint.x},$point.Y+${keyPoint.y})
      [KeyProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
      [KeyProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 150
      [System.Windows.Forms.SendKeys]::SendWait("^+9")`], { windowsHide:true });
    await expect(quickShortcut).toHaveValue('Ctrl+Shift+9');
    assert.ok(!context.pages().some(page => page.url().includes('orbitapp.orbit-notes')));
    await host.getByRole('button', { name:'Salva hotkey Avvia timer rapido',exact:true }).click();
    await expect(host.getByRole('alert').filter({ hasText:'gia in uso' })).toContainText('Appunti');
    assert.equal((await invoke('list_shortcuts')).find(b => b.appId==='orbit-notes' && b.actionId==='focus-editor').shortcut,'Ctrl+Shift+9');
    await host.getByRole('button', { name:'Annulla',exact:true }).click();
    await host.getByRole('button', { name:'Salva hotkey Avvia timer rapido',exact:true }).click();
    await host.getByRole('button', { name:'Sostituisci assegnazioni',exact:true }).click();
    await expect.poll(async () => (await invoke('list_shortcuts')).find(b => b.appId==='orbit-timer' && b.actionId==='quick-timer')?.registered).toBe(true);
    assert.equal((await invoke('list_shortcuts')).find(b => b.appId==='orbit-notes' && b.actionId==='focus-editor').shortcut,null);
    await recordShortcut(quickShortcut, 'Control+E');
    await host.getByRole('button', { name:'Salva hotkey Avvia timer rapido',exact:true }).click();
    await expect(host.locator('.shortcut-conflict').filter({ hasText:'Ctrl+E' })).toContainText('riservate');
    await expect(host.getByRole('button', { name:'Sostituisci assegnazioni',exact:true })).toHaveCount(0);
    await host.getByRole('button', { name:'Annulla',exact:true }).click();
    await recordShortcut(quickShortcut, 'Control+2');
    await expect(quickShortcut).toHaveValue('Ctrl+2');
    await host.getByRole('button',{ name:'Rimuovi hotkey Avvia timer rapido',exact:true }).click();
    await expect.poll(async () => (await invoke('list_shortcuts')).find(b => b.appId==='orbit-timer' && b.actionId==='quick-timer')?.shortcut).toBe(null);
    await recordShortcut(quickShortcut, 'Control+Shift+9');
    await host.getByRole('button', { name:'Salva hotkey Avvia timer rapido',exact:true }).click();
    await quickShortcut.click();
    await expect(quickShortcut).toHaveAttribute('data-recording','ready');
    await reloadHost();
    await expect.poll(async () => (await invoke('list_shortcuts')).find(b => b.appId==='orbit-timer' && b.actionId==='quick-timer')?.registered).toBe(true);
    await invoke('open_tool', { tool:'catalog' });
    await appNav.getByRole('button', { name:'Impostazioni Timer',exact:true }).click();
    await quickShortcut.click();
    await expect(quickShortcut).toHaveAttribute('data-recording','ready');
    await invoke('launch_app', { id:'orbit-notes' });
    notes = await appPage('orbit-notes');
    await expect.poll(async () => (await invoke('list_shortcuts')).find(b => b.appId==='orbit-timer' && b.actionId==='quick-timer')?.registered).toBe(true);
    await terminate(notes);
    await expect.poll(() => notes.isClosed()).toBe(true);
    console.log('PASS: native key recording, Ctrl+2, cross removal, caller ACL, focus loss and reload restore');
    console.log('PASS: per-app host menu never launches app, typed preferences, conflict cancellation/replacement and reserved host hotkeys');

    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^+9")'], { windowsHide:true });
    let quickTimer = await appPage('orbit-timer');
    await expect(quickTimer.getByRole('listitem')).toHaveCount(1);
    const quick = await quickTimer.evaluate(() => Orbit.timers.list());
    assert.equal(quick[0].label,'Timer rapido');
    assert.ok(quick[0].deadline - Math.floor(Date.now()/1000) <= 60 && quick[0].deadline - Math.floor(Date.now()/1000) > 45);
    await invoke('launch_app_action', { id:'orbit-timer',actionId:'quick-timer' });
    await expect(quickTimer.getByRole('listitem')).toHaveCount(2);
    await quickTimer.evaluate(async () => { for (const timer of await Orbit.timers.list()) await Orbit.timers.cancel(timer.id); });
    await terminate(quickTimer);
    await expect.poll(() => quickTimer.isClosed()).toBe(true);
    await invoke('launch_app_action', { id:'orbit-notes',actionId:'focus-editor' });
    notes = await appPage('orbit-notes');
    await expect(notes.getByRole('textbox', { name:'Appunti',exact:true })).toBeFocused();
    await expect(notes.getByRole('textbox', { name:'Appunti',exact:true })).toHaveCSS('font-size','18px');
    await invoke('set_app_preferences', { id:'orbit-notes',values:{ 'font-size':21 },reset:false });
    await expect(notes.getByRole('textbox', { name:'Appunti',exact:true })).toHaveCSS('font-size','21px');
    await notes.evaluate(() => Orbit.preferences.update({ placeholder:'SDK preference' }));
    assert.equal((await invoke('get_app_preferences', { id:'orbit-notes' })).placeholder,'SDK preference');
    const scope = await notes.evaluate(async () => {
      const denied = async fn => { try { await fn(); return false; } catch { return true; } };
      return {
        hostWrite:await denied(() => window.__TAURI_INTERNALS__.invoke('set_app_preferences', { id:'orbit-timer',values:{ duration:'60' },reset:false })),
        invalid:await denied(() => Orbit.preferences.update({ 'font-size':99 })),
        undeclared:await denied(() => Orbit.shortcuts.check('missing','Ctrl+Shift+9')),
        reserved:(await Orbit.shortcuts.check('focus-editor','Ctrl+E')).some(b => b.appId===null),
        registry:(await Orbit.shortcuts.list()).some(b => b.appId==='orbit-timer' && b.actionId==='quick-timer'),
      };
    });
    assert.deepEqual(scope,{ hostWrite:true,invalid:true,undeclared:true,reserved:true,registry:true });
    await terminate(notes);
    await expect.poll(() => notes.isClosed()).toBe(true);
    await assert.rejects(invoke('launch_app_action',{ id:'orbit-notes',actionId:'missing' }));
    console.log('PASS: real global action hotkey, cold/warm action delivery, live preferences, SDK registry and sender-scoped settings');

    await invoke('launch_app', { id:'orbit-timer' });
    let timer = await appPage('orbit-timer');
    await timer.evaluate(async () => {
      await Orbit.timers.start('replacement', 'Old', 1);
      await Orbit.timers.start('replacement', 'Replacement', 5);
    });
    await new Promise(resolve => setTimeout(resolve, 2100));
    assert.deepEqual(await timer.evaluate(() => Orbit.timers.list().then(items =>
      items.map(item => ({ id:item.id,label:item.label,fired:item.fired })))),
    [{ id:'replacement',label:'Replacement',fired:false }]);
    await timer.evaluate(() => Orbit.timers.cancel('replacement'));
    assert.deepEqual(await timer.evaluate(() => Orbit.timers.list()), []);
    console.log('PASS: replacing a timer prevents its previous deadline; cancellation removes it');
    await timer.getByRole('spinbutton', { name:'Secondi' }).fill('4');
    await timer.getByRole('button', { name:'Avvia', exact:true }).click();
    await expect(timer.getByRole('listitem')).toHaveCount(1);
    await terminate(timer);
    await expect.poll(() => timer.isClosed()).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 5000));
    await invoke('launch_app', { id:'orbit-timer' });
    timer = await appPage('orbit-timer');
    await expect(timer.getByRole('listitem')).toContainText('Terminato');
    await timer.getByRole('button', { name:'Rimuovi', exact:true }).click();
    await expect(timer.getByRole('listitem')).toHaveCount(0);
    await terminate(timer);
    console.log('PASS: host timer completes while its WebView is closed');

    const contract = { id:'test.double', version:1,
      input:{ type:'object', properties:{ inputValue:{ type:'number' }, delay:{ type:'number' } }, required:['inputValue','delay'] },
      output:{ type:'number' } };
    const fixture = (id, code, fields) => JSON.stringify({
      manifest:{ id, name:id, description:'Isolated interop fixture', version:'1.0.0', sdk:1,
        entry:'index.html', permissions:['app-actions'], contracts:[contract], ...fields },
      files:{
        'index.html':Buffer.from('<!doctype html><script src="/orbit-sdk.js" defer></script><script src="app.js" defer></script><p id="error"></p>').toString('base64'),
        'app.js':Buffer.from(code).toString('base64'),
      },
    });
    const install = async source => {
      const preview = await invoke('preview_package',{ source });
      await invoke('install_package',{ source,digest:preview.digest });
    };
    await install(fixture('test-consumer','', { dependencies:[{ contract:'test.double',version:1,required:true }] }));
    await assert.rejects(invoke('launch_app',{ id:'test-consumer' }), /Dipendenze/);
    await install(fixture('test-provider', `Orbit.services.register({ double: async value => {
      await new Promise(resolve => setTimeout(resolve, value.delay));
      return value.inputValue < 0 ? 'invalid output' : value.inputValue * 2;
    }}).catch(error => document.querySelector('#error').textContent = String(error));`,
    { exports:[{ id:'double',title:'Double',description:'Return a computed value',contract:'test.double',version:1,mode:'request' }] }));
    await invoke('set_app_hidden',{ id:'test-provider',hidden:true });
    await invoke('launch_app',{ id:'test-consumer' });
    const consumer = await appPage('test-consumer');
    assert.equal((await consumer.evaluate(() => Orbit.services.list('test.double'))).length,1);
    await assert.rejects(consumer.evaluate(() => Orbit.services.call({ contract:'test.double',input:{ inputValue:'wrong',delay:0 } })), /contratto/);
    await consumer.evaluate(() => {
      window.calls = [Orbit.services.call({ contract:'test.double',input:{ inputValue:21,delay:500 } })];
    });
    let provider = await appPage('test-provider');
    await consumer.evaluate(() => window.calls.push(Orbit.services.call({ contract:'test.double',input:{ inputValue:9,delay:1000 } })));
    assert.deepEqual(await consumer.evaluate(() => Promise.all(window.calls)), [42,18]);
    await expect.poll(() => provider.isClosed()).toBe(true);
    await assert.rejects(consumer.evaluate(() => Orbit.services.call({ contract:'test.double',input:{ inputValue:-1,delay:0 } })), /contratto/);
    await expect.poll(() => context.pages().some(page => page.url().includes('orbitapp.test-provider'))).toBe(false);
    await assert.rejects(invoke('change_app',{ id:'test-provider',action:'disable',deleteData:false }), /test-consumer/);
    await assert.rejects(invoke('change_app',{ id:'test-provider',action:'uninstall',deleteData:true }), /test-consumer/);
    assert.equal((await invoke('list_apps')).find(app => app.manifest.id === 'test-provider').enabled,true);
    await invoke('change_app',{ id:'test-consumer',action:'close',deleteData:false });
    await expect.poll(() => consumer.isClosed()).toBe(true);
    await invoke('change_app',{ id:'test-consumer',action:'disable',deleteData:false });
    await invoke('change_app',{ id:'test-provider',action:'disable',deleteData:false });
    for (const id of ['test-consumer','test-provider']) await invoke('change_app',{ id,action:'uninstall',deleteData:true });
    console.log('PASS: custom schemas, concurrent returned values, transient cleanup, hidden provider discovery and required-dependency protection');

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await invoke('save_settings', { settings: {
      provider:'compatible',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'test',
      agentEnabled:false,agentExecutable:'opencode',
    },apiKey:null,deleteKey:false });
    await invoke('launch_app', { id:'orbit-capture' });
    let capture = await appPage('orbit-capture');
    await expect(capture.getByText('Nessuno screenshot. Cattura il primo dettaglio.')).toBeVisible();
    assert.ok(await capture.evaluate(() => innerWidth >= 900 && innerHeight >= 600));
    await capture.getByRole('button', { name:'Nuovo screenshot',exact:true }).click();
    await expect(host.getByText('Seleziona un dettaglio')).toBeVisible({ timeout: 20000 });
    await host.mouse.move(100,100); await host.mouse.down();
    await host.mouse.move(320,250); await host.mouse.up();
    await expect(capture.getByAltText('Area selezionata')).toBeVisible({ timeout: 30000 });
    await expect(capture.getByRole('status')).toHaveText('Screenshot salvato automaticamente.');
    await expect(capture.locator('.screenshot-card')).toHaveCount(1);
    const screenshotDirectory = join(dataRoot,'apps/data/orbit-capture/files/screenshots');
    const screenshots = readdirSync(screenshotDirectory);
    assert.equal(screenshots.length,1);
    const selected = await capture.evaluate(() => Orbit.attachments.read(image));
    assert.deepEqual(readFileSync(join(screenshotDirectory,screenshots[0])),Buffer.from(selected.dataUrl.split(',')[1],'base64'));
    await capture.reload();
    await expect(capture.locator('.screenshot-card')).toHaveCount(1);
    await capture.locator('.screenshot-card').click();
    await expect(capture.getByAltText('Area selezionata')).toBeVisible();
    console.log('PASS: automatic PNG saving, large Screenshot gallery and disk-backed restoration after reload');
    await capture.getByRole('button', { name:'Invia a...' }).click();
    await capture.getByRole('button', { name:/Chat · Chiedi sull'immagine/ }).click();
    await expect.poll(() => context.pages().some(page => page.url().includes('orbitapp.feature-'))).toBe(true);
    const feature = context.pages().find(page => page.url().includes('orbitapp.feature-'));
    await expect(feature.getByAltText('Immagine da inviare')).toBeVisible();
    assert.equal(context.pages().some(page => page.url().includes('orbitapp.orbit-chat')),false);
    assert.equal(requests.length, 0);
    const reference = await capture.evaluate(() => image);
    await assert.rejects(feature.evaluate(() => Orbit.capture.select()));
    await invoke('launch_app', { id:'orbit-notes' });
    notes = await appPage('orbit-notes');
    await assert.rejects(notes.evaluate(ref => Orbit.attachments.read(ref), reference));
    await terminate(notes);
    await terminate(capture);
    await expect.poll(() => capture.isClosed()).toBe(true);
    await assert.rejects(feature.evaluate(ref => Orbit.attachments.read(ref), reference));
    await feature.getByRole('textbox', { name:'Messaggio' }).fill('Describe this');
    await feature.getByRole('button', { name:'Invia', exact:true }).click();
    await expect(feature.getByText('Risposta pacchetto verificata', { exact:true })).toBeVisible();
    assert.ok(requests[0].messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url')));
    await feature.getByRole('textbox', { name:'Messaggio' }).fill('Follow-up');
    await feature.getByRole('button', { name:'Invia', exact:true }).click();
    await expect(feature.getByText('Risposta pacchetto verificata', { exact:true })).toHaveCount(2);
    assert.equal(requests.length,2);
    await invoke('launch_app',{ id:'orbit-chat' });
    const chat = await appPage('orbit-chat');
    await expect(chat.getByRole('textbox', { name:'Messaggio' })).toHaveValue('');
    await expect(chat.getByText('Risposta pacchetto verificata', { exact:true })).toHaveCount(0);
    await expect(chat.getByAltText('Immagine da inviare')).toBeHidden();
    await feature.getByRole('button', { name:'Chiudi',exact:true }).click();
    await expect.poll(() => feature.isClosed()).toBe(true);
    assert.equal(chat.isClosed(),false);
    console.log('PASS: image-only cold feature, explicit AI turns and separate unmodified full Chat');
    await chat.getByRole('button', { name:'Fissa pannello',exact:true }).click();
    await expect(chat.getByRole('button', { name:'Fissa pannello',exact:true })).toHaveAttribute('aria-pressed','true');
    await chat.getByRole('textbox', { name:'Messaggio' }).fill('Draft retained while hidden');
    await chat.getByRole('button', { name:'Nascondi',exact:true }).click();
    await expect.poll(() => chat.evaluate(() => Orbit.window.getState())).toEqual({ pinned:true,visible:false });
    await invoke('launch_app',{ id:'orbit-chat' });
    assert.equal(await appPage('orbit-chat'),chat);
    await expect(chat.getByRole('textbox', { name:'Messaggio' })).toHaveValue('Draft retained while hidden');
    await expect(chat.getByText('Risposta pacchetto verificata', { exact:true })).toHaveCount(0);
    await chat.getByRole('button', { name:'Allega cattura' }).click();
    await expect(host.getByText('Seleziona un dettaglio')).toBeVisible({ timeout:20000 });
    assert.deepEqual(await chat.evaluate(() => Orbit.window.getState()),{ pinned:true,visible:false });
    capture = await appPage('orbit-capture');
    await host.mouse.move(100,100); await host.mouse.down();
    await host.mouse.move(280,220); await host.mouse.up();
    await expect(chat.getByAltText('Immagine da inviare')).toBeVisible();
    await expect.poll(() => capture.isClosed()).toBe(true);
    await expect.poll(() => chat.evaluate(() => Orbit.window.getState())).toEqual({ pinned:true,visible:true });
    assert.equal(requests.length,2);
    await chat.getByRole('button', { name:'Rimuovi allegato' }).click();
    await chat.getByRole('button', { name:'Allega cattura' }).click();
    await expect(host.getByText('Seleziona un dettaglio')).toBeVisible({ timeout:20000 });
    capture = await appPage('orbit-capture');
    await chat.evaluate(() => selecting.abort());
    await expect(chat.getByRole('alert')).toContainText('annullata');
    await expect.poll(() => capture.isClosed()).toBe(true);
    await expect(chat.getByRole('button', { name:'Allega cattura' })).toBeEnabled();
    await chat.getByRole('button', { name:'Allega cattura' }).click();
    await expect(host.getByText('Seleziona un dettaglio')).toBeVisible({ timeout:20000 });
    capture = await appPage('orbit-capture');
    await capture.evaluate(() => Orbit.window.setPinned(true));
    await host.mouse.move(100,100); await host.mouse.down();
    await host.mouse.move(280,220); await host.mouse.up();
    await expect(chat.getByAltText('Immagine da inviare')).toBeVisible();
    await expect.poll(() => capture.evaluate(() => Orbit.window.getState())).toEqual({ pinned:true,visible:false });
    assert.equal(capture.isClosed(),false);
    await terminate(capture);
    console.log('PASS: pinned panels restore after capture and pinning a temporary provider keeps it alive');
    await invoke('launch_app',{ id:'orbit-capture' });
    capture = await appPage('orbit-capture');
    await expect(capture.locator('.screenshot-card')).toHaveCount(3);
    await expect(capture.getByRole('button',{ name:'Aggiorna galleria' })).toBeEnabled();
    const ordered = await capture.evaluate(async () => (await Orbit.files.list('screenshots'))
      .sort((a,b) => b.modifiedMs-a.modifiedMs || b.name.localeCompare(a.name)).map(entry=>`screenshots/${entry.name}`));
    assert.deepEqual(await capture.locator('.screenshot-card').evaluateAll(elements=>elements.map(element=>element.dataset.path)),ordered);
    await capture.locator('.screenshot-card').last().click();
    await capture.getByRole('button',{ name:'Elimina',exact:true }).click();
    await capture.getByRole('button',{ name:'Annulla',exact:true }).click();
    assert.equal(readdirSync(screenshotDirectory).length,3);
    await capture.getByRole('button',{ name:'Elimina',exact:true }).click();
    await capture.getByRole('button',{ name:'Elimina definitivamente' }).click();
    await expect(capture.locator('.screenshot-card')).toHaveCount(2);
    assert.equal(readdirSync(screenshotDirectory).length,2);
    await terminate(capture);
    console.log('PASS: provider captures persist, gallery restores newest-first and confirmed deletion removes exactly one file');
    await invoke('change_app', { id:'orbit-capture',action:'disable',deleteData:false });
    assert.deepEqual(await chat.evaluate(() => Orbit.services.list('image.capture')), []);
    await invoke('change_app', { id:'orbit-capture',action:'enable',deleteData:false });
    assert.equal((await chat.evaluate(() => Orbit.services.list('image.capture'))).length,1);
    await terminate(chat);
    console.log('PASS: Send to draft, explicit AI submission, attachment ACL/lifetime, request result, cancellation and optional provider availability');
    await invoke('open_tool', { tool:'catalog' });
    await appNav.getByRole('button', { name:'Impostazioni Appunti',exact:true }).click({ button:'right' });
    await host.getByRole('menuitem', { name:'Nascondi',exact:true }).click();
    assert.equal((await invoke('list_apps')).find(app=>app.manifest.id==='orbit-notes').hidden,true);
    await reloadHost();
    await invoke('open_tool', { tool:'catalog' });
    await expect(appNav.getByRole('button', { name:'Impostazioni Appunti',exact:true })).toHaveCount(0);
    await host.locator('.hidden-apps summary').click();
    await host.locator('.hidden-apps').getByRole('button', { name:'Impostazioni Appunti',exact:true }).click({ button:'right' });
    await host.getByRole('menuitem', { name:'Mostra nel menu' }).click();
    assert.equal((await invoke('list_apps')).find(app=>app.manifest.id==='orbit-notes').enabled,true);
    console.log('PASS: hidden menu persists and restores without disabling the app');
    assert.deepEqual(errors, []);
  } catch (error) {
    for (const page of context.pages().filter(page => page.url().includes('orbitapp.'))) {
      console.error('App diagnostics:', page.url(), await page.locator('#error').textContent().catch(() => 'unavailable'));
    }
    console.error('JavaScript errors:', errors);
    throw error;
  } finally {
    server.close(); server.closeAllConnections();
    await invoke('quit_app').catch(error => {
      if (!/closed|destroyed|disconnected/i.test(error.message)) throw error;
    });
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
