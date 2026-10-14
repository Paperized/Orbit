import { writable, get } from 'svelte/store';
import { bridge } from './bridge';
import type { Capture, Conversation, InstalledApp, SettingsStatus } from './types';

export const installedApps = writable<InstalledApp[]>([]);
export const activeTool = writable('home');
export const fullCapture = writable<Capture | null>(null);
export const pendingImage = writable<Capture | null>(null);
export const conversations = writable<Conversation[]>([]);
export const selectedConversation = writable<string | null>(null);
export const settingsStatus = writable<SettingsStatus | null>(null);
export const streamingId = writable<string | null>(null);
export const chatError = writable<string | null>(null);
export const chatDraft = writable('');
export const visible = writable(true);

export function newConversation() {
  selectedConversation.set(null);
  pendingImage.set(null);
  chatError.set(null);
  chatDraft.set('');
}

export function deleteConversation(id: string) {
  if (get(streamingId)) throw new Error('Ferma la risposta prima di eliminare una chat.');
  conversations.update(items => items.filter(item => item.id !== id));
  if (get(selectedConversation) === id) newConversation();
}

export async function sendMessage(text: string) {
  if (get(streamingId)) throw new Error('Una risposta e gia in corso.');
  if (!text.trim()) return;
  let id = get(selectedConversation);
  if (!id && get(conversations).length >= 20) {
    throw new Error('Limite demo: 20 conversazioni in memoria. Elimina una chat prima di crearne un’altra.');
  }
  if (id && (get(conversations).find(item => item.id === id)?.messages.length ?? 0) >= 98) {
    throw new Error('Questa conversazione ha raggiunto il limite della demo. Apri una nuova chat.');
  }
  const image = get(pendingImage);
  const message = { role: 'user' as const, content: text.trim(), ...(image ? { image: image.dataUrl } : {}) };
  if (!id) {
    id = crypto.randomUUID();
    conversations.update(items => [{
      id: id!, title: text.trim().slice(0, 54), messages: [], updatedAt: Date.now(),
    }, ...items]);
    selectedConversation.set(id);
  }
  const conversationId = id;
  conversations.update(items => items.map(item => item.id === conversationId
    ? { ...item, messages: [...item.messages, message], updatedAt: Date.now() } : item));
  pendingImage.set(null);
  const history = get(conversations).find(item => item.id === conversationId)!.messages;
  const requestId = crypto.randomUUID();
  streamingId.set(requestId);
  chatError.set(null);
  conversations.update(items => items.map(item => item.id === conversationId
    ? { ...item, messages: [...item.messages, { role: 'assistant', content: '' }] } : item));
  try {
    await bridge.chat(requestId, history, event => {
      if (event.requestId !== requestId) return;
      if (event.kind === 'error') chatError.set(event.text);
      if (event.kind === 'cancelled') chatError.set('Risposta interrotta. Il testo gia ricevuto resta nella chat.');
      if (event.kind !== 'delta') return;
      conversations.update(items => items.map(item => {
        if (item.id !== conversationId) return item;
        const messages = [...item.messages];
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = { ...last, content: last.content + event.text };
        return { ...item, messages };
      }));
    });
  } catch (error) {
    chatError.set(String(error));
  } finally {
    streamingId.set(null);
    conversations.update(items => items.map(item => item.id === conversationId
      ? { ...item, messages: item.messages.filter(message => message.role !== 'assistant' || message.content.length > 0) } : item));
  }
}
