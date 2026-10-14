import { test, expect, type Locator } from '@playwright/test';
import notes from '../apps/notes/manifest.json' with { type: 'json' };
import timer from '../apps/timer/manifest.json' with { type: 'json' };
import capture from '../apps/capture/manifest.json' with { type: 'json' };

async function record(input: Locator, keys: string) {
  await input.click();
  await expect(input).toHaveAttribute('data-recording', 'ready');
  await input.press(keys);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(manifests => {
    const apps = manifests.map(manifest => ({ manifest, enabled: true, hidden: false, previousVersion: null, shortcutOverride: null as string | null, actionShortcuts: {} as Record<string, string> }));
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number>();
    const preferences = new Map<string, Record<string, unknown>>();
    for (const app of apps) preferences.set(app.manifest.id, Object.fromEntries(app.manifest.preferences.map(p => [p.id, p.default])));
    function bindings() {
      return [
        { appId: null, actionId: 'home', appName: 'Orbit', label: 'Il tuo spazio', shortcut: 'Ctrl+E', enabled: true, registered: true },
        ...apps.flatMap(app => [{ appId: app.manifest.id, actionId: 'open', appName: app.manifest.name, label: 'Apri / nascondi app', shortcut: app.shortcutOverride ?? app.manifest.shortcut, enabled: app.enabled, registered: true },
          ...app.manifest.actions.map(action => ({ appId: app.manifest.id, actionId: action.id, appName: app.manifest.name, label: action.label, shortcut: app.actionShortcuts[action.id] ?? action.shortcut, enabled: app.enabled, registered: true }))]),
      ];
    }
    Object.assign(window, {
      isTauri: true,
      catalogTestCalls: calls,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void) { const id = callbacks.size + 1; callbacks.set(id, callback); return id; },
        unregisterCallback() {},
        async invoke(command: string, args: Record<string, unknown> = {}) {
          calls.push({ command, args });
          if (command === 'plugin:event|listen') { listeners.set(String(args.event), Number(args.handler)); return listeners.size; }
          if (['plugin:event|unlisten', 'frontend_ready', 'discard_capture'].includes(command)) return null;
          if (command === 'open_tool') { callbacks.get(listeners.get('overlay-open')!)?.({ payload: { tool: args.tool } }); return null; }
          if (command === 'get_settings') return { settings: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', agentEnabled: false, agentExecutable: 'opencode' }, hasKey: false };
          if (command === 'get_theme') return 'system';
          if (command === 'get_locale') return localStorage.getItem('test.locale') ?? 'it';
          if (command === 'set_locale') { localStorage.setItem('test.locale', String(args.locale)); window.dispatchEvent(new CustomEvent('orbit:locale', { detail: args.locale })); return null; }
          if (command === 'data_location') return 'C:\\Users\\Test\\Documents\\Orbit';
          if (command === 'get_home_layout') return localStorage.getItem('test.host.home');
          if (command === 'get_overlay_presets') return { version: 1, presets: [] };
          if (command === 'overlay_preset_status') return { activeId: null };
          if (command === 'save_home_layout') { localStorage.setItem('test.host.home', String(args.source)); return null; }
          if (command === 'list_apps') return structuredClone(apps);
          if (command === 'dependency_status') return [];
          if (command === 'get_widget_data') return { entries: [], warning: null };
          if (command === 'set_app_hidden') { apps.find(app => app.manifest.id === args.id)!.hidden = Boolean(args.hidden); return null; }
          if (command === 'starter_packages') return [];
          if (command === 'list_shortcuts') return bindings();
          if (command === 'set_shortcut_recording') return [];
          if (command === 'launch_app' || command === 'launch_app_action') return null;
          if (command === 'get_app_preferences') return structuredClone(preferences.get(String(args.id)));
          if (command === 'set_app_preferences') {
            const values = { ...preferences.get(String(args.id)), ...args.values as Record<string, unknown> };
            preferences.set(String(args.id), values); return structuredClone(values);
          }
          if (command === 'check_app_shortcut') return bindings().filter(b => b.shortcut === args.shortcut && !(b.appId === args.id && b.actionId === args.actionId));
          if (command === 'set_action_shortcut') {
            if (args.shortcut === 'Ctrl+E') throw new Error('Hotkey riservata');
            const app = apps.find(a => a.manifest.id === args.id)!;
            if (args.actionId === 'open') app.shortcutOverride = String(args.shortcut);
            else app.actionShortcuts[String(args.actionId)] = String(args.shortcut);
            return [];
          }
          if (command === 'change_app') {
            const app = apps.find(a => a.manifest.id === args.id)!;
            if (args.action === 'disable') app.enabled = false;
            if (args.action === 'enable') app.enabled = true;
            if (args.action === 'uninstall') apps.splice(apps.indexOf(app), 1);
            return [];
          }
          if (command === 'preview_package') return { manifest: JSON.parse(String(args.source)).manifest, digest: 'test' };
          if (command === 'hide_overlay') { callbacks.get(listeners.get('overlay-hidden')!)?.({ payload: null }); return null; }
          throw new Error(`Unexpected UI command: ${command}`);
        },
      },
    });
  }, [notes, timer, capture]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
});

