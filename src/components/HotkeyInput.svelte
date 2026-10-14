<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { bridge } from '../lib/bridge';
  import { shortcutFromKeyboard } from '../lib/shortcut';
  let { label, value = $bindable(''), disabled = false, onchange, onclear, onerror }: {
    label: string; value: string; disabled?: boolean;
    onchange: () => void; onclear: () => void; onerror: (error: string) => void;
  } = $props();
  let input: HTMLInputElement;
  let recording = $state(false);
  let ready = $state(false);
  let captured = $state(false);
  let previous = '';
  let generation = 0;
  async function start() {
    const current = ++generation;
    previous = value; recording = true; ready = false; captured = false;
    try {
      const warnings = await bridge.setShortcutRecording(true);
      if (warnings.length) onerror(warnings.join(' '));
      if (current === generation) ready = true;
    } catch (error) {
      if (current === generation) { recording = false; input?.blur(); }
      onerror(String(error));
    }
  }
  function stop() {
    ++generation;
    if (!recording) return;
    recording = false; ready = false;
    void bridge.setShortcutRecording(false).then(warnings => {
      if (warnings.length) onerror(warnings.join(' '));
    }).catch(error => onerror(String(error)));
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      value = previous; input.blur(); return;
    }
    if (!ready || event.repeat) return;
    if (['Backspace', 'Delete'].includes(event.key) && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      value = ''; captured = true; onchange(); return;
    }
    try {
      const shortcut = shortcutFromKeyboard(event);
      if (shortcut) { value = shortcut; captured = true; onchange(); }
    } catch (error) { onerror(String(error)); }
  }
  function keyup(event: KeyboardEvent) {
    if (recording && captured && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation(); input.blur();
    }
  }
  onDestroy(stop);
</script>

<svelte:window onblur={() => { input?.blur(); stop(); }} />
<div class="hotkey-input" class:recording>
  <input bind:this={input} aria-label={`Hotkey ${label}`} title="Premi la combinazione, poi conferma con Salva hotkey. Esc annulla."
    readonly {disabled} value={recording && !captured ? '' : value}
    placeholder={recording ? ready ? 'Premi la combinazione...' : 'Attendi...' : 'Seleziona una hotkey'}
    data-recording={recording ? ready ? 'ready' : 'starting' : undefined}
    onfocus={start} onblur={stop} onkeydown={keydown} onkeyup={keyup} />
  {#if value && !recording}
    <button class="icon-button clear-hotkey" aria-label={`Rimuovi hotkey ${label}`} title="Rimuovi hotkey" {disabled}
      onclick={() => { value = ''; onchange(); onclear(); }}><Icon name="close" size={14} /></button>
  {/if}
</div>

<style>
  .hotkey-input{position:relative;max-width:100%;min-width:0}
  .hotkey-input input{width:195px;max-width:100%;min-width:0;border:1px solid var(--line);border-radius:7px;padding:10px 32px 10px 10px;font-size:11px;background:var(--orbit-bg,#11121a);color:var(--orbit-text,#d0c2df);cursor:pointer}
  .recording input{border-color:var(--orbit-accent,#b998eb);outline:2px solid #b998eb33;cursor:default}
  .clear-hotkey{position:absolute;right:3px;top:50%;transform:translateY(-50%);width:26px;height:26px;padding:4px}
</style>
