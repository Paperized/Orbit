import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { bridge } from './bridge';
import type { StreamEvent } from './types';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
  Channel: class { onmessage: (event: StreamEvent) => void = () => {}; },
}));

describe('desktop bridge', () => {
  it('serializes recorder focus transitions so a late start cannot override a stop', async () => {
    let finish: (warnings: string[]) => void = () => {};
    vi.mocked(invoke).mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue([]);
    const start = bridge.setShortcutRecording(true);
    const stop = bridge.setShortcutRecording(false);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    finish([]);
    await Promise.all([start, stop]);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['set_shortcut_recording', { active: true }],
      ['set_shortcut_recording', { active: false }],
    ]);
  });

  it('allows recorder cleanup after a failed start', async () => {
    vi.mocked(invoke).mockReset().mockRejectedValueOnce(new Error('Not focused')).mockResolvedValue([]);
    await expect(bridge.setShortcutRecording(true)).rejects.toThrow('Not focused');
    await expect(bridge.setShortcutRecording(false)).resolves.toEqual([]);
  });

  it('waits for the terminal channel event even when the command resolves first', async () => {
    let emit: (event: StreamEvent) => void = () => {};
    vi.mocked(invoke).mockImplementation(async (_, args) => {
      const channel = (args as { channel: { onmessage: (event: StreamEvent) => void } }).channel;
      emit = event => channel.onmessage(event);
    });
    let settled = false;
    const events: StreamEvent[] = [];
    const chat = bridge.chat('request', [{ role: 'user', content: 'Hi' }], event => events.push(event)).then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    emit({ requestId: 'request', kind: 'delta', text: 'Hello' });
    emit({ requestId: 'request', kind: 'done', text: '' });
    await chat;
    expect(events[0].text).toBe('Hello');
    expect(settled).toBe(true);
  });

  it('propagates validation failures that occur before a channel is opened', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Missing API key'));
    await expect(bridge.chat('request', [{ role: 'user', content: 'Hi' }], () => {})).rejects.toThrow('Missing API key');
  });
});