test('settings close back through their opening context without hiding the native overlay', async ({ page }) => {
  const provider = page.getByRole('tab', { name: 'Provider AI', exact: true });
  const search = page.getByRole('textbox', { name: 'Cerca app e azioni' });
  const hides = () => page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string }[] })
    .catalogTestCalls.filter(call => call.command === 'hide_overlay').length);
  await page.getByRole('button', { name: 'Impostazioni Appunti', exact: true }).click();
  await expect(provider).toHaveCount(0);
  await page.getByRole('button', { name: 'Chiudi impostazioni', exact: true }).click();
  await expect(provider).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  expect(await hides()).toBe(0);
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('button', { name: 'Chiudi impostazioni', exact: true }).click();
  await expect(search).toBeVisible();
  expect(await hides()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await hides()).toBe(1);
  await page.evaluate(async () => {
    await (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } })
      .__TAURI_INTERNALS__.invoke('open_tool', { tool: 'settings' });
  });
  await expect(provider).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nascondi overlay' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await hides()).toBe(2);
});

test('disabled apps have locked dock checkboxes and preserve their choice until reenabled', async ({ page }) => {
  await page.evaluate(async () => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    await api.invoke('change_app', { id: 'orbit-notes', action: 'disable' });
    localStorage.setItem('test.host.home', JSON.stringify({
      version: 3, favorites: [], clock: false, ai: false, widgets: [], rects: {},
      grid: false, gridSize: 20, editing: false, dockHiddenApps: ['orbit-notes', 'orbit-timer'],
    }));
    await api.invoke('open_tool', { tool: 'home' });
  });
  const options = page.getByRole('button', { name: 'Impostazioni Avvio rapido', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Avvio rapido', exact: true });
  await options.click();
  const notes = dialog.getByRole('checkbox', { name: /^Appunti/ });
  await expect(notes).toBeDisabled();
  await expect(notes).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Mostra tutte' }).click();
  await expect(notes).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Timer', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test.host.home')!).dockHiddenApps)).toEqual(['orbit-notes']);
  await page.evaluate(async () => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    await api.invoke('change_app', { id: 'orbit-notes', action: 'enable' });
    await api.invoke('open_tool', { tool: 'settings' });
    await api.invoke('open_tool', { tool: 'home' });
  });
  await options.click();
  await expect(notes).toBeEnabled();
  await expect(notes).not.toBeChecked();
  await notes.check();
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.locator('[data-widget-id="dock"]').getByRole('button', { name: 'Apri Appunti', exact: true })).toBeVisible();
});

