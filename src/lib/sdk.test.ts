import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { actions, ai, appearance, attachments, capture, context, files, lifecycle, locale, preferences, services, shortcuts, storage, timers, widgets, window as appWindow } from '../../sdk/src';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class { onmessage: (event: unknown) => void = () => {}; },
}));

beforeEach(() => { vi.mocked(invoke).mockReset(); vi.mocked(invoke).mockResolvedValue(null); });

describe('SDK v1', () => {
  it('reads global language and unsubscribes from live locale changes', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('en');
    expect(await locale.get()).toBe('en');
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'locale.get', args: {} });
    const handler = vi.fn();
    const off = locale.onChange(handler);
    globalThis.dispatchEvent(new CustomEvent('orbit:locale', { detail: 'it' }));
    expect(handler).toHaveBeenCalledWith('it');
    off();
    globalThis.dispatchEvent(new CustomEvent('orbit:locale', { detail: 'en' }));
    expect(handler).toHaveBeenCalledOnce();
  });
  it('reads declared widget data without caller-supplied package identity or path', async () => {
    await widgets.read('recent');
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'widgets.read', args: { widgetId: 'recent' } });
  });
  it('passes explicit interactive intent without a caller-supplied window identity', async () => {
    await services.call({ contract: 'image.receive', input: { image: { attachmentId: 'ref' } }, intent: 'interactive' });
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'services.call', args: {
      requestId: expect.any(String), contract: 'image.receive', version: 1,
      input: { image: { attachmentId: 'ref' } }, provider: null, actionId: null, intent: 'interactive',
    } });
  });
  it('distinguishes explicit hide from pin-aware dismissal and scopes pin state to the caller', async () => {
    await appWindow.hide();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'window.hide', args: {} });
    await appWindow.dismiss();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'window.dismiss', args: {} });
    await appWindow.setPinned(true);
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'window.pin', args: { pinned: true } });
    await appWindow.getState();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'window.state', args: {} });
    const handler = vi.fn();
    const remove = appWindow.onPinChange(handler);
    globalThis.dispatchEvent(new CustomEvent('orbit:pin', { detail: true }));
    expect(handler).toHaveBeenCalledWith(true);
    remove();
    globalThis.dispatchEvent(new CustomEvent('orbit:pin', { detail: false }));
    expect(handler).toHaveBeenCalledOnce();
  });
  it('uses opaque attachments and returns the saved app-relative path', async () => {
    const ref = { attachmentId: 'image-id' };
    await attachments.read(ref); await attachments.retain(ref); await attachments.release(ref);
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'attachments.release', args: ref });
    vi.mocked(invoke).mockResolvedValueOnce({ saved: true, path: 'screenshots/example.png' });
    expect(await attachments.save(ref)).toEqual({ saved: true, path: 'screenshots/example.png' });
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'attachments.save', args: ref });
  });
  it('passes read paths and app-relative writes through the sender-bound broker', async () => {
    await files.read('/external/example.txt');
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'files.read', args: { path: '/external/example.txt' } });
    await files.write('notes/example.txt', 'aGk=');
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'files.write', args: { path: 'notes/example.txt', base64: 'aGk=' } });
    await files.list();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'files.list', args: { path: '' } });
    await files.remove('notes/example.txt');
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'files.remove', args: { path: 'notes/example.txt' } });
  });
  it('routes versioned calls and cancels only the corresponding request', async () => {
    const controller = new AbortController();
    let complete: (value: unknown) => void = () => {};
    vi.mocked(invoke).mockImplementation((_, args) => {
      if (args && 'action' in args && args.action === 'services.call') return new Promise(resolve => { complete = resolve; });
      return Promise.resolve(null);
    });
    const result = services.call({ contract: 'image.capture', input: {}, provider: 'capture', signal: controller.signal });
    const call = vi.mocked(invoke).mock.calls[0][1] as { args: { requestId: string } };
    controller.abort();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'services.cancel', args: { requestId: call.args.requestId } });
    complete({ image: { attachmentId: 'result' } });
    expect(await result).toEqual({ image: { attachmentId: 'result' } });
    await expect(services.call({ contract: 'image.capture', input: {}, signal: controller.signal })).rejects.toThrow('annullata');
  });
  it('delivers cold and warm exported calls, typed results and cancellation signals', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Invalid export'));
    await expect(services.register({ wrong: () => null })).rejects.toThrow('Invalid export');
    vi.mocked(invoke).mockResolvedValueOnce([{ requestId: 'cold', actionId: 'echo', input: 4, callerName: 'Caller' }]);
    let signal: AbortSignal | undefined;
    const handler = vi.fn((input, context) => { signal = context.signal; return input; });
    expect(await services.register({ echo: handler })).toBe(true);
    expect(handler).toHaveBeenCalledWith(4, expect.objectContaining({ intent: 'service', callerName: 'Caller' }));
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'services.respond', args: { requestId: 'cold', output: 4, error: null } });
    handler.mockImplementationOnce((_, context) => new Promise(resolve => {
      signal = context.signal;
      context.signal.addEventListener('abort', () => resolve(null));
    }));
    globalThis.dispatchEvent(new CustomEvent('orbit:service', { detail: { requestId: 'warm', actionId: 'echo', input: 5, callerName: 'Caller', intent: 'interactive' } }));
    expect(handler).toHaveBeenLastCalledWith(5, expect.objectContaining({ intent: 'interactive' }));
    globalThis.dispatchEvent(new CustomEvent('orbit:service-cancel', { detail: 'warm' }));
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(vi.mocked(invoke).mock.calls.filter(([, args]) => args && 'action' in args && args.action === 'services.respond')).toHaveLength(1);
  });
  it('reads host appearance and unsubscribes from resolved theme changes', async () => {
    await appearance.get();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'appearance.get', args: {} });
    const handler = vi.fn();
    const unsubscribe = appearance.onChange(handler);
    globalThis.dispatchEvent(new CustomEvent('orbit:appearance', { detail: { mode: 'system', theme: 'light' } }));
    expect(handler).toHaveBeenCalledWith({ mode: 'system', theme: 'light' });
    unsubscribe();
    globalThis.dispatchEvent(new CustomEvent('orbit:appearance', { detail: { mode: 'dark', theme: 'dark' } }));
    expect(handler).toHaveBeenCalledOnce();
  });
  it('exposes own preferences and conflict queries without caller identity or replacement authority', async () => {
    await preferences.read();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'preferences.read', args: {} });
    await preferences.update({ 'font-size': 16 });
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'preferences.update', args: { 'font-size': 16 } });
    await shortcuts.list();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'shortcuts.list', args: {} });
    await shortcuts.check('focus', 'Ctrl+E');
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'shortcuts.check', args: { actionId: 'focus', shortcut: 'Ctrl+E' } });
    const changed = vi.fn();
    const unsubscribe = preferences.onChange(changed);
    globalThis.dispatchEvent(new CustomEvent('orbit:preferences', { detail: { 'font-size': 18 } }));
    expect(changed).toHaveBeenCalledWith({ 'font-size': 18 });
    unsubscribe();
    globalThis.dispatchEvent(new CustomEvent('orbit:preferences', { detail: {} }));
    expect(changed).toHaveBeenCalledOnce();
  });

  it('registers action handlers before draining cold-start requests and serializes later events', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Undeclared action'));
    await expect(actions.register({ missing: () => {} })).rejects.toThrow('Undeclared action');
    vi.mocked(invoke).mockResolvedValueOnce(['focus']);
    const handler = vi.fn(async () => {});
    expect(await actions.register({ focus: handler })).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'actions.register', args: ['focus'] });
    expect(handler).toHaveBeenCalledOnce();
    globalThis.dispatchEvent(new CustomEvent('orbit:action', { detail: 'focus' }));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    await expect(actions.register({ focus: handler })).rejects.toThrow('gia registrate');
  });
  it('uses one broker and never sends a caller-supplied app identity', async () => {
    await storage.write({ note: 'Hello' });
    expect(invoke).toHaveBeenCalledWith('app_request', { action: 'storage.write', args: { note: 'Hello' } });
    await context();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'context', args: {} });
    await timers.start('break', 'Pausa', 60);
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'timer.start', args: { id: 'break', label: 'Pausa', seconds: 60 } });
  });

  it('propagates permission failures rather than returning fake values', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Permission denied'));
    await expect(capture.select()).rejects.toThrow('Permission denied');
  });

  it('flushes beforeClose hooks and leaves the app open if a save fails', async () => {
    const cleanup = lifecycle.beforeClose(() => Promise.reject(new Error('Save failed')));
    await expect(appWindow.close()).rejects.toThrow('Save failed');
    expect(invoke).not.toHaveBeenCalled();
    cleanup();
    const save = vi.fn(async () => {});
    const remove = lifecycle.beforeClose(save);
    await appWindow.close();
    expect(save).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('app_request', { action: 'window.close', args: {} });
    remove();
  });

  it('streams to completion and exposes request-scoped cancellation', async () => {
    let channel: { onmessage: (event: unknown) => void } | undefined;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'app_chat') channel = (args as { channel: typeof channel }).channel;
      return null;
    });
    const events = vi.fn();
    const request = ai.chat([{ role: 'user', content: 'Hi' }], events);
    let finished = false;
    void request.done.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    await request.cancel();
    expect(invoke).toHaveBeenLastCalledWith('app_request', { action: 'ai.cancel', args: { requestId: expect.any(String) } });
    channel?.onmessage({ kind: 'delta', text: 'Hi' });
    channel?.onmessage({ kind: 'done', text: '' });
    await request.done;
    expect(events).toHaveBeenCalledTimes(2);
  });
});
