<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { bridge, desktop, cropBrowserImage } from '../lib/bridge';
  import { fullCapture, pendingImage, activeTool, newConversation } from '../lib/state';
  import { selectionRect, toPixels } from '../lib/geometry';
  import type { Rect, ToolProps } from '../lib/types';
  let { context }: ToolProps = $props();
  let canvas: HTMLDivElement = $state()!;
  let start: { x: number; y: number } | null = $state(null);
  let rect: Rect | null = $state(null);
  let busy = $state(false);
  let fileInput: HTMLInputElement = $state()!;

  function point(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || busy || (event.target instanceof Element && event.target.closest('button'))) return;
    start = point(event); rect = null;
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (start) rect = selectionRect(start, point(event), canvas.getBoundingClientRect());
  }
  function pointerUp(event: PointerEvent) {
    if (!start) return;
    pointerMove(event); start = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    void confirm();
  }
  async function confirm() {
    const source = $fullCapture;
    if (!source || !rect || rect.width < 8 || rect.height < 8 || busy) return;
    busy = true;
    try {
      const pixelRect = toPixels(rect, canvas.getBoundingClientRect(), source);
      const cropped = desktop ? await bridge.crop(pixelRect) : await cropBrowserImage(source, pixelRect);
      if ($fullCapture !== source) return;
      if (desktop && !await bridge.finishCapture(cropped)) return;
      if ($fullCapture !== source) return;
      newConversation();
      pendingImage.set(cropped);
      fullCapture.set(null);
      activeTool.set('chat');
    } catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; }
  }
  function selectAll() {
    const bounds = canvas.getBoundingClientRect();
    rect = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    void confirm();
  }
  async function upload(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Seleziona un file PNG, JPEG o WebP.');
      if (file.size > 15 * 1024 * 1024) throw new Error('Il limite per la preview e 15 MB.');
      const url = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        if (image.width * image.height > 40_000_000) throw new Error('Immagine troppo grande (massimo 40 megapixel).');
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Immagine non valida.'));
          reader.onerror = () => reject(new Error('Lettura immagine non riuscita.'));
          reader.readAsDataURL(file);
        });
        fullCapture.set({ dataUrl, width: image.width, height: image.height });
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { context.notify(String(error), 'error'); }
  }
</script>

{#if $fullCapture}
  <!-- The canvas is a pointer selection surface; keyboard users can select the whole image. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="capture-canvas" bind:this={canvas} onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={() => { start = null; }}>
    <img class="screen-image" src={$fullCapture.dataUrl} alt="Schermata da selezionare" draggable="false" />
    {#if rect}
      <div class="selection-rect" style:left={`${rect.x}px`} style:top={`${rect.y}px`} style:width={`${rect.width}px`} style:height={`${rect.height}px`}><span class="selection-size">{Math.round(rect.width)} x {Math.round(rect.height)}</span></div>
    {:else}<div class="capture-dim"></div>{/if}
    <div class="capture-toolbar">
      <span class="tool-icon purple"><Icon name="scan" size={22} /></span>
      <div><strong>Seleziona un dettaglio</strong><small>{busy ? 'Preparazione immagine...' : 'Trascina e rilascia per aprire la chat. Nulla viene inviato automaticamente.'}</small></div>
      <button class="button secondary" onclick={selectAll} disabled={busy}>Seleziona tutto</button>
      <button class="icon-button" aria-label="Annulla cattura" onclick={context.hide}><Icon name="close" /></button>
    </div>
  </div>
{:else}
  <div class="page capture-empty">
    <span class="large-tool-icon"><Icon name="scan" size={40} /></span>
    <span class="eyebrow">CATTURA E CHIEDI</span><h1>Una schermata.<br />Una conversazione.</h1>
    <p>{desktop ? 'Cattura lo schermo sotto il cursore e seleziona un dettaglio.' : 'Nella preview, carica un’immagine per provare selezione e chat. Nell’app desktop Ctrl+1 cattura il monitor sotto il cursore.'}</p>
    {#if desktop}<button class="button primary" onclick={() => context.launch('capture')}><Icon name="scan" size={18} /> Cattura schermo <kbd>Ctrl 1</kbd></button>
    {:else}<input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onchange={upload} class="file-input" aria-label="Carica immagine" /><button class="button primary" onclick={() => fileInput.click()}><Icon name="image" size={18} /> Scegli immagine</button>{/if}
    <div class="privacy-note"><Icon name="shield" size={16} /> Solo l'area selezionata viene inviata, quando invii il messaggio in chat.</div>
  </div>
{/if}