test('dock settings persist exclusions, include future installs, cancel and recover failed saves', async ({ page }) => {
  await page.reload();
  const dock = page.locator('[data-widget-id="dock"]');
  const options = dock.getByRole('button', { name: 'Impostazioni Avvio rapido', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Avvio rapido', exact: true });
  const notes = dock.getByRole('button', { name: 'Apri Appunti', exact: true });
  await options.click();
  await expect(dialog.getByRole('checkbox', { name: 'Appunti', exact: true })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Appunti', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(options).toBeFocused();
  await expect(notes).toBeVisible();
  await options.click();
  await dialog.getByRole('checkbox', { name: 'Appunti', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(options).toBeFocused();
  await expect(notes).toHaveCount(0);
  await page.reload();
  await expect(notes).toHaveCount(0);
  await page.evaluate(async () => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = api.invoke;
    api.invoke = async (command, args) => {
      const result = await invoke(command, args);
      if (command !== 'list_apps') return result;
      const apps = result as { manifest: { id: string; name: string }; enabled: boolean; hidden: boolean }[];
      const app = structuredClone(apps[0]);
      app.manifest.id = 'future-app'; app.manifest.name = 'Future app';
      return [...apps, app];
    };
    await api.invoke('open_tool', { tool: 'settings' });
    await api.invoke('open_tool', { tool: 'home' });
  });
  await expect(dock.getByRole('button', { name: 'Apri Future app' })).toBeVisible();
  await expect(notes).toHaveCount(0);
  await options.click();
  await expect(dialog.getByRole('checkbox', { name: 'Future app' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Appunti', exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Mostra tutte' }).click();
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(notes).toBeVisible();
  await options.click();
  await dialog.getByRole('checkbox', { name: 'Appunti', exact: true }).uncheck();
  await page.evaluate(() => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = api.invoke;
    api.invoke = (command, args) => command === 'save_home_layout' ? Promise.reject(new Error('Disco pieno')) : invoke(command, args);
  });
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Salvataggio non riuscito');
  await expect(notes).toHaveCount(1);
  await page.setViewportSize({ width: 360, height: 640 });
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await page.keyboard.press('Escape');
  await expect(notes).toBeVisible();
});

test('quick launch is a compact single-surface widget with persistent visibility and geometry', async ({ page }) => {
  await page.reload();
  const dock = page.locator('[data-widget-id="dock"]');
  const nav = dock.getByRole('navigation', { name: 'Avvio rapido app' });
  await expect(nav).toBeVisible();
  await expect(dock.locator('.glass, footer, p')).toHaveCount(0);
  expect((await dock.boundingBox())!.height).toBe(90);
  await expect(nav).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(nav).toHaveCSS('border-top-width', '0px');
  await expect.poll(async () => (await dock.boundingBox())?.y).toBe(page.viewportSize()!.height - 100);
  const before = await dock.boundingBox();
  await dock.getByRole('button', { name: 'Apri Appunti', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string; args: { id?: string } }[] })
    .catalogTestCalls.some(call => call.command === 'launch_app' && call.args.id === 'orbit-notes'))).toBe(true);
  await page.locator('.widget-picker summary').click();
  const toggle = page.getByRole('checkbox', { name: 'Avvio rapido', exact: true });
  await toggle.uncheck();
  await expect(dock).toHaveCount(0);
  await page.reload();
  await expect(dock).toHaveCount(0);
  await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
  await page.locator('.recovery summary').click();
  await expect(page.getByLabel('Elemento layout').locator('option[value="dock"]')).toHaveCount(0);
  await page.locator('.recovery summary').click();
  await page.getByRole('button', { name: 'Termina modifica layout', exact: true }).click();
  await page.locator('.widget-picker summary').click();
  await toggle.check();
  await expect(dock).toBeVisible();
  await expect.poll(() => dock.boundingBox()).toEqual(before);
  await page.evaluate(() => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = api.invoke;
    api.invoke = (command, args) => command === 'save_home_layout' ? Promise.reject(new Error('Disco pieno')) : invoke(command, args);
  });
  await toggle.click();
  await expect(page.getByRole('alert')).toContainText('Disco pieno');
  await expect(toggle).toBeChecked();
  await expect(dock).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 360, height: 640 });
  await dock.locator('button').first().focus();
  const buttons = dock.locator('button');
  for (let i = 1; i < await buttons.count(); i++) await page.keyboard.press('ArrowRight');
  await expect(buttons.last()).toBeFocused();
  const last = (await buttons.last().boundingBox())!, bounds = (await dock.boundingBox())!;
  expect(last.x).toBeGreaterThanOrEqual(bounds.x);
  expect(last.x + last.width).toBeLessThanOrEqual(bounds.x + bounds.width);
});

