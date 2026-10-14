const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
assert.equal(process.platform, 'win32');
const pid = Number(process.argv[2]);
assert.ok(Number.isInteger(pid) && pid > 0);
const native = String.raw`
$ErrorActionPreference='Stop'
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class GeometryProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  public delegate bool Callback(IntPtr h,IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  public static long[] Find(int pid) { var found=new List<long>(); EnumWindows((h,p)=> {
    uint owner; GetWindowThreadProcessId(h,out owner); var title=new StringBuilder(256); GetWindowText(h,title,256);
    if(owner==pid && title.ToString()=="Geometry fixture") found.Add(h.ToInt64()); return true;
  },IntPtr.Zero); return found.ToArray(); }
}
'@
[GeometryProbe]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
`;
function win(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', native + command],
    { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
}
function handles() { return JSON.parse(win(`ConvertTo-Json -Compress -InputObject @([GeometryProbe]::Find(${pid}))`)); }
function set(handle, r) {
  assert.equal(win(`$h=[IntPtr]::new(${handle}); $outer=New-Object GeometryProbe+Rect; $client=New-Object GeometryProbe+Rect
    [GeometryProbe]::GetWindowRect($h,[ref]$outer)|Out-Null; [GeometryProbe]::GetClientRect($h,[ref]$client)|Out-Null
    [GeometryProbe]::SetWindowPos($h,[IntPtr]::Zero,${r.x},${r.y},(${r.width}+$outer.Right-$outer.Left-$client.Right),(${r.height}+$outer.Bottom-$outer.Top-$client.Bottom),20)`), 'True');
}
function rect(handle) {
  return JSON.parse(win(`$r=New-Object GeometryProbe+Rect; $c=New-Object GeometryProbe+Rect
    [GeometryProbe]::GetWindowRect([IntPtr]::new(${handle}),[ref]$r)|Out-Null
    [GeometryProbe]::GetClientRect([IntPtr]::new(${handle}),[ref]$c)|Out-Null
    @{x=$r.Left;y=$r.Top;width=$c.Right;height=$c.Bottom}|ConvertTo-Json -Compress`));
}
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329');
  const context = browser.contexts()[0];
  const host = context.pages().find(p => p.url().includes('tauri.localhost'));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  assert.equal((await invoke('runtime_info')).identifier, 'dev.orbit.runtime-test');
  const root = await invoke('data_location');
  assert.ok(root.endsWith('Orbit-dev.orbit.runtime-test'));
  const saved = () => JSON.parse(readFileSync(join(root, 'host/windows.json'), 'utf8'));
  let scale = 1;
  const pageFor = async id => {
    await expect.poll(() => context.pages().some(p => p.url().includes(`orbitapp.${id}`))).toBe(true);
    const p = context.pages().find(p => p.url().includes(`orbitapp.${id}`));
    await p.waitForFunction(() => typeof Orbit !== 'undefined');
    return p;
  };
  const features = () => context.pages().filter(p => p.url().includes('orbitapp.feature-'));
  const close = async p => {
    await p.evaluate(() => { void Orbit.window.close(); }).catch(e => { if (!/closed/i.test(e.message)) throw e; });
    await expect.poll(() => p.isClosed()).toBe(true);
  };
  const mainRect = { x: 90, y: 140, width: 620, height: 440 };
  const featureRect = { x: 310, y: 240, width: 430, height: 310 };
  try {
    await expect(host.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
    const restarting = process.argv.includes('--verify-restart');
    if (!restarting) {
      for (const app of await invoke('list_apps')) await invoke('change_app', { id: app.manifest.id, action: 'close', deleteData: false });
      await expect.poll(() => context.pages().filter(p => p.url().includes('orbitapp.')).length).toBe(0);
      const manifest = { id: 'test-geometry', name: 'Geometry fixture', version: '1.0.0', sdk: 1, description: 'Window geometry regression', entry: 'index.html', permissions: ['app-actions'],
        exports: ['receive', 'other'].map(id => ({ id, title: id, description: 'Fixture', contract: 'image.receive', version: 1,
          accepts: ['image/png'], invocationModes: ['service', 'interactive'], interactiveEntry: 'feature.html' })) };
      const html = '<!doctype html><script src="/orbit-sdk.js"></script><script src="fixture.js" defer></script><p>Geometry fixture</p>';
      const js = `(async()=>{const c=await Orbit.context(); const ids=c.invocation?[c.invocation.actionId]:['receive','other'];
        await Orbit.services.register(Object.fromEntries(ids.map(id=>[id,async()=>({accepted:true})]))); window.ready=true;})();`;
      const source = JSON.stringify({ manifest, files: Object.fromEntries([['index.html', html], ['feature.html', html], ['fixture.js', js]].map(([p, s]) => [p, Buffer.from(s).toString('base64')])) });
      if (!(await invoke('list_apps')).some(a => a.manifest.id === 'test-geometry')) {
        const preview = await invoke('preview_package', { source });
        await invoke('install_package', { source, digest: preview.digest });
      }
      await invoke('change_app', { id: 'test-geometry', action: 'reset-geometry', deleteData: false });
    }
    await invoke('launch_app', { id: 'test-geometry' });
    let main = await pageFor('test-geometry'); await main.waitForFunction(() => window.ready);
    scale = await main.evaluate(() => devicePixelRatio);
    let mainHandle = handles()[0];
    if (!restarting) {
      set(mainHandle, mainRect); assert.deepEqual(rect(mainHandle), mainRect);
      await expect.poll(() => saved()['app:test-geometry']?.width).toBe(mainRect.width / scale);
      await close(main);
      await invoke('launch_app', { id: 'test-geometry' });
      main = await pageFor('test-geometry'); mainHandle = handles()[0];
    }
    assert.deepEqual(rect(mainHandle), mainRect);
    console.log(`PASS: normal app geometry restored after ${restarting ? 'process restart' : 'destruction/relaunch'}`);
    await close(main);
    await invoke('launch_app', { id: 'orbit-capture' });
    const caller = await pageFor('orbit-capture');
    await caller.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      window.geometryImage = await Orbit.attachments.create({ dataUrl: canvas.toDataURL('image/png'), width: 2, height: 2 });
    });
    const call = (intent, actionId = 'receive') => caller.evaluate(({ intent, actionId }) => Orbit.services.call({
      contract: 'image.receive', provider: 'test-geometry', actionId, intent, input: { image: window.geometryImage },
    }), { intent, actionId });
    const beforeService = saved()['app:test-geometry'];
    await call('service');
    await expect.poll(() => context.pages().some(p => p.url().includes('orbitapp.test-geometry'))).toBe(false);
    assert.deepEqual(saved()['app:test-geometry'], beforeService);
    console.log('PASS: cold hidden service never overwrites normal app placement');
    await call('interactive');
    let feature = features()[0];
    let featureHandle = handles()[0];
    if (!restarting) {
      set(featureHandle, featureRect); assert.deepEqual(rect(featureHandle), featureRect);
      await expect.poll(() => saved()['feature:test-geometry:receive']?.width).toBe(featureRect.width / scale);
      await close(feature);
      await call('interactive'); feature = features()[0]; featureHandle = handles()[0];
    }
    assert.deepEqual(rect(featureHandle), featureRect);
    console.log(`PASS: interactive feature geometry restored after ${restarting ? 'process restart' : 'destruction/relaunch'}`);
    if (!restarting) {
      const prior = handles();
      await call('interactive');
      const second = features().find(p => p !== feature), secondHandle = handles().find(h => !prior.includes(h));
      set(secondHandle, { ...featureRect, x: 350, width: 470 });
      await expect.poll(() => saved()['feature:test-geometry:receive']?.width).toBe(470 / scale);
      await close(feature);
      assert.equal(saved()['feature:test-geometry:receive'].width, 470 / scale);
      set(secondHandle, featureRect);
      await close(second);
      await call('interactive', 'other');
      const other = features()[0], otherHandle = handles()[0];
      set(otherHandle, { x: 200, y: 100, width: 180, height: 120 });
      await expect.poll(() => saved()['feature:test-geometry:other']?.width).toBe(180 / scale);
      assert.equal(saved()['feature:test-geometry:receive'].width, featureRect.width / scale);
      await close(other);
      console.log('PASS: concurrent instances use last modification, other feature identity is independent, sub-340/300 sizes work');
      await invoke('launch_app', { id: 'test-geometry' });
      main = await pageFor('test-geometry'); mainHandle = handles()[0];
      set(mainHandle, { x: 100, y: 100, width: Math.ceil(scale), height: Math.ceil(scale) });
      assert.equal(rect(mainHandle).width, Math.ceil(scale));
      await invoke('change_app', { id: 'test-geometry', action: 'reset-geometry', deleteData: false });
      assert.ok(rect(mainHandle).width >= 400);
      set(mainHandle, mainRect); await close(main);
      await call('interactive');
      feature = features()[0]; featureHandle = handles()[0]; set(featureHandle, featureRect); await close(feature);
      writeFileSync(join(__dirname, 'geometry-restart.json'), JSON.stringify(saved()));
      console.log('PASS: native 1px size and host recovery preserve live window; geometry ready for process restart');
    } else {
      await close(feature);
      await invoke('change_app', { id: 'test-geometry', action: 'uninstall', deleteData: true });
      await invoke('change_app', { id: 'test-geometry', action: 'reset-geometry', deleteData: false }).catch(() => {});
    }
    await caller.evaluate(() => Orbit.attachments.release(window.geometryImage));
  } finally {
    await invoke('quit_app').catch(e => { if (!/closed|destroyed|disconnected/i.test(e.message)) throw e; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
