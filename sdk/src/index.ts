import { Channel, invoke } from '@tauri-apps/api/core';

export type ResizeDirection = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';
export interface Capture { dataUrl: string; width: number; height: number }
export interface Message { role: 'user' | 'assistant'; content: string; image?: string }
export interface StreamEvent { kind: 'delta' | 'done' | 'cancelled' | 'error'; text: string }
export interface Timer { id: string; label: string; deadline: number; fired: boolean }
export interface Context { id: string; name: string; version: string; sdk: number; platform: string; permissions: string[]; mode?: 'app' | 'interactive'; invocation?: { appId: string; actionId: string; requestId: string } | null }
export type ThemeMode = 'system' | 'light' | 'dark';
export type Locale = 'it' | 'en';
export interface Appearance { mode: ThemeMode; theme: 'light' | 'dark' }
export type PreferenceValue = string | number | boolean;
export type PreferenceValues = Record<string, PreferenceValue>;
export type PreferenceDefinition = {
  id: string; label: string; description?: string;
} & (
  | { type: 'boolean'; default: boolean }
  | { type: 'text'; default: string }
  | { type: 'number'; default: number; min: number; max: number }
  | { type: 'select'; default: string; options: { value: string; label: string }[] }
);
export interface AppAction { id: string; label: string; description?: string; shortcut?: string | null }
export interface ShortcutOwner { appId: string | null; actionId: string }
export interface ShortcutBinding extends ShortcutOwner {
  appName: string; label: string; shortcut: string | null; enabled: boolean; registered: boolean;
}

function request<T>(action: string, args: unknown = {}): Promise<T> {
  return invoke<T>('app_request', { action, args });
}

export const context = () => request<Context>('context');
export const locale = {
  get: () => request<Locale>('locale.get'),
  onChange(handler: (locale: Locale) => void) {
    const listener = (event: Event) => handler((event as CustomEvent<Locale>).detail);
    globalThis.addEventListener('orbit:locale', listener);
    return () => globalThis.removeEventListener('orbit:locale', listener);
  },
};
export const appearance = {
  get: () => request<ThemeMode>('appearance.get'),
  onChange(handler: (appearance: Appearance) => void) {
    const listener = (event: Event) => handler((event as CustomEvent<Appearance>).detail);
    globalThis.addEventListener('orbit:appearance', listener);
    return () => globalThis.removeEventListener('orbit:appearance', listener);
  },
};
export const preferences = {
  read: <T extends PreferenceValues = PreferenceValues>() => request<T>('preferences.read'),
  update: (values: PreferenceValues) => request<PreferenceValues>('preferences.update', values),
  onChange(handler: (values: PreferenceValues) => void) {
    const listener = (event: Event) => handler((event as CustomEvent<PreferenceValues>).detail);
    globalThis.addEventListener('orbit:preferences', listener);
    return () => globalThis.removeEventListener('orbit:preferences', listener);
  },
};
export const shortcuts = {
  list: () => request<ShortcutBinding[]>('shortcuts.list'),
  check: (actionId: string, shortcut: string) => request<ShortcutBinding[]>('shortcuts.check', { actionId, shortcut }),
};
let actionHandlers: Record<string, () => void | Promise<void>> | null = null;
let actionQueue = Promise.resolve();
function dispatchAction(id: string) {
  const run = async () => {
    if (!actionHandlers || !Object.hasOwn(actionHandlers, id)) throw new Error(`Azione non registrata: ${id}`);
    await actionHandlers[id]();
  };
  actionQueue = actionQueue.then(run, run);
  return actionQueue;
}
globalThis.addEventListener('orbit:action', event => {
  void dispatchAction((event as CustomEvent<string>).detail).catch(error => {
    globalThis.dispatchEvent(new CustomEvent('orbit:error', { detail: String(error) }));
  });
});
export const actions = {
  async register(handlers: Record<string, () => void | Promise<void>>): Promise<boolean> {
    if (actionHandlers) throw new Error('Le azioni sono gia registrate.');
    actionHandlers = { ...handlers };
    let pending: string[];
    try { pending = await request<string[]>('actions.register', Object.keys(handlers)); }
    catch (error) { actionHandlers = null; throw error; }
    for (const id of pending) await dispatchAction(id);
    return pending.length > 0;
  },
};
export const storage = {
  read: <T = Record<string, unknown>>() => request<T>('storage.read'),
  write: (value: unknown) => request<void>('storage.write', value),
};
export interface FileEntry { name: string; directory: boolean; bytes: number; modifiedMs: number }
export interface WidgetGrid { rows: number; columns: number }
export interface WidgetDeclaration {
  id: string; title: string; description: string; width: 1 | 2; height: 1 | 2;
  source: { type: 'recent-images'; path: string; limit: number };
  actions?: string[];
  grid?: WidgetGrid;
}
export interface WidgetContent { entries: { name: string; dataUrl: string }[]; warning: string | null }
export const widgets = {
  read: (widgetId: string) => request<WidgetContent>('widgets.read', { widgetId }),
};
export const files = {
  read: (path: string) => request<{ base64: string }>('files.read', { path }),
  list: (path = '') => request<FileEntry[]>('files.list', { path }),
  write: (path: string, base64: string) => request<{ path: string; bytes: number }>('files.write', { path, base64 }),
  remove: (path: string) => request<void>('files.remove', { path }),
};
export const capture = { select: () => request<Capture>('capture.select'), cancel: () => request<void>('capture.cancel') };
export interface AttachmentRef { attachmentId: string }
export const attachments = {
  create: (image: Capture) => request<AttachmentRef>('attachments.create', image),
  read: (reference: AttachmentRef) => request<Capture>('attachments.read', reference),
  retain: (reference: AttachmentRef) => request<void>('attachments.retain', reference),
  release: (reference: AttachmentRef) => request<void>('attachments.release', reference),
  save: (reference: AttachmentRef) => request<{ saved: true; path: string }>('attachments.save', reference),
};
export type ContractSchema =
  | { type: 'null' | 'boolean' | 'number' | 'attachment' }
  | { type: 'string'; maxLength?: number }
  | { type: 'array'; items: ContractSchema; maxItems: number }
  | { type: 'object'; properties: Record<string, ContractSchema>; required?: string[] };