test('favorites visibility persists without losing stars or geometry and the model widget is retired', async ({ page }) => {
  const rect = { x: 80, y: 190, width: 310, height: 240 };
  await page.evaluate(rect => localStorage.setItem('test.host.home', JSON.stringify({
    version: 3, favorites: ['orbit-notes:open'], clock: false, ai: true, widgets: [],
    rects: { favorites: rect }, editing: false, grid: false, gridSize: 20,
  })), rect);
  await page.reload();
  const favorites = page.locator('[data-widget-id="favorites"]');
  const picker = page.locator('.widget-picker summary');
  const toggle = page.getByRole('checkbox', { name: 'Preferiti', exact: true });
  await expect(favorites.getByRole('button', { name: 'Apri Appunti', exact: true })).toBeVisible();
  await expect(page.locator('[data-widget-id="ai"]')).toHaveCount(0);
  await picker.click();
  await expect(page.getByRole('checkbox', { name: 'Modello AI' })).toHaveCount(0);
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(favorites).toHaveCount(0);
  await page.reload();
  await expect(favorites).toHaveCount(0);
  await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
  await page.locator('.recovery summary').click();
  await expect(page.getByLabel('Elemento layout').locator('option[value="ai"], option[value="favorites"]')).toHaveCount(0);
  await page.locator('.recovery summary').click();
  await page.getByRole('button', { name: 'Termina modifica layout', exact: true }).click();
  await picker.click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(favorites.getByRole('button', { name: 'Apri Appunti', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test.host.home')!));
  expect(saved.favorites).toEqual(['orbit-notes:open']);
  expect(saved.rects.favorites).toEqual(rect);
  await page.reload();
  await expect(favorites).toBeVisible();
  await picker.click();
  await page.evaluate(() => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = api.invoke;
    api.invoke = (command, args) => command === 'save_home_layout' ? Promise.reject(new Error('Disco pieno')) : invoke(command, args);
  });
  await toggle.click();
  await expect(page.getByRole('alert')).toContainText('Disco pieno');
  await expect(toggle).toBeChecked();
  await expect(favorites).toBeVisible();
});

test('app widgets migrate, move, persist, fail safely and remain removable while unavailable', async ({ page }) => {
    page.on('pageerror', error => console.error('Widget page error:', error.message));
    await page.evaluate(() => {
      localStorage.setItem('test.host.home', JSON.stringify({ version: 1, favorites: ['orbit-notes:open'], clock: true, ai: true }));
    });
    await page.reload();
    await page.locator('.widget-picker summary').click();
    await page.getByRole('button', { name: 'Ultimi screenshot', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ultimi screenshot', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const widget = page.getByRole('region', { name: 'Ultimi screenshot', exact: true });
    await expect(widget.getByText('Nessuna immagine.', { exact: false })).toBeVisible();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('test.host.home')!));
    const initial = await saved();
    expect(initial).toMatchObject({ version: 3, ai: true, favorites: ['orbit-notes:open'] });
    expect(initial.widgets).toHaveLength(1);
    expect(await page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string }[] }).catalogTestCalls.some(c => c.command.startsWith('launch_app')))).toBe(false);
    await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
    const handle = widget.getByRole('button', { name: 'Sposta Ultimi screenshot' });
    await handle.press('ArrowRight');
    await expect.poll(async () => (await saved()).widgets[0].x).toBe(initial.widgets[0].x + 1);
    await page.reload();
    expect((await saved()).widgets[0].id).toBe(initial.widgets[0].id);
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 20, box!.y + 20);
    await page.mouse.down(); await page.mouse.move(box!.x - 400, box!.y + 20); await page.mouse.up();
    await expect.poll(async () => (await saved()).widgets[0].x).toBe(0);
    await expect(widget.locator('.widget-actions')).toHaveCount(0);
    expect((await saved()).widgets[0].x).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string }[] }).catalogTestCalls.some(c => c.command === 'launch_app_action'))).toBe(false);
    await page.setViewportSize({ width: 560, height: 800 });
    expect(await widget.evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.evaluate(() => {
      const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const original = api.invoke;
      api.invoke = (command, args) => command === 'save_home_layout' ? Promise.reject(new Error('Disco non disponibile')) : original(command, args);
    });
    await widget.getByRole('button', { name: 'Rimuovi Ultimi screenshot' }).click();
    await expect(page.getByRole('alert')).toContainText('Disco non disponibile');
    await expect(widget).toBeVisible();
    expect((await saved()).widgets).toHaveLength(1);
    await page.reload();
    await page.evaluate(async () => {
      const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await api.invoke('change_app', { id: 'orbit-capture', action: 'disable' });
      await api.invoke('open_tool', { tool: 'settings' });
      await api.invoke('open_tool', { tool: 'home' });
    });
    await expect(widget).toContainText('Widget non disponibile');
    await page.locator('.widget-picker summary').click();
    await expect(page.getByRole('button', { name: 'Ultimi screenshot', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('.recovery summary').click();
    await page.getByLabel('Elemento layout').selectOption(initial.widgets[0].id);
    await page.locator('.recovery summary').click();
    await widget.getByRole('button', { name: 'Rimuovi Ultimi screenshot' }).click();
    await expect(widget).toHaveCount(0);
    expect((await saved()).widgets).toEqual([]);
    expect((await saved()).favorites).toEqual(['orbit-notes:open']);
});

test('Tab navigates widgets, arrows follow the screenshot grid and Enter opens the focused original', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('test.host.home', JSON.stringify({
      version: 3, favorites: ['orbit-notes:open'], clock: false, ai: true,
      rects: {}, editing: false, grid: false, gridSize: 20,
      widgets: [{ id: 'keyboard-screens', appId: 'orbit-capture', widgetId: 'recent-captures', title: 'Ultimi screenshot',
        x: 20, y: 185, width: 310, height: 310, settings: { rows: 2, columns: 3 } }],
    }));
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = api.invoke;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ZcAAAAASUVORK5CYII=';
    api.invoke = (command, args) => command === 'get_widget_image' ? Promise.resolve(png)
      : command === 'get_widget_data' ? Promise.resolve({
        entries: Array.from({ length: 5 }, (_, i) => ({ name: `screen-${i}.png`, dataUrl: png })), warning: null,
      }) : invoke(command, args);
  });
  await page.reload();
  const source = () => page.evaluate(() => localStorage.getItem('test.host.home'));
  const before = await source();
  const widget = page.locator('[data-widget-id="keyboard-screens"]');
  const images = widget.locator('.image-preview');
  await expect(images).toHaveCount(5);
  const search = page.getByRole('textbox', { name: 'Cerca app e azioni' });
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(images.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(images.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(images.nth(4)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(images.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(images.nth(4)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(images.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Anteprima screenshot' });
  await expect(preview.getByRole('img', { name: 'screen-1.png' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(preview.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(images.nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-widget-id="favorites"] button').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(images.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  const options = widget.getByRole('button', { name: 'Impostazioni Ultimi screenshot' });
  await expect(options).toBeFocused();
  await page.keyboard.press('Enter');
  const settings = page.getByRole('dialog', { name: 'Ultimi screenshot' });
  await expect(settings).toBeVisible();
  await settings.getByLabel('Righe').focus();
  await page.keyboard.press('Tab');
  await expect(settings.getByLabel('Colonne')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(options).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(images.nth(0)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(search).toBeFocused();
  await page.keyboard.type('ab');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('c');
  await expect(search).toHaveValue('acb');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-widget-id="logo"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.locator('[data-widget-id="dock"] button').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-widget-id="dock"] button').nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Impostazioni', exact: true })).toBeFocused();
  expect(await source()).toBe(before);
});

test('widget settings persist rows and columns, scale thumbnails and keep failed saves recoverable', async ({ page }) => {
  await page.addInitScript(() => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = api.invoke;
    api.invoke = (command, args) => command === 'get_widget_image' ? Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ZcAAAAASUVORK5CYII=') : command === 'get_widget_data' ? Promise.resolve({
      entries: Array.from({ length: Number(args?.limit ?? 4) }, (_, i) => ({
        name: `screen-${i}.png`, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ZcAAAAASUVORK5CYII=',
      })), warning: null,
    }) : invoke(command, args);
  });
  await page.reload();
  await page.locator('.widget-picker summary').click();
  await page.getByRole('button', { name: 'Ultimi screenshot', exact: true }).click();
  await page.keyboard.press('Escape');
  const widget = page.getByRole('region', { name: 'Ultimi screenshot', exact: true });
  const settings = widget.getByRole('button', { name: 'Impostazioni Ultimi screenshot' });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('test.host.home')!));
  const before = (await saved()).widgets[0];
  await settings.click();
  const dialog = page.getByRole('dialog', { name: 'Ultimi screenshot' });
  await expect(dialog.getByLabel('Righe')).toHaveValue('2');
  await dialog.getByLabel('Righe').fill('3');
  await dialog.getByLabel('Colonne').fill('3');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  await expect(widget.locator('img')).toHaveCount(9);
  const thumbnail = widget.getByRole('button', { name: 'Ingrandisci screen-0.png', exact: true });
  await thumbnail.click();
  const preview = page.getByRole('dialog', { name: 'Anteprima screenshot' });
  await expect(preview.getByRole('img')).toBeVisible();
  await page.keyboard.type('abc');
  await expect(page.getByRole('textbox', { name: 'Cerca app e azioni' })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  expect((await saved()).widgets[0]).toEqual({ ...before, settings: { rows: 3, columns: 3 } });
  await page.reload();
  await expect(widget.locator('img')).toHaveCount(9);
  await page.getByRole('button', { name: 'Modifica layout', exact: true }).click();
  const size = await widget.locator('img').first().boundingBox();
  const corner = (await widget.locator('.se').boundingBox())!;
  await page.mouse.move(corner.x + 3, corner.y + 3); await page.mouse.down();
  await page.mouse.move(corner.x + 153, corner.y + 183); await page.mouse.up();
  await expect.poll(async () => (await widget.locator('img').first().boundingBox())!.height).toBeGreaterThan(size!.height);
  await expect(widget.locator('img').first()).toHaveCSS('object-fit', 'contain');
  await settings.click();
  await dialog.getByLabel('Righe').fill('1');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  expect((await saved()).widgets[0].settings.rows).toBe(3);
  await settings.click();
  await dialog.getByLabel('Righe').fill('1');
  await page.evaluate(() => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = api.invoke;
    api.invoke = (c, a) => c === 'save_home_layout' ? Promise.reject(new Error('Disco pieno')) : invoke(c, a);
  });
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Salvataggio non riuscito');
  expect((await saved()).widgets[0].settings.rows).toBe(3);
  await page.setViewportSize({ width: 360, height: 640 });
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: test.info().outputPath('widget-settings-compact.png') });
});

