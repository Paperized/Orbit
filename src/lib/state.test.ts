import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { bridge } from './bridge';
import { conversations, selectedConversation, pendingImage, streamingId, chatError, sendMessage, newConversation, deleteConversation } from './state';

vi.mock('./bridge', () => ({ bridge: { chat: vi.fn(), cancel: vi.fn() } }));
beforeEach(() => {
  conversations.set([]); selectedConversation.set(null); pendingImage.set(null);
  streamingId.set(null); chatError.set(null); vi.resetAllMocks();
});

describe('shared chat lifecycle', () => {
  it('sends the selected image, streams text and retains conversation on hide/navigation', async () => {
    pendingImage.set({ dataUrl: 'data:image/png;base64,YQ==', width: 1, height: 1 });
    vi.mocked(bridge.chat).mockImplementation(async (id, messages, emit) => {
      expect(messages[0].image).toContain('data:image/png');
      expect(messages).toHaveLength(1);
      emit({ requestId: id, kind: 'delta', text: 'Hello ' });
      emit({ requestId: id, kind: 'delta', text: 'world' });
      emit({ requestId: id, kind: 'done', text: '' });
    });
    await sendMessage('Explain this');
    expect(get(conversations)[0].messages[1].content).toBe('Hello world');
    expect(get(pendingImage)).toBeNull();
    expect(get(streamingId)).toBeNull();
    newConversation();
    expect(get(conversations)).toHaveLength(1);
  });
  it('includes earlier images in follow-up context', async () => {
    pendingImage.set({ dataUrl: 'data:image/png;base64,YQ==', width: 1, height: 1 });
    vi.mocked(bridge.chat).mockImplementation(async (id, _, emit) => {
      emit({ requestId: id, kind: 'delta', text: 'Description' });
    });
    await sendMessage('Describe');
    await sendMessage('Explain more');
    expect(vi.mocked(bridge.chat).mock.calls[1][1][0].image).toBe('data:image/png;base64,YQ==');
    expect(vi.mocked(bridge.chat).mock.calls[1][1]).toHaveLength(3);
  });
  it('surfaces failures and removes the empty assistant bubble', async () => {
    vi.mocked(bridge.chat).mockRejectedValue(new Error('Provider unavailable'));
    await sendMessage('Hi');
    expect(get(chatError)).toContain('Provider unavailable');
    expect(get(conversations)[0].messages).toHaveLength(1);
    expect(get(streamingId)).toBeNull();
  });
  it('does not allow concurrent sends or deletion of an active conversation', async () => {
    streamingId.set('running');
    await expect(sendMessage('Hi')).rejects.toThrow('gia in corso');
    expect(() => deleteConversation('id')).toThrow('Ferma la risposta');
    expect(bridge.chat).not.toHaveBeenCalled();
  });
  it('ignores chunks from unrelated requests', async () => {
    vi.mocked(bridge.chat).mockImplementation(async (_, __, emit) => {
      emit({ requestId: 'other', kind: 'delta', text: 'wrong response' });
    });
    await sendMessage('Hi');
    expect(get(conversations)[0].messages).toHaveLength(1);
  });
});
