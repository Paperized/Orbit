<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { bridge, desktop } from '../lib/bridge';
  import { conversations, selectedConversation, pendingImage, streamingId, chatError, chatDraft, settingsStatus, sendMessage, newConversation, deleteConversation } from '../lib/state';
  import type { ToolProps } from '../lib/types';
  let { context }: ToolProps = $props();
  let log: HTMLDivElement;
  let follow = $state(true);
  const chat = $derived($conversations.find(chat => chat.id === $selectedConversation));
  const messages = $derived(chat?.messages ?? []);
  const presets = $derived($pendingImage ? ['Spiegami cosa sto guardando', 'Estrai il testo', 'Traduci in italiano'] : ['Aiutami a ragionare su un’idea', 'Spiega un concetto in modo semplice', 'Scrivi un testo per me']);

  $effect(() => {
    const last = messages.at(-1)?.content;
    if (last !== undefined && follow) void tick().then(() => { if (log) log.scrollTop = log.scrollHeight; });
  });
  async function send() {
    if (!desktop) { context.notify('Le chiamate AI sono disponibili nell’app desktop.'); return; }
    if (!$chatDraft.trim() || $streamingId) return;
    const text = $chatDraft;
    chatDraft.set(''); follow = true;
    try { await sendMessage(text); }
    catch (error) { chatDraft.set(text); context.notify(String(error), 'error'); }
  }
  async function stop() {
    if (!$streamingId) return;
    try { await bridge.cancel($streamingId); }
    catch (error) { context.notify(String(error), 'error'); }
  }
</script>

<div class="chat-layout">
  <div class="chat-heading"><div><span class="eyebrow">UNO SPAZIO PER PENSARE</span><h2>{chat?.title ?? ($pendingImage ? 'Parliamo di questa schermata.' : 'Da dove iniziamo?')}</h2></div><button class="button secondary compact" disabled={!!$streamingId} onclick={newConversation}><Icon name="plus" size={16} /> Nuova chat</button></div>
  {#if $conversations.length > 1}
    <div class="conversation-switch"><label for="conversation">Conversazione</label><select id="conversation" disabled={!!$streamingId} value={$selectedConversation ?? ''} onchange={event => { selectedConversation.set(event.currentTarget.value || null); pendingImage.set(null); chatError.set(null); }}>
      <option value="">Nuova conversazione</option>{#each $conversations as item}<option value={item.id}>{item.title}</option>{/each}
    </select></div>
  {/if}
  <div class="chat-log" bind:this={log} role="log" aria-label="Messaggi" aria-live="off" onscroll={() => { follow = log.scrollHeight - log.scrollTop - log.clientHeight < 100; }}>
    {#if !messages.length}
      <div class="chat-welcome"><span class="chat-spark"><Icon name={$pendingImage ? 'scan' : 'spark'} size={36} /></span>
        <h2>{$pendingImage ? 'Il contesto e gia qui.' : 'Le buone idee iniziano con una domanda.'}</h2>
        <p>{$pendingImage ? 'Scrivi cosa vuoi sapere. Invieremo soltanto questa selezione al provider configurato.' : 'Una risposta veloce, un ragionamento insieme, un punto di vista diverso.'}</p>
        <div class="prompt-suggestions">{#each presets as text}<button onclick={() => chatDraft.set(text)}>{text}<Icon name="arrow" size={14} /></button>{/each}</div>
      </div>
    {/if}
    {#each messages as message}
      <div class:user-message={message.role === 'user'} class="message">
        <span class="message-avatar">{#if message.role === 'assistant'}<Icon name="spark" size={17} />{:else}Tu{/if}</span>
        <div class="message-body"><span class="message-author">{message.role === 'user' ? 'Tu' : 'Orbit'}</span>
          {#if message.image}<img class="message-image" src={message.image} alt="Area catturata inviata al provider" />{/if}
          <div class="message-text">{message.content}{#if message.role === 'assistant' && !message.content && $streamingId}<span class="thinking">In attesa della risposta...</span>{/if}</div>
        </div>
      </div>
    {/each}
    {#if $chatError}<div class="inline-error" role="alert"><strong>La risposta non e stata completata</strong><p>{$chatError}</p><button class="text-button" onclick={() => context.launch('settings')}>Controlla impostazioni AI <Icon name="arrow" size={14} /></button></div>{/if}
  </div>
  <div class="composer-area">
    {#if $pendingImage}<div class="attachment"><img src={$pendingImage.dataUrl} alt="Anteprima selezione da inviare" /><div><strong>Selezione pronta</strong><small>{$pendingImage.width} x {$pendingImage.height} px · non ancora inviata</small></div><button class="icon-button" aria-label="Rimuovi immagine" onclick={() => pendingImage.set(null)}><Icon name="close" size={16} /></button></div>{/if}
    <form class="composer" onsubmit={event => { event.preventDefault(); void send(); }}>
      <textarea aria-label="Messaggio" placeholder={$pendingImage ? 'Cosa vuoi sapere di questa schermata?' : 'Chiedi qualcosa...'} bind:value={$chatDraft} rows="2" maxlength="20000" disabled={!!$streamingId} onkeydown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } }}></textarea>
      <div class="composer-bottom"><button type="button" class="model-chip" onclick={() => context.launch('settings')}><span class="status-dot" class:unconfigured={!$settingsStatus?.settings.model}></span>{$settingsStatus?.settings.model || 'Configura un modello'}<Icon name="settings" size={13} /></button>
        {#if $streamingId}<button type="button" class="send-button stop" aria-label="Interrompi risposta" onclick={stop}><Icon name="stop" size={17} /></button>{:else}<button type="submit" class="send-button" aria-label="Invia messaggio" disabled={!$chatDraft.trim() || !desktop}><Icon name="send" size={20} /></button>{/if}
      </div>
    </form>
    <div class="composer-footnote"><span>{desktop ? 'Invio per inviare · Shift+Invio per andare a capo' : 'Preview UI: le chiamate AI sono disponibili nell’app desktop.'}</span>{#if chat}<button class="text-button muted" disabled={!!$streamingId} onclick={() => { try { deleteConversation(chat.id); } catch (error) { context.notify(String(error), 'error'); } }}><Icon name="trash" size={12} /> Elimina</button>{/if}</div>
    <p class="session-notice">Chat e immagini restano in memoria fino alla chiusura dell'app. Nascondere l'overlay non interrompe la risposta.</p>
  </div>
</div>
