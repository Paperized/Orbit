<script lang="ts">
  import { onMount } from 'svelte';
  import { bridge } from '../lib/bridge';
  import Icon from './Icon.svelte';
  import { containWidgetDialogTab } from '../lib/widget-navigation';
  let { appId, widgetId, name, close }: { appId: string; widgetId: string; name: string; close: () => void } = $props();
  let dialog: HTMLDialogElement;
  let image = $state(''), error = $state(''), loading = $state(true);
  let active = true;
  async function load() {
    loading = true; error = '';
    try { const value = await bridge.widgetImage(appId, widgetId, name); if (active) image = value; }
    catch (reason) { if (active) error = String(reason); }
    finally { if (active) loading = false; }
  }
  onMount(() => { dialog.showModal(); void load(); return () => { active = false; }; });
</script>

<dialog bind:this={dialog} aria-label="Anteprima screenshot" onclose={close}
  onkeydown={event => { event.stopPropagation(); containWidgetDialogTab(event, dialog); if (event.key === 'Escape') { event.preventDefault(); dialog.close(); } }}>
  <header><strong>{name}</strong><button class="icon-button" aria-label="Chiudi anteprima" onclick={() => dialog.close()}><Icon name="close" /></button></header>
  {#if loading}<p role="status">Caricamento immagine...</p>
  {:else if error}<p role="alert">{error}</p><button class="button secondary" onclick={load}>Riprova</button>
  {:else}<img src={image} alt={name} onerror={() => { error = "Impossibile visualizzare l'immagine."; }} />{/if}
</dialog>

<style>
  dialog{position:fixed;inset:0;margin:auto;width:min(1200px,calc(100vw - 40px));max-height:calc(100dvh - 40px);padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--bg);color:var(--orbit-text);overflow:auto}
  dialog::backdrop{background:#060810b3}
  header{display:flex;align-items:center;gap:16px;margin-bottom:12px}
  strong{flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px}
  img{display:block;width:100%;height:auto;max-height:calc(100dvh - 130px);object-fit:contain}
  p{padding:20px 0;font-size:13px}
</style>