export type InvocationMode = 'service' | 'interactive';
export interface PublicAction { id: string; title: string; description: string; contract: string; version: number; accepts?: string[]; mode?: 'request' | 'handoff'; invocationModes?: InvocationMode[]; interactiveEntry?: string | null }
export interface Contract { id: string; version: number; input: ContractSchema; output: ContractSchema }
export interface Dependency { contract: string; version: number; required?: boolean; provider?: string | null }
export interface Destination { appId: string; appName: string; feature: PublicAction }
export interface ServiceContext { signal: AbortSignal; callerName: string; intent: InvocationMode }
interface Invocation { requestId: string; actionId: string; input: unknown; callerName: string; intent?: InvocationMode }
type ServiceHandler = (input: unknown, context: ServiceContext) => unknown | Promise<unknown>;
let serviceHandlers: Record<string, ServiceHandler> | null = null;
const serviceControllers = new Map<string, AbortController>();
async function handleService(invocation: Invocation) {
  const controller = new AbortController();
  serviceControllers.set(invocation.requestId, controller);
  try {
    if (!serviceHandlers || !Object.hasOwn(serviceHandlers, invocation.actionId)) throw new Error('Funzione pubblica non registrata.');
    const output = await serviceHandlers[invocation.actionId](invocation.input, { signal: controller.signal, callerName: invocation.callerName, intent: invocation.intent ?? 'service' });
    if (!controller.signal.aborted) await request('services.respond', { requestId: invocation.requestId, output: output ?? null, error: null });
  } catch (error) {
    if (!controller.signal.aborted) {
      await request('services.respond', { requestId: invocation.requestId, output: null, error: String(error) });
    }
  } finally { serviceControllers.delete(invocation.requestId); }
}
function serviceError(error: unknown) { globalThis.dispatchEvent(new CustomEvent('orbit:error', { detail: String(error) })); }
globalThis.addEventListener('orbit:service', event => { void handleService((event as CustomEvent<Invocation>).detail).catch(serviceError); });
globalThis.addEventListener('orbit:service-cancel', event => { serviceControllers.get((event as CustomEvent<string>).detail)?.abort(); });
export const services = {
  list: (contract: string, version = 1, mime?: string) => request<Destination[]>('services.list', { contract, version, mime: mime ?? null }),
  async register(handlers: Record<string, ServiceHandler>) {
    if (serviceHandlers) throw new Error('Funzioni pubbliche gia registrate.');
    serviceHandlers = { ...handlers };
    let pending: Invocation[];
    try { pending = await request<Invocation[]>('services.register', Object.keys(handlers)); }
    catch (error) { serviceHandlers = null; throw error; }
    for (const invocation of pending) await handleService(invocation);
    return pending.length > 0;
  },
  async call<T = unknown>(options: { contract: string; version?: number; input: unknown; provider?: string; actionId?: string; signal?: AbortSignal; intent?: InvocationMode }): Promise<T> {
    const { signal } = options;
    if (signal?.aborted) throw new Error('Richiesta annullata.');
    const requestId = crypto.randomUUID();
    const cancel = () => { void request('services.cancel', { requestId }).catch(serviceError); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await request<T>('services.call', { requestId, contract: options.contract, version: options.version ?? 1, input: options.input, provider: options.provider ?? null, actionId: options.actionId ?? null, ...(options.intent ? { intent: options.intent } : {}) });
    } finally { signal?.removeEventListener('abort', cancel); }
  },
};
export const timers = {
  list: () => request<Timer[]>('timer.list'),
  start: (id: string, label: string, seconds: number) => request<Timer>('timer.start', { id, label, seconds }),
  cancel: (id: string) => request<void>('timer.cancel', { id }),
};