test('home launches apps and actions without hotkeys and persists starred shortcuts and widgets', async ({ page }) => {
  await page.evaluate(async () => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
    await api.invoke('set_action_shortcut', { id: 'orbit-notes', actionId: 'open', shortcut: '' });
    await api.invoke('set_action_shortcut', { id: 'orbit-notes', actionId: 'focus-editor', shortcut: '' });
  });
  await page.getByRole('button', { name: 'Torna allo spazio', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  const dock = page.getByRole('navigation', { name: 'Avvio rapido app' });
  await dock.getByRole('button', { name: 'Apri Appunti', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string; args: { id?: string } }[] }).catalogTestCalls.some(call => call.command === 'launch_app' && call.args.id === 'orbit-notes'))).toBe(true);
  const search = page.getByRole('textbox', { name: 'Cerca app e azioni' });
  await search.fill('Appunti');
  const results = page.getByRole('region', { name: 'Risultati app e azioni' });
  await expect(results.getByRole('button', { name: 'Esegui Scrivi un appunto', exact: true })).toBeEnabled();
  await expect(results.locator('kbd')).toHaveCount(0);
  await results.getByRole('button', { name: 'Aggiungi Scrivi un appunto ai preferiti', exact: true }).click();
  await expect(results.getByRole('button', { name: 'Rimuovi Scrivi un appunto dai preferiti', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string }[] }).catalogTestCalls.filter(call => call.command === 'launch_app_action').length)).toBe(0);
  await search.focus();
  await page.keyboard.press('Escape');
  await expect(search).toBeVisible();
  await expect(results).toHaveCount(0);
  const favorites = page.getByRole('region', { name: 'Preferiti', exact: true });
  await favorites.getByRole('button', { name: 'Esegui Scrivi un appunto', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string; args: { id?: string; actionId?: string } }[] }).catalogTestCalls.some(call => call.command === 'launch_app_action' && call.args.id === 'orbit-notes' && call.args.actionId === 'focus-editor'))).toBe(true);
  await page.locator('.widget-picker summary').click();
  await expect(page.getByRole('checkbox', { name: 'Orologio', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Ora corrente')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Preferiti', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Modello AI', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Orologio', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Modello AI', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(favorites.getByRole('button', { name: 'Esegui Scrivi un appunto', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Orologio', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Modello AI', exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('launcher-favorites.png') });
  await favorites.getByRole('button', { name: 'Rimuovi Scrivi un appunto dai preferiti', exact: true }).click();
  await page.reload();
  await expect(favorites.getByRole('button', { name: 'Esegui Scrivi un appunto', exact: true })).toHaveCount(0);
});

test('package review discloses network origins and requires explicit approval', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Strumenti', exact: true }).getByRole('button', { name: 'App e catalogo' }).click();
  await page.getByLabel('Pacchetto Orbit').setInputFiles({
    name: 'network.orbit', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest: { id: 'network-demo', name: 'Network demo', description: 'API client', version: '1.0.0', sdk: 1, permissions: [], network: { connect: ['https://api.example.com', 'wss://events.example.com'] } } })),
  });

  const review = page.getByRole('region', { name: 'Revisione pacchetto' });
  await expect(review.getByLabel('Destinazioni di rete autorizzate')).toContainText('https://api.example.com');
  await expect(review.getByLabel('Destinazioni di rete autorizzate')).toContainText('wss://events.example.com');
  await expect(review.getByText(/puo inviare dati/)).toBeVisible();
  await expect(review.getByRole('button', { name: 'Installa pacchetto' })).toBeDisabled();
  await review.getByRole('checkbox').check();
  await expect(review.getByRole('button', { name: 'Installa pacchetto' })).toBeEnabled();
});

