<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { containWidgetDialogTab } from '../lib/widget-navigation';
  import { readWidgetGrid, widgetGrid, type WidgetInstance } from '../lib/widgets';
  import type { WidgetDeclaration, WidgetGrid } from '../../sdk/src';
  let { instance, definition, save, remove, close }: {
    instance: WidgetInstance; definition?: WidgetDeclaration;
    save: (grid: WidgetGrid) => Promise<boolean>; remove: () => Promise<boolean>; close: () => void;
  } = $props();
  let rows = $state(2), columns = $state(2);
  let busy = $state(false), error = $state('');
  let dialog: HTMLDialogElement;
  onMount(() => {
    const initial = widgetGrid(instance, definition);
    rows = initial.rows; columns = initial.columns;
    dialog.showModal();
  });
  async function apply(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    let grid: WidgetGrid;
    try {
      grid = readWidgetGrid({ rows, columns });
      if (grid.rows * grid.columns > (definition?.source.limit ?? 0)) {
        throw new Error(`Questa app permette fino a ${definition?.source.limit} anteprime.`);
      }
    } catch (reason) { error = String(reason); return; }
    busy = true;
    try { if (await save(grid)) dialog.close(); else error = 'Salvataggio non riuscito. Riprova.'; }
    finally { busy = false; }
  }
  async function removeWidget() {
    busy = true;
    try { if (await remove()) dialog.close(); else error = 'Rimozione non riuscita. Riprova.'; }
    finally { busy = false; }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="widget-settings-title" onclose={close}
  onkeydown={event => {
    event.stopPropagation();
    containWidgetDialogTab(event, dialog);
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) dialog.close(); }
  }} oncancel={event => { if (busy) event.preventDefault(); }}>
  <header><div><small>IMPOSTAZIONI WIDGET</small><h2 id="widget-settings-title">{instance.title}</h2></div>
    <button class="icon-button" aria-label="Chiudi impostazioni widget" disabled={busy} onclick={() => dialog.close()}><Icon name="close" size={19} /></button>
  </header>
  {#if definition?.grid}
    <form onsubmit={apply}>
      <p>Disponi le anteprime. Le immagini si adattano allo spazio del widget senza essere ritagliate.</p>
      <div class="grid-fields">
        <label>Righe<input type="number" min="1" max="6" step="1" required bind:value={rows} disabled={busy} /></label>
        <label>Colonne<input type="number" min="1" max="6" step="1" required bind:value={columns} disabled={busy} /></label>
      </div>
      <small>Fino a {definition.source.limit} immagini recenti. Le impostazioni valgono solo per questo widget.</small>
      <footer>
        <button type="button" class="button secondary" disabled={busy} onclick={() => { rows = definition!.grid!.rows; columns = definition!.grid!.columns; }}>Valori dell'app</button>
        <button type="submit" class="button primary" disabled={busy}>{busy ? 'Salvataggio...' : 'Salva'}</button>
      </footer>
    </form>
  {:else}<p>{definition ? "Questa app non espone impostazioni aggiuntive per il widget." : "Riattiva o reinstalla l'app per configurare il widget."}</p>{/if}
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
  <div class="remove-widget"><button disabled={busy} onclick={removeWidget}><Icon name="trash" size={16} />Rimuovi dalla home</button><small>L'app e i suoi contenuti restano disponibili.</small></div>
</dialog>

<style>
  dialog{position:fixed;inset:0;margin:auto;width:min(400px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--line);border-radius:16px;padding:22px;background:var(--bg);color:var(--orbit-text);box-shadow:0 24px 80px #0006}
  dialog::backdrop{background:#080a1466;backdrop-filter:blur(3px)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:20px}
  h2{font-size:18px;line-height:1.4;margin-top:5px}
  small{color:var(--muted);font-size:11px;line-height:1.6}
  p{font-size:13px;line-height:1.6;color:var(--muted)}
  .grid-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0 12px}
  label{display:flex;flex-direction:column;gap:8px;font-size:12px}
  input{min-width:0;width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:inherit;font:inherit}
  footer{display:flex;justify-content:space-between;gap:12px;margin:22px 0}
  .remove-widget{border-top:1px solid var(--line);padding-top:16px;display:flex;flex-direction:column;gap:8px}
  .remove-widget button{display:flex;gap:8px;align-items:center;text-align:left;padding:8px 0;color:var(--muted);font-size:12px}
  .remove-widget button:hover{color:var(--accent)}
  .settings-error{color:var(--orbit-text);padding:10px;border:1px solid var(--accent);border-radius:8px;margin:12px 0}
</style>
