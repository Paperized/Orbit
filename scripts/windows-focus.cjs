const { chromium, expect } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');

const native = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FocusProbe {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
`;
function win(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', native + command],
    { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
}
const foreground = () => Number(win('[FocusProbe]::GetForegroundWindow().ToInt64()'));
const keys = (modifier, key) => win(`
  [FocusProbe]::keybd_event(${modifier},0,0,[UIntPtr]::Zero)
  [FocusProbe]::keybd_event(${key},0,0,[UIntPtr]::Zero)
  [FocusProbe]::keybd_event(${key},0,2,[UIntPtr]::Zero)
  [FocusProbe]::keybd_event(${modifier},0,2,[UIntPtr]::Zero)
`);

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329', { timeout: 15000 });
  console.log('Connected to native overlay');
  const temporary = mkdtempSync(join(tmpdir(), 'orbit-focus-'));
  const handlesFile = join(temporary, 'handles.json');
  const fixture = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
    Add-Type -AssemblyName System.Windows.Forms
    $a = New-Object System.Windows.Forms.Form; $a.Text='Orbit focus fixture A'
    $b = New-Object System.Windows.Forms.Form; $b.Text='Orbit focus fixture B'
    $a.Show(); $b.Show()
    @{a=$a.Handle.ToInt64(); b=$b.Handle.ToInt64()} | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 '${handlesFile.replace(/'/g, "''")}'
    $a.Add_FormClosed({$b.Close()})
    [System.Windows.Forms.Application]::Run($a)
  `], { windowsHide: true, stdio: 'ignore' });
  let handles;
  try {
    await expect.poll(() => existsSync(handlesFile)).toBe(true);
    handles = JSON.parse(readFileSync(handlesFile, 'utf8').replace(/^\uFEFF/, ''));
    console.log('Created focus fixtures');
    const host = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost'));
    const invoke = (command, args = {}) => host.evaluate(async ({ command, args }) => {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${command}`)), 10000));
      return Promise.race([window.__TAURI_INTERNALS__.invoke(command, args), timeout]);
    }, { command, args });
    const focus = async handle => {
      win(`[FocusProbe]::keybd_event(18,0,0,[UIntPtr]::Zero); [FocusProbe]::keybd_event(18,0,2,[UIntPtr]::Zero); [FocusProbe]::SetForegroundWindow([IntPtr]::new(${handle})) | Out-Null`);
      await expect.poll(foreground).toBe(handle);
    };
    await invoke('hide_overlay');
    console.log('Overlay hidden for focus baseline');
    await focus(handles.a);
    keys(17, 69);
    await expect.poll(foreground).not.toBe(handles.a);
    await invoke('hide_overlay');
    await expect.poll(foreground).toBe(handles.a);
    console.log('PASS: closing a focused overlay restores the original app');
    await focus(handles.b);
    await focus(handles.a);
    keys(17, 69);
    await expect.poll(foreground).not.toBe(handles.a);
    const overlay = foreground();
    assert.notEqual(overlay, handles.a);
    keys(18, 9);
    await expect.poll(foreground).not.toBe(overlay);
    // Select a different app than the one recorded when Orbit opened.
    await focus(handles.b);
    keys(17, 69);
    await expect.poll(() => win(`[FocusProbe]::IsWindowVisible([IntPtr]::new(${overlay}))`)).toBe('False');
    assert.equal(foreground(), handles.b, 'Closing Orbit must not undo Alt+Tab');
    assert.equal(win(`[FocusProbe]::IsWindowVisible([IntPtr]::new(${overlay}))`), 'False');
    console.log('PASS: real Alt+Tab plus Ctrl+E hides Orbit and preserves the newly selected app');
    keys(17, 69);
    await expect.poll(foreground).toBe(overlay);
    await invoke('hide_overlay');
    await expect.poll(foreground).toBe(handles.b);
    console.log('PASS: the next overlay session remembers the newly selected app');
    keys(17, 69);
    await expect.poll(foreground).toBe(overlay);
  } finally {
    if (browser) await browser.close();
    if (handles) win(`[FocusProbe]::PostMessage([IntPtr]::new(${handles.a}),16,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null`);
    else fixture.kill();
    rmSync(handlesFile, { force: true });
    // Only this test's explicitly created temporary directory is removed.
    rmSync(temporary, { recursive: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
