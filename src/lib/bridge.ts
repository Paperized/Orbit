import { invoke, isTauri, Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { defaultHomeLayout, homeLayoutKey, readHomeLayout, saveHomeLayout, type HomeLayout } from './launcher';
import type { ThemeMode, DependencyStatus } from './types';
import type { Capture, ChatMessage, InstalledApp, PackagePreview, OpenPayload, Rect, ResizeDirection, Settings, SettingsStatus, StreamEvent, PreferenceValues, ShortcutBinding, ShortcutOwner } from './types';

export const desktop = isTauri();
export const defaults: Settings = {
  provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '',
  agentEnabled: false, agentExecutable: 'opencode',
};

function requireDesktop() {
  if (!desktop) throw new Error('Disponibile nell’app desktop. Questa e una preview dell’interfaccia.');
}

let recordingQueue: Promise<string[]> = Promise.resolve([]);

export const bridge = {
  async getLocale(): Promise<import('../../sdk/src').Locale> {
    if (desktop) return invoke('get_locale');
    const value = localStorage.getItem('orbit.locale') ?? 'it';
    if (value !== 'it' && value !== 'en') throw new Error('Lingua salvata non valida.');
    return value;
  },
  async setLocale(locale: import('../../sdk/src').Locale): Promise<void> {
    if (desktop) await invoke('set_locale', { locale });
    else localStorage.setItem('orbit.locale', locale);
  },
  async widgetImage(appId: string, widgetId: string, name: string): Promise<string> {
    requireDesktop(); return invoke('get_widget_image', { appId, widgetId, name });
  },
  async widgetData(appId: string, widgetId: string, limit?: number): Promise<import('../../sdk/src').WidgetContent> {
    requireDesktop(); return invoke('get_widget_data', { appId, widgetId, ...(limit === undefined ? {} : { limit }) });
  },
  async dataLocation(): Promise<string> { requireDesktop(); return invoke('data_location'); },
  async getHomeLayout(): Promise<HomeLayout> {
    if (!desktop) return readHomeLayout(localStorage);
    const raw = await invoke<string | null>('get_home_layout');
    if (raw !== null) return readHomeLayout({ getItem: () => raw });
    const legacy = localStorage.getItem(homeLayoutKey);
    const layout = legacy === null ? defaultHomeLayout() : readHomeLayout({ getItem: () => legacy });
    await invoke('save_home_layout', { source: JSON.stringify(layout) });
    if (legacy !== null) localStorage.removeItem(homeLayoutKey);
    return layout;
  },
  async saveHomeLayout(layout: HomeLayout): Promise<void> {
    if (desktop) await invoke('save_home_layout', { source: JSON.stringify(layout) });
    else saveHomeLayout(localStorage, layout);
  },
  setShortcutRecording(active: boolean): Promise<string[]> {
    const change = () => desktop ? invoke<string[]>('set_shortcut_recording', { active }) : Promise.resolve([]);
    recordingQueue = recordingQueue.then(change, change);
    return recordingQueue;
  },
  async hideApp(id: string, hidden: boolean): Promise<void> { requireDesktop(); return invoke('set_app_hidden', { id, hidden }); },
  async dependencies(): Promise<DependencyStatus[]> { return desktop ? invoke('dependency_status') : []; },
  async getTheme(): Promise<ThemeMode> {
    if (desktop) return invoke('get_theme');
    const value = localStorage.getItem('orbit.theme');
    if (value !== null && !['system', 'light', 'dark'].includes(value)) throw new Error('Tema salvato non valido.');
    return (value as ThemeMode | null) ?? 'system';
  },
  async setTheme(mode: ThemeMode): Promise<void> {
    if (desktop) await invoke('set_theme', { mode });
    else {
      localStorage.setItem('orbit.theme', mode);
      window.dispatchEvent(new CustomEvent('orbit:theme', { detail: mode }));
    }
  },
  async listApps(): Promise<InstalledApp[]> { return desktop ? invoke('list_apps') : []; },
  async starterPackages(): Promise<string[]> { return desktop ? invoke('starter_packages') : []; },
  async previewPackage(source: string): Promise<PackagePreview> { requireDesktop(); return invoke('preview_package', { source }); },
  async installPackage(source: string, digest: string): Promise<string[]> { requireDesktop(); return invoke('install_package', { source, digest }); },
  async changeApp(id: string, action: string, deleteData = false): Promise<string[]> { requireDesktop(); return invoke('change_app', { id, action, deleteData }); },
  async setAppShortcut(id: string, shortcut: string): Promise<string[]> { requireDesktop(); return invoke('set_app_shortcut', { id, shortcut }); },
  async listShortcuts(): Promise<ShortcutBinding[]> { return desktop ? invoke('list_shortcuts') : []; },
  async checkAppShortcut(id: string, actionId: string, shortcut: string): Promise<ShortcutBinding[]> { requireDesktop(); return invoke('check_app_shortcut', { id, actionId, shortcut }); },
  async setActionShortcut(id: string, actionId: string, shortcut: string, replace: ShortcutOwner[] | null = null): Promise<string[]> {
    requireDesktop(); return invoke('set_action_shortcut', { id, actionId, shortcut, replace });
  },
  async getAppPreferences(id: string): Promise<PreferenceValues> { requireDesktop(); return invoke('get_app_preferences', { id }); },
  async setAppPreferences(id: string, values: PreferenceValues, reset = false): Promise<PreferenceValues> {
    requireDesktop(); return invoke('set_app_preferences', { id, values, reset });
  },
  async launchPackage(id: string) { requireDesktop(); await invoke('launch_app', { id }); },
  async launchPackageAction(id: string, actionId: string) { requireDesktop(); await invoke('launch_app_action', { id, actionId }); },
  async open(tool: string) { requireDesktop(); await invoke('open_tool', { tool }); },
  async hide() { requireDesktop(); await invoke('hide_overlay'); },
  async ready() { requireDesktop(); await invoke('frontend_ready'); },
  async onOpen(handler: (payload: OpenPayload) => void) {
    return listen<OpenPayload>('overlay-open', event => handler(event.payload));
  },
  async onError(handler: (message: string) => void) {
    return listen<string>('app-error', event => handler(event.payload));
  },
  async onHidden(handler: () => void) {
    return listen('overlay-hidden', handler);
  },
  async crop(rect: Rect): Promise<Capture> { requireDesktop(); return invoke('crop_capture', { rect }); },
  async finishCapture(capture: Capture): Promise<boolean> { requireDesktop(); return invoke('finish_capture', { capture }); },
  async dragPanel() {
    requireDesktop();
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  },
  async resizePanel(direction: ResizeDirection) {
    requireDesktop();
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startResizeDragging(direction);
  },
  async discardCapture() { if (desktop) await invoke('discard_capture'); },
  async getSettings(): Promise<SettingsStatus> {
    if (!desktop) return { settings: { ...defaults }, hasKey: false };
    return invoke('get_settings');
  },
  async saveSettings(settings: Settings, apiKey: string | null, deleteKey: boolean): Promise<SettingsStatus> {
    requireDesktop();
    return invoke('save_settings', { settings, apiKey, deleteKey });
  },
  async testProvider(): Promise<string> { requireDesktop(); return invoke('test_provider'); },
  async checkAgent(executable: string): Promise<string> {
    requireDesktop();
    return invoke('check_agent', { executable });
  },
  async chat(requestId: string, messages: ChatMessage[], handler: (event: StreamEvent) => void) {
    requireDesktop();
    const channel = new Channel<StreamEvent>();
    let finish: () => void;
    const completed = new Promise<void>(resolve => { finish = resolve; });
    channel.onmessage = event => {
      handler(event);
      if (event.kind !== 'delta') finish();
    };
    await Promise.all([invoke('stream_chat', { requestId, messages, channel }), completed]);
  },
  async cancel(requestId: string) { requireDesktop(); await invoke('cancel_chat', { requestId }); },
  async quit() { requireDesktop(); await invoke('quit_app'); },
};

export async function cropBrowserImage(source: Capture, rect: Rect): Promise<Capture> {
  const image = new Image();
  image.src = source.dataUrl;
  await image.decode();
  const ratio = Math.min(1, 1800 / Math.max(rect.width, rect.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Impossibile elaborare l’immagine.');
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
