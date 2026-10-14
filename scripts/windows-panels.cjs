const { chromium, expect } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const appPid = Number(process.argv[2]);
const parkedPid = Number(process.argv[3] || 0);
assert.equal(process.platform, 'win32', 'Use Windows Node.js');
assert.ok(Number.isInteger(appPid) && appPid > 0, 'Pass the PID of the test Orbit instance');
assert.ok(Number.isInteger(parkedPid) && parkedPid >= 0 && parkedPid !== appPid);
const quote = text => `'${text.replace(/'/g, "''")}'`;
const native = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PanelProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; public Point(int x,int y) { X=x; Y=y; } }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point p);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static IntPtr Find(int pid) { return Find(pid,"Orbit"); }
  public static IntPtr Find(int pid, string name) {
    IntPtr result=IntPtr.Zero;
    EnumWindows((h,p) => {
      uint owner; GetWindowThreadProcessId(h,out owner);
      var title=new StringBuilder(256); GetWindowText(h,title,256);
      if(owner==pid && title.ToString()==name) { result=h; return false; }
      return true;
    },IntPtr.Zero);
    return result;
  }
  public static int Owner(IntPtr h) { uint pid; GetWindowThreadProcessId(GetAncestor(h,2),out pid); return (int)pid; }
}
'@
[PanelProbe]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
`;
function win(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', native + '\n' + command],
    { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
}
function snapshot() {
  return JSON.parse(win(`
    $w=[PanelProbe]::Find(${appPid}); if($w -eq [IntPtr]::Zero) { throw 'Orbit window missing' }
    $r=New-Object PanelProbe+Rect; [PanelProbe]::GetClientRect($w,[ref]$r) | Out-Null
    $p=New-Object PanelProbe+Point; [PanelProbe]::ClientToScreen($w,[ref]$p) | Out-Null
    @{x=$p.X; y=$p.Y; width=$r.Right; height=$r.Bottom; style=[PanelProbe]::GetWindowLongPtr($w,-20).ToInt64()} | ConvertTo-Json -Compress
  `));
}
function click(x, y, text = '') {
  win(`[PanelProbe]::SetCursorPos(${Math.round(x)},${Math.round(y)}) | Out-Null
    [PanelProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [PanelProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    ${text ? `[System.Windows.Forms.SendKeys]::SendWait(${quote(text)})` : ''}`);
}
function drag(x, y, dx, dy) {
  win(`[PanelProbe]::SetCursorPos(${Math.round(x)},${Math.round(y)}) | Out-Null
    [PanelProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    for($i=1;$i -le 10;$i++) {
      [PanelProbe]::SetCursorPos([int](${x}+${dx}*$i/10),[int](${y}+${dy}*$i/10)) | Out-Null
      Start-Sleep -Milliseconds 30
    }
    [PanelProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`);
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-panel-input-'));
  const countersFile = path.join(temporary, 'events.json');
  let restoreParked = false;
  let fixture;
  let browser;
  let page;
  const invoke = (command, args = {}) => page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  const counters = () => JSON.parse(fs.readFileSync(countersFile, 'utf8').replace(/^\uFEFF/, ''));
  try {
    if (parkedPid) {
      restoreParked = win(`$w=[PanelProbe]::Find(${parkedPid}); $visible=[PanelProbe]::IsWindowVisible($w)
        if($visible) { [PanelProbe]::ShowWindow($w,0) | Out-Null }; $visible`) === 'True';
    }
    fixture = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', String.raw`
      $ErrorActionPreference='Stop'
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing @'
using System.IO;
using System.Windows.Forms;
public sealed class OrbitInputFixture : Form {
  private readonly string file;
  private int clicks, keys;
  public OrbitInputFixture(string file) {
    this.file=file;
    Text="Orbit input fixture";
    WindowState=FormWindowState.Maximized;
    var box=new TextBox { Multiline=true, Dock=DockStyle.Fill };
    Controls.Add(box);
    box.MouseDown += (sender,e) => { clicks++; Save(); };
    box.KeyPress += (sender,e) => { keys++; Save(); };
    Shown += (sender,e) => { Save(); box.Focus(); };
  }
  private void Save() {
    File.WriteAllText(file,"{\"clicks\":"+clicks+",\"keys\":"+keys+"}");
  }
}
'@
      [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::ThrowException)
      [System.Windows.Forms.Application]::Run([OrbitInputFixture]::new(${quote(countersFile)}))
    `], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    fixture.stderr.on('data', data => process.stderr.write(data));
    await expect.poll(() => fs.existsSync(countersFile), { timeout: 20000 }).toBe(true);
    browser = await chromium.connectOverCDP('http://127.0.0.1:19328');
    page = browser.contexts()[0].pages().find(page => page.url() === 'http://tauri.localhost/');
    assert.ok(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const monitor = snapshot();
    win(`$w=[PanelProbe]::Find(${fixture.pid},'Orbit input fixture')
      [PanelProbe]::ShowWindow($w,9) | Out-Null
      [PanelProbe]::SetWindowPos($w,[IntPtr]::Zero,${monitor.x},${monitor.y},${monitor.width},${monitor.height},20) | Out-Null`);
    await invoke('open_tool', { tool: 'chat' });
    await expect(page.locator('.native-panel')).toBeVisible();
    const initial = snapshot();
    const scale = await page.evaluate(() => devicePixelRatio);
    assert.ok(Math.abs(initial.width / scale - 440) < 2);
    assert.ok(Math.abs(initial.height / scale - 520) < 2);
    assert.ok(initial.style & 8, 'WS_EX_TOPMOST must be set');
    assert.equal(initial.style & 32, 0, 'WS_EX_TRANSPARENT must not be set');
    assert.equal(await page.locator('.tool-mode').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    console.log('PASS: compact real window, always on top, no click-through flag or dimming layer');

    const outside = { x: initial.x > 100 ? initial.x - 50 : initial.x + initial.width + 50, y: initial.y + 100 };
    assert.equal(Number(win(`[PanelProbe]::Owner([PanelProbe]::WindowFromPoint([PanelProbe+Point]::new(${outside.x},${outside.y})))`)), fixture.pid);
    click(outside.x, outside.y, 'UNDERLAY');
    await expect.poll(() => counters().clicks).toBe(1);
    await expect.poll(() => counters().keys).toBe(8);
    assert.equal(counters().clicks, 1);
    const field = page.getByRole('textbox', { name: 'Messaggio', exact: true });
    const box = await field.boundingBox();
    assert.ok(box);
    click(initial.x + (box.x + 20) * scale, initial.y + (box.y + 15) * scale, 'ONLYORBIT');
    await expect(field).toHaveValue('ONLYORBIT');
    assert.deepEqual(counters(), { clicks: 1, keys: 8 });
    console.log('PASS: outside click/typing reaches fixture; inside click/typing reaches only Orbit');

    const bar = await page.getByRole('button', { name: 'Sposta pannello' }).boundingBox();
    drag(initial.x + (bar.x + 40) * scale, initial.y + (bar.y + 19) * scale, -120, 60);
    const moved = snapshot();
    assert.ok(Math.abs(moved.x - initial.x + 120) < 4);
    assert.ok(Math.abs(moved.y - initial.y - 60) < 4);
    drag(moved.x + moved.width - 3, moved.y + moved.height / 2, 120, 0);
    const wider = snapshot();
    assert.ok(wider.width >= moved.width + 115);
    drag(wider.x + wider.width / 2, wider.y + wider.height - 3, 0, 80);
    const resized = snapshot();
    assert.ok(resized.height >= wider.height + 75);
    assert.deepEqual(counters(), { clicks: 1, keys: 8 });
    await expect(field).toHaveValue('ONLYORBIT');
    console.log('PASS: native title drag and side/bottom resizing consume input without leaking it');

    await invoke('open_tool', { tool: 'home' });
    await expect(page.getByRole('heading', { name: /Un piccolo spazio/ })).toBeVisible();
    const dashboard = snapshot();
    assert.ok(dashboard.width > resized.width);
    click(outside.x, outside.y);
    assert.deepEqual(counters(), { clicks: 1, keys: 8 });
    await invoke('open_tool', { tool: 'chat' });
    await expect(page.locator('.native-panel')).toBeVisible();
    const restored = snapshot();
    assert.equal(restored.width, resized.width);
    assert.equal(restored.height, resized.height);
    assert.equal(restored.x, resized.x);
    assert.equal(restored.y, resized.y);
    console.log('PASS: dashboard blocks outside input; returning to chat restores panel bounds');

    await invoke('open_tool', { tool: 'capture' });
    await expect(page.getByText('Seleziona un dettaglio')).toBeVisible({ timeout: 20000 });
    await page.mouse.move(100, 100); await page.mouse.down();
    await page.mouse.move(300, 220); await page.mouse.up();
    await expect.poll(() => browser.contexts()[0].pages().some(candidate => candidate.url().includes('orbitapp.orbit-capture'))).toBe(true);
    const captureApp = browser.contexts()[0].pages().find(candidate => candidate.url().includes('orbitapp.orbit-capture'));
    await expect(captureApp.getByAltText('Selezione da inviare')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('region', { name: 'Orbit AI overlay' })).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: full-screen selection returns crop to the independently installed capture app');
  } finally {
    try {
      if (page) {
        await invoke('quit_app').catch(error => {
          if (!/closed|destroyed|disconnected/i.test(error.message)) throw error;
        });
      }
    } finally {
      try {
        if (browser) await browser.close();
      } finally {
        if (fixture) fixture.kill();
        try {
          if (restoreParked) win(`[PanelProbe]::ShowWindow([PanelProbe]::Find(${parkedPid}),4) | Out-Null`);
        } finally {
          if (fs.existsSync(countersFile)) fs.unlinkSync(countersFile);
          fs.rmdirSync(temporary);
        }
      }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