test('language selection persists and updates the host without changing editable text', async ({ page }) => {
  await page.getByRole('tab', { name: 'Generali', exact: true }).click();
  await page.getByLabel('Lingua', { exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Search apps and actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
  await page.getByLabel('Language', { exact: true }).selectOption('it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
});

test('launcher handles disabled and hidden apps, keyboard search, empty results and small screens', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Strumenti', exact: true }).getByRole('button', { name: 'App e catalogo' }).click();
  await page.getByRole('button', { name: 'Disabilita Appunti', exact: true }).click();
  await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: object) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke('set_app_hidden', { id: 'orbit-timer', hidden: true }));
  await page.getByRole('button', { name: 'Torna allo spazio', exact: true }).click();
  const dock = page.getByRole('navigation', { name: 'Avvio rapido app' });
  await expect(dock.getByRole('button', { name: 'Apri Appunti', exact: true })).toHaveCount(0);
  await expect(dock.getByRole('button', { name: 'Apri Timer', exact: true })).toHaveCount(0);
  const search = page.getByRole('textbox', { name: 'Cerca app e azioni' });
  await search.fill('Appunti');
  const results = page.getByRole('region', { name: 'Risultati app e azioni' });
  await expect(results.getByRole('button', { name: 'Apri Appunti', exact: true })).toBeDisabled();
  await search.fill('Timer');
  await search.press('ArrowDown');
  await expect(results.getByRole('button', { name: 'Apri Timer', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(results).toHaveCount(0);
  await search.fill('no-matching-app');
  await expect(results.getByText(/Nessun risultato/)).toBeVisible();
  await search.press('Escape');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 600, height: 760 }, { width: 390, height: 700 }]) {
    await page.setViewportSize(viewport);
    expect(await page.locator('.launcher').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
    await expect(page.getByRole('button', { name: 'Impostazioni', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`launcher-${viewport.width}.png`) });
  }
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Generali', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Torna allo spazio', exact: true }).click();
  await expect(search).toBeVisible();
});