const closeHooks = new Set<() => void | Promise<void>>();
let closing = false;
export const lifecycle = {
  beforeClose(handler: () => void | Promise<void>) {
    closeHooks.add(handler);
    return () => { closeHooks.delete(handler); };
  },
};
export const window = {
  async close() {
    if (closing) return;
    closing = true;
    try {
      for (const hook of closeHooks) await hook();
      await request<void>('window.close');
    } finally { closing = false; }
  },
  hide: () => request<void>('window.hide'),
  dismiss: () => request<void>('window.dismiss'),
  getState: () => request<{ pinned: boolean; visible: boolean }>('window.state'),
  setPinned: (pinned: boolean) => request<void>('window.pin', { pinned }),
  onPinChange(handler: (pinned: boolean) => void) {
    const listener = (event: Event) => handler((event as CustomEvent<boolean>).detail);
    globalThis.addEventListener('orbit:pin', listener);
    return () => globalThis.removeEventListener('orbit:pin', listener);
  },
  drag: () => request<void>('window.drag'),
  resize: (direction: ResizeDirection) => request<void>('window.resize', { direction }),
};
globalThis.addEventListener('orbit:close', () => {
  void window.close().catch(error => {
    globalThis.dispatchEvent(new CustomEvent('orbit:error', { detail: String(error) }));
  });
});

export const ai = {
  chat(messages: Message[], onEvent: (event: StreamEvent) => void) {
    const requestId = crypto.randomUUID();
    let complete: () => void = () => {};
    const terminal = new Promise<void>(resolve => { complete = resolve; });
    const channel = new Channel<StreamEvent>();
    channel.onmessage = event => {
      try { onEvent(event); }
      finally { if (event.kind !== 'delta') complete(); }
    };
    const done = Promise.all([
      invoke<void>('app_chat', { requestId, messages, channel }),
      terminal,
    ]).then(() => {});
    return { done, cancel: () => request<void>('ai.cancel', { requestId }) };
  },
};
