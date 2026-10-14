<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import type { ToolProps } from '../lib/types';
  let { context }: ToolProps = $props();
  let text = $state('');
  let saved = $state(true);
  let timer: ReturnType<typeof setTimeout>;
  const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
  function save() {
    try { localStorage.setItem('orbit.notes.v1', text); saved = true; }
    catch (error) { context.notify(`Impossibile salvare gli appunti: ${String(error)}`, 'error'); }
  }
  function change() {
    saved = false; clearTimeout(timer); timer = setTimeout(save, 400);
  }
  onMount(() => {
    try { text = localStorage.getItem('orbit.notes.v1') ?? ''; }
    catch (error) { context.notify(`Impossibile leggere gli appunti: ${String(error)}`, 'error'); }
    return () => { clearTimeout(timer); if (!saved) save(); };
  });
</script>

<div class="page notes-page">
  <div class="section-heading"><div><span class="eyebrow">FAI SPAZIO NELLA TESTA</span><h1>Appunti al volo<span class="accent-text">.</span></h1></div><span class="tool-icon peach"><Icon name="note" size={25} /></span></div>
  <p class="muted">Una nota da tenere vicina. Salvata solo su questo dispositivo, senza AI.</p>
  <textarea class="notes-editor" aria-label="Appunti" placeholder="Un'idea da non perdere..." bind:value={text} oninput={change} maxlength="100000"></textarea>
  <div class="notes-footer"><span><span class="status-dot"></span>{saved ? 'Salvato sul dispositivo' : 'Salvataggio...'}</span><span>{words} parole · {text.length} caratteri</span></div>
</div>