test('search arrows traverse results, skip disabled apps, scroll and launch the selected action', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Strumenti', exact: true }).getByRole('button', { name: 'App e catalogo' }).click();
  await page.getByRole('button', { name: 'Disabilita Appunti', exact: true }).click();
  await page.getByRole('button', { name: 'Torna allo spazio', exact: true }).click();
  await page.setViewportSize({ width: 600, height: 560 });
  const search = page.getByRole('textbox', { name: 'Cerca app e azioni' });
  await search.focus();
  await search.press('ArrowDown');
  const available = page.locator('.results-list .result-run:not(:disabled)');
  const count = await available.count();
  expect(count).toBeGreaterThan(2);
  await expect(available.nth(0)).toBeFocused();
  for (let index = 1; index < count; index++) {
    await page.keyboard.press('ArrowDown');
    await expect(available.nth(index)).toBeFocused();
  }
  await page.keyboard.press('ArrowDown');
  await expect(available.last()).toBeFocused();
  expect(await page.locator('.results-list').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const bounds = await available.last().boundingBox();
  const listBounds = await page.locator('.results-list').boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(listBounds!.y + listBounds!.height + 1);
  for (let index = count - 2; index >= 0; index--) {
    await page.keyboard.press('ArrowUp');
    await expect(available.nth(index)).toBeFocused();
  }
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  await search.fill('Timer');
  await search.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Esegui Avvia timer rapido', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as unknown as { catalogTestCalls: { command: string; args: { id?: string; actionId?: string } }[] }).catalogTestCalls.some(call => call.command === 'launch_app_action' && call.args.id === 'orbit-timer' && call.args.actionId === 'quick-timer'))).toBe(true);
  await search.fill('no-matching-app');
  await search.press('ArrowDown');
  await expect(search).toBeFocused();
});

test('corrupt home preferences are explicit and resettable', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('test.host.home', '{bad'));
  await page.reload();
  await expect(page.locator('.launcher-error')).toBeVisible();
  await page.getByRole('button', { name: 'Ripristina layout', exact: true }).click();
  await expect(page.locator('.launcher-error')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.launcher-error')).toHaveCount(0);
  await expect(page.getByLabel('Ora corrente')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Orologio', exact: true })).toHaveCount(0);
});

