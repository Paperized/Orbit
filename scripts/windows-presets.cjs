const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const native = `
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class PresetNative {
 public delegate bool Callback(IntPtr hwnd, IntPtr state);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr state);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 public struct Rect { public int Left, Top, Right, Bottom; }
 public class Window { public string Title; public long Handle; public bool Visible; public int Style, X, Y, Width, Height; }
 public static Window[] Snapshot() { var list=new List<Window>(); EnumWindows((h,s)=>{
   var t=new StringBuilder(512); GetWindowText(h,t,512); if(t.ToString().StartsWith("Orbit / ")){
     Rect r; GetWindowRect(h,out r); list.Add(new Window{Title=t.ToString(),Handle=h.ToInt64(),Visible=IsWindowVisible(h),Style=GetWindowLong(h,-20),X=r.Left,Y=r.Top,Width=r.Right-r.Left,Height=r.Bottom-r.Top});}
   return true; },IntPtr.Zero); return list.ToArray(); }
 public static void Toggle(){ keybd_event(0x11,0,0,UIntPtr.Zero); keybd_event(0x45,0,0,UIntPtr.Zero); keybd_event(0x45,0,2,UIntPtr.Zero); keybd_event(0x11,0,2,UIntPtr.Zero); }
}`;
function ps(body) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -TypeDefinition @'\n${native}\n'@;\n${body}`], { encoding: 'utf8', timeout: 15000 }).trim();
}
function windows() { return JSON.parse(ps('ConvertTo-Json -InputObject @([PresetNative]::Snapshot()) -Compress') || '[]'); }
function toggle() { ps('[PresetNative]::Toggle()'); }

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19329', { timeout: 15000 });
  const host = browser.contexts()[0].pages().find(page => page.url().includes('tauri.localhost') && !page.url().includes('persistent'));
  assert.ok(host);
  host.on('pageerror', error => console.error('HOST ERROR', error));
  const invoke = (command, args = {}) => host.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  const original = await invoke('get_overlay_presets');
  const home = await invoke('get_home_layout');
  const monitor = await invoke('overlay_monitor');
  const id = `native-check-${Date.now()}`;
  const layout = { version: 3, favorites: [], favoritesVisible: true, dockVisible: true, dockHiddenApps: [], clock: false, ai: false, editing: true, grid: false, gridSize: 20,
    widgets: [], rects: { logo: { x: 32, y: 120, width: 240, height: 80 }, search: { x: 350, y: 120, width: 300, height: 90 } } };
  const first = { id, name: 'OrbitNativePresetCheck', layout, builtins: ['logo', 'search'], clickThrough: ['logo'], monitor };
  let hidden = false;
  async function closeHub() { await invoke('hide_overlay'); hidden = true; }
  async function openHub() { toggle(); hidden = false; await expect(host.locator('[data-home-search]')).toBeVisible({ timeout: 15000 }); }
  try {
    assert.equal((await invoke('overlay_preset_status')).activeId, null, 'Restart must be inactive');
    await invoke('save_overlay_presets', { document: { version: 1, presets: [...original.presets, first] } });
    await host.reload();
    await host.getByRole('tab', { name: first.name, exact: true }).click();
    await host.getByRole('button', { name: 'APPLY', exact: true }).click();
    assert.equal((await invoke('overlay_preset_status')).activeId, id);
    assert.equal(windows().filter(w => w.Visible).length, 0, 'Editor suspends persistent widgets');
    await closeHub();
    await expect.poll(() => windows().filter(w => w.Visible && w.Title.endsWith(first.name)).length, { timeout: 30000 }).toBe(2);
    const shown = windows().filter(w => w.Visible && w.Title.endsWith(first.name));
    assert.ok(shown.every(w => w.Style & 8), 'Every component is always on top');
    const logo = [...shown].sort((a, b) => a.Width - b.Width)[0];
    const scale = logo.Width / layout.rects.logo.width;
    assert.ok(Math.abs(logo.X - (monitor.x + 32 * scale)) <= 1, 'Saved logical X maps to the correct monitor/DPI');
    assert.ok(Math.abs(logo.Y - (monitor.y + 120 * scale)) <= 1, 'Saved logical Y maps to the correct monitor/DPI');
    assert.ok(logo.Style & 32, 'Logo is click-through at OS level');
    assert.ok(shown.some(w => !(w.Style & 32)), 'Search is interactive at OS level');
    assert.ok(shown.every(w => w.Width < monitor.width && w.Height < monitor.height), 'No fullscreen input-catching window');
    await expect.poll(() => browser.contexts()[0].pages().filter(p => p.url().includes('persistent')).length, { timeout: 15000 }).toBe(2);
    const pages = browser.contexts()[0].pages().filter(p => p.url().includes('persistent'));
    assert.equal(pages.length, 2);
    for (const page of pages) {
      await expect(page.locator('.widget-frame')).toHaveCount(1);
      await expect(page.locator('.layout-controls')).toHaveCount(0);
      await expect(page.locator('[role=alert]')).toHaveCount(0);
      const denial = await page.evaluate(async () => {
        try { await window.__TAURI_INTERNALS__.invoke('get_settings'); return false; } catch { return true; }
      });
      assert.ok(denial, 'Persistent renderer cannot access host settings');
    }
    for (const page of pages) {
      if (await page.locator('.persistent-search').count()) {
        await page.locator('.persistent-search').click(); hidden = false;
        break;
      }
    }
    await expect(host.locator('[data-home-search]')).toBeVisible();
    assert.equal(windows().filter(w => w.Visible).length, 0);
    await host.getByRole('tab', { name: first.name, exact: true }).click();
    await host.getByRole('button', { name: 'Lascia passare i clic: Ricerca', exact: true }).click();
    first.clickThrough.push('search');
    await expect.poll(async () => (await invoke('get_overlay_presets')).presets.find(p => p.id === id).clickThrough.includes('search')).toBe(true);
    await closeHub();
    await expect.poll(() => windows().filter(w => w.Visible && (w.Style & 32)).length, { timeout: 30000 }).toBe(2);
    await openHub();
    await host.getByRole('tab', { name: first.name, exact: true }).click();
    await host.getByRole('button', { name: 'HIDE', exact: true }).click();
    await closeHub();
    await expect.poll(() => windows().filter(w => w.Visible).length).toBe(0);
    await openHub();
    assert.equal((await invoke('overlay_preset_status')).activeId, null);
    const capture = (await invoke('list_apps')).find(app => app.manifest.id === 'orbit-capture');
    assert.ok(capture?.enabled, 'Screenshot app must be available');
    const definition = capture.manifest.widgets[0];
    const content = await invoke('get_widget_data', { appId: capture.manifest.id, widgetId: definition.id, limit: 4 });
    assert.ok(content.entries.length, 'At least one existing screenshot is required; no user images are created or deleted');
    const photoPreset = { ...first, id: `${id}-photos`, name: 'OrbitNativePhotoCheck', builtins: [], clickThrough: [],
      layout: { ...layout, widgets: [{ id: 'native-photo', appId: capture.manifest.id, widgetId: definition.id,
        title: definition.title, x: 40, y: 220, width: 280, height: 240, settings: { rows: 1, columns: 1 } }] } };
    await invoke('save_overlay_presets', { document: { version: 1, presets: [...original.presets, first, photoPreset] } });
    await invoke('apply_overlay_preset', { id: photoPreset.id });
    await closeHub();
    await expect.poll(() => windows().filter(w => w.Visible && w.Title.endsWith(photoPreset.name)).length, { timeout: 30000 }).toBe(1);
    await expect.poll(() => browser.contexts()[0].pages().filter(p => p.url().includes('persistent')).length).toBe(1);
    const photo = browser.contexts()[0].pages().find(p => p.url().includes('persistent'));
    await expect(photo.locator('.image-preview')).toHaveCount(1);
    await photo.locator('.image-preview').click();
    await expect.poll(() => browser.contexts()[0].pages().filter(p => p.url().includes('persistent')).length).toBe(2);
    const preview = browser.contexts()[0].pages().find(p => p.url().includes('persistent') && p !== photo);
    await expect(preview.getByRole('dialog').getByRole('img')).toBeVisible();
    assert.ok(windows().some(w => w.Visible && w.Title === 'Orbit / Screenshot' && w.Width > 280), 'Original opens outside the small widget');
    await preview.keyboard.press('Escape');
    await expect.poll(() => windows().filter(w => w.Visible && w.Title === 'Orbit / Screenshot').length).toBe(0);
    await openHub();
    // Starting the normal screenshot selection must suspend the applied preset.
    await invoke('launch_app_action', { id: capture.manifest.id, actionId: 'capture' });
    await expect(host.locator('.selection-mode')).toBeVisible({ timeout: 15000 });
    assert.equal(windows().filter(w => w.Visible).length, 0);
    await host.keyboard.press('Escape'); hidden = true;
    await expect.poll(() => windows().filter(w => w.Visible && w.Title.endsWith(photoPreset.name)).length, { timeout: 30000 }).toBe(1);
    await openHub();
    assert.equal(await invoke('get_home_layout'), home, 'Hub data is untouched');
    await host.getByRole('tab', { name: photoPreset.name, exact: true }).click();
    await host.screenshot({ path: require('node:path').join(__dirname, 'preset-editor.png') });
    console.log('PASS: real native windows, topmost, click-through, hub suspension, edits, HIDE, restricted IPC, original screenshot preview, capture suspension/restoration and preserved hub');
  } finally {
    if (hidden) await openHub();
    await invoke('apply_overlay_preset', { id: null });
    await invoke('save_overlay_presets', { document: original });
    assert.deepEqual(await invoke('get_overlay_presets'), original);
    assert.equal(await invoke('get_home_layout'), home);
    await invoke('quit_app').catch(error => { if (!/closed|destroyed|disconnected/i.test(error.message)) throw error; });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
