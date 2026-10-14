<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { containWidgetDialogTab } from '../lib/widget-navigation';
  import { locale, text } from '../lib/locale';

  let { apps, hidden, save, close }: {
    apps: { id: string; name: string; unavailable: boolean; disabled: boolean }[];
    hidden: string[];
    save: (hidden: string[]) => Promise<boolean>;
    close: () => void;
  } = $props();
  let excluded = $state<string[]>([]);
  let busy = $state(false), error = $state('');
  let dialog: HTMLDialogElement;
  onMount(() => { excluded = [...hidden]; dialog.showModal(); });
  async function apply(event: SubmitEvent) {
    event.preventDefault();
    busy = true; error = '';
    try {
      if (await save(excluded)) dialog.close();
      else error = text($locale, 'Salvataggio non riuscito. Riprova.', 'Could not save. Try again.');
    } finally { busy = false; }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="dock-settings-title" onclose={close}
  onkeydown={event => {
    event.stopPropagation();
    containWidgetDialogTab(event, dialog);
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) dialog.close(); }
  }} oncancel={event => { if (busy) event.preventDefault(); }}>
  <header>
    <h2 id="dock-settings-title">{text($locale, 'Avvio rapido', 'Quick launch')}</h2>
    <button class="icon-button" aria-label={text($locale, 'Chiudi impostazioni widget', 'Close widget settings')} disabled={busy} onclick={() => dialog.close()}><Icon name="close" size={19} /></button>
  </header>
  <form onsubmit={apply}>
    <p>{text($locale, 'Scegli le app da mostrare nella barra. Le nuove app vengono aggiunte automaticamente.', 'Choose the apps shown in the bar. New apps are added automatically.')}</p>
    <div class="app-choices">
      {#each apps as app (app.id)}
        <label>
          <input type="checkbox" checked={!excluded.includes(app.id)} disabled={busy || app.disabled}
            onchange={event => { excluded = event.currentTarget.checked ? excluded.filter(id => id !== app.id) : [...excluded, app.id]; }} />
          <span>{app.name}{#if app.unavailable}<small>{text($locale, 'Non disponibile finche disabilitata o nascosta nel catalogo.', 'Unavailable while disabled or hidden in the catalog.')}</small>{/if}</span>
        </label>
      {:else}<p>{text($locale, 'Nessuna app installata.', 'No apps installed.')}</p>{/each}
    </div>
    {#if error}<p class="save-error" role="alert">{error}</p>{/if}
    <footer>
      <button type="button" class="button secondary" disabled={busy} onclick={() => { excluded = excluded.filter(id => apps.some(app => app.id === id && app.disabled)); }}>{text($locale, 'Mostra tutte', 'Show all')}</button>
      <button type="submit" class="button primary" disabled={busy}>{busy ? text($locale, 'Salvataggio...', 'Saving...') : text($locale, 'Salva', 'Save')}</button>
    </footer>
  </form>
</dialog>

<style>
  dialog{position:fixed;inset:0;margin:auto;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--line);border-radius:16px;padding:22px;background:var(--bg);color:var(--orbit-text)}
  dialog::backdrop{background:#080a1466;backdrop-filter:blur(3px)}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
  h2{font-size:18px}
  p{font-size:13px;line-height:1.6;color:var(--muted)}
  .app-choices{display:flex;flex-direction:column;gap:4px;margin:16px 0}
  label{display:flex;align-items:center;gap:12px;padding:10px 0;font-size:13px;overflow-wrap:anywhere}
  label span{min-width:0}input{accent-color:var(--accent);flex:none}
  small{display:block;font-size:11px;color:var(--muted);line-height:1.5;margin-top:4px}
  footer{display:flex;justify-content:space-between;gap:12px;margin-top:20px}
  .save-error{padding:10px;border:1px solid var(--accent);border-radius:8px}
</style>