test('catalog uses responsive cards, icon actions, search and a secondary manual installer', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Strumenti', exact: true }).getByRole('button', { name: 'App e catalogo' }).click();
  const cards = page.locator('.package-card');
  await expect(cards).toHaveCount(3);
  const positions = await cards.evaluateAll(items => items.map(item => ({ x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y })));
  expect(positions[0].y).toBe(positions[1].y);
  expect(positions[0].x).not.toBe(positions[1].x);
  await page.locator('.app-shell').screenshot({ path: test.info().outputPath('catalog.png') });
  await expect(page.getByLabel('Pacchetto Orbit')).toBeHidden();
  await expect(page.getByRole('button', { name: /Installazione manuale/ })).toBeHidden();
  await page.locator('.install-menu summary').click();
  await expect(page.getByRole('button', { name: /Installazione manuale/ })).toBeVisible();
  await page.getByRole('button', { name: /Installazione manuale/ }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Installazione manuale/ })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'App e catalogo' })).toBeVisible();
  await page.getByLabel('Cerca app installate').fill('Appunti');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole('button', { name: 'Apri Appunti', exact: true })).toHaveText('');
  await cards.getByRole('button', { name: 'Disabilita Appunti', exact: true }).click();
  await expect(cards.getByText('Disabilitata', { exact: true })).toBeVisible();
  await page.getByLabel('Filtra app').selectOption('enabled');
  await expect(cards).toHaveCount(0);
  await page.setViewportSize({ width: 600, height: 760 });
  await page.getByLabel('Filtra app').selectOption('all');
  await expect(cards).toHaveCount(1);
  expect(await page.locator('.tool-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('app menu opens host settings without launching, saves preferences and handles shortcut conflicts', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Impostazioni delle app', exact: true });
  await nav.getByRole('button', { name: 'Impostazioni Appunti', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appunti', exact: true })).toBeVisible();
  const size = page.getByRole('spinbutton', { name: 'Dimensione testo' });
  await expect(size).toHaveValue('14');
  await size.fill('18');
  await page.getByRole('button', { name: 'Salva preferenze', exact: true }).click();
  await nav.getByRole('button', { name: 'Impostazioni Timer', exact: true }).click();
  await expect(page.getByLabel('Durata predefinita')).toHaveValue('300');
  await nav.getByRole('button', { name: 'Impostazioni Appunti', exact: true }).click();
  await expect(size).toHaveValue('18');
  const shortcut = page.getByRole('textbox', { name: 'Hotkey Scrivi un appunto', exact: true });
  await record(shortcut, 'Control+E');
  await page.getByRole('button', { name: 'Salva hotkey Scrivi un appunto' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ctrl+E' })).toContainText('riservate');
  await expect(page.getByRole('button', { name: 'Sostituisci assegnazioni' })).toHaveCount(0);
  await record(shortcut, 'Control+1');
  await page.getByRole('button', { name: 'Salva hotkey Scrivi un appunto' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ctrl+1' })).toContainText('Screenshot');
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  await record(page.getByRole('textbox', { name: 'Hotkey Apri / nascondi app', exact: true }), 'Control+Shift+5');
  await record(shortcut, 'Control+Shift+9');
  await page.getByRole('button', { name: 'Salva hotkey Scrivi un appunto' }).click();
  await expect(page.getByRole('status')).toContainText('Hotkey aggiornata');
  await expect(page.getByRole('textbox', { name: 'Hotkey Apri / nascondi app', exact: true })).toHaveValue('Ctrl+Shift+5');
  await page.locator('.app-shell').screenshot({ path: test.info().outputPath('app-settings.png') });
  const calls = await page.evaluate(() => (window as Window & { catalogTestCalls: { command: string }[] }).catalogTestCalls);
  expect(calls.some(call => call.command === 'launch_app')).toBe(false);
  await page.setViewportSize({ width: 600, height: 760 });
  expect(await page.locator('.tool-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('records Ctrl+2, cancels with Escape and removes the saved hotkey with the cross', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Impostazioni delle app', exact: true });
  await nav.getByRole('button', { name: 'Impostazioni Appunti', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Hotkey Scrivi un appunto', exact: true });
  await record(input, 'Control+2');
  await expect(input).toHaveValue('Ctrl+2');
  await page.getByRole('button', { name: 'Salva hotkey Scrivi un appunto' }).click();
  await input.click();
  await expect(input).toHaveAttribute('data-recording', 'ready');
  await input.press('Escape');
  await expect(input).toHaveValue('Ctrl+2');
  await expect(page.getByRole('heading', { name: 'Appunti', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rimuovi hotkey Scrivi un appunto' }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Rimuovi hotkey Scrivi un appunto' })).toHaveCount(0);
  await input.click();
  await expect(input).toHaveAttribute('data-recording', 'ready');
  await nav.getByRole('button', { name: 'Impostazioni Timer', exact: true }).click();
  const calls = await page.evaluate(() => (window as Window & {
    catalogTestCalls: { command: string; args: Record<string, unknown> }[];
  }).catalogTestCalls);
  expect(calls.filter(call => call.command === 'set_shortcut_recording').at(-1)?.args.active).toBe(false);
  expect(calls.some(call => call.command === 'set_action_shortcut' && call.args.shortcut === '')).toBe(true);
});

test('disabled apps leave the sidebar but remain configurable in the catalog', async ({ page }) => {
  const catalog = page.getByRole('navigation', { name: 'Strumenti', exact: true }).getByRole('button', { name: 'App e catalogo' });
  const nav = page.getByRole('navigation', { name: 'Impostazioni delle app', exact: true });
  await catalog.click();
  await page.getByRole('button', { name: 'Disabilita Appunti', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Impostazioni Appunti', exact: true })).toHaveCount(0);
  await page.locator('.package-card').getByRole('button', { name: 'Impostazioni Appunti', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appunti', exact: true })).toBeVisible();
  await expect(page.getByText('App disabilitata:', { exact: false })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Dimensione testo' }).fill('20');
  await page.getByRole('button', { name: 'Salva preferenze', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preferenze salvate');
  await catalog.click();
  await page.getByRole('button', { name: 'Abilita Appunti', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Impostazioni Appunti', exact: true })).toBeVisible();
  for (const name of ['Appunti', 'Timer', 'Screenshot']) {
    await page.getByRole('button', { name: `Disabilita ${name}`, exact: true }).click();
  }
  await expect(nav).toHaveCount(0);
  await expect(page.getByText('LE TUE APP', { exact: true })).toHaveCount(0);
  await expect(page.locator('.package-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Abilita Appunti', exact: true }).click();
  await nav.getByRole('button', { name: 'Impostazioni Appunti', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Dimensione testo' })).toHaveValue('20');
  const calls = await page.evaluate(() => (window as Window & { catalogTestCalls: { command: string }[] }).catalogTestCalls);
  expect(calls.some(call => call.command === 'launch_app')).toBe(false);
});

test('hidden app context menu preserves enablement and restores the sidebar entry', async ({ page }) => {
  expect(await page.evaluate(() => document.body.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
  ))).toBe(false);
  const nav = page.getByRole('navigation', { name: 'Impostazioni delle app', exact: true });
  const notes = nav.getByRole('button', { name: 'Impostazioni Appunti', exact: true });
  await notes.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Nascondi', exact: true }).click();
  await expect(notes).toHaveCount(0);
  const group = page.locator('.hidden-apps');
  await expect(group).not.toHaveAttribute('open', '');
  await group.locator('summary').click();
  const hidden = group.getByRole('button', { name: 'Impostazioni Appunti', exact: true });
  await hidden.click();
  await expect(page.getByText('Abilitata', { exact: true })).toBeVisible();
  await hidden.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Appunti', exact: true })).toBeVisible();
  await hidden.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mostra nel menu' }).click();
  await expect(notes).toBeVisible();
  await expect(group).toHaveCount(0);
  const calls = await page.evaluate(() => (window as Window & { catalogTestCalls: { command: string }[] }).catalogTestCalls);
  expect(calls.some(call => ['change_app', 'launch_app', 'set_action_shortcut'].includes(call.command))).toBe(false);
});
