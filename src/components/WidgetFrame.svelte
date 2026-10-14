<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { edges, fitRect, manipulate, type Rect, type Bounds, type Edge } from '../lib/layout-geometry';
  let { id, title, rect, bounds, editing, grid, step, disabled = false, selected = false, change, activity, select, remove, options, children, titlebar = false, toggleInteraction, clickThrough = false }: {
    id: string; title: string; rect: Rect; bounds: Bounds; editing: boolean; grid: boolean; step: number;
    disabled?: boolean; selected?: boolean; change: (rect: Rect) => void; activity: (active: boolean) => void;
    select: (id: string) => void; remove?: () => void; options?: () => void; children: Snippet;
    titlebar?: boolean; toggleInteraction?: () => void; clickThrough?: boolean;
  } = $props();
  let drag = $state<{ edge: Edge; x: number; y: number; original: Rect; next: Rect; pointer: number; target: HTMLElement } | null>(null);
  const display = $derived(drag?.next ?? fitRect(rect, bounds));
  function start(event: PointerEvent, edge: Edge) {
    if (disabled || event.button !== 0 || drag) return;
    event.preventDefault(); event.stopPropagation(); select(id);
    const target = event.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    const original = fitRect(rect, bounds);
    drag = { edge, x: event.clientX, y: event.clientY, original, next: original, pointer: event.pointerId, target };
    activity(true);
  }
  function move(event: PointerEvent) {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.next = manipulate(drag.original, drag.edge, event.clientX - drag.x, event.clientY - drag.y, bounds, grid, step);
  }
  function finish(commit: boolean) {
    if (!drag) return;
    const current = drag; drag = null; activity(false);
    if (current.target.hasPointerCapture(current.pointer)) current.target.releasePointerCapture(current.pointer);
    if (commit && JSON.stringify(current.original) !== JSON.stringify(current.next)) change(current.next);
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finish(false); return; }
    if (disabled || event.target !== event.currentTarget) return;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault(); event.stopPropagation(); select(id);
    const unit = grid ? step : event.altKey ? 10 : 1;
    change(manipulate(display, event.shiftKey ? 'se' : 'move', d[0] * unit, d[1] * unit, bounds, grid, step));
  }
</script>

<svelte:window onkeydown={event => { if (drag && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(false); } }}
  onresize={() => finish(false)} onblur={() => finish(false)} />
<!-- svelte-ignore a11y_no_noninteractive_tabindex (Named widget regions are keyboard navigation stops.) -->
<section class="widget-frame" class:editing class:selected class:dragging={!!drag} aria-label={title} data-widget-id={id}
  tabindex={editing ? undefined : 0}
  aria-describedby={editing ? undefined : 'widget-keyboard-help'}
  style:left={`${display.x}px`} style:top={`${display.y}px`} style:width={`${display.width}px`} style:height={`${display.height}px`}>
  {#if editing}
    <header>
      <button class="widget-handle" aria-label={`Sposta ${title}`} title="Trascina · frecce: sposta · Maiusc+frecce: ridimensiona"
        {disabled} onpointerdown={event => start(event, 'move')} onpointermove={move} onpointerup={() => finish(true)}
        onpointercancel={() => finish(false)} onlostpointercapture={() => finish(false)} onkeydown={keyboard}>⠿ {title}</button>
      {#if remove}<button class="widget-remove" aria-label={`Rimuovi ${title}`} {disabled} onclick={remove}>×</button>{/if}
      {#if toggleInteraction}<button class="widget-options-button" aria-label={`Lascia passare i clic: ${title}`} aria-pressed={clickThrough}
        title={clickThrough ? 'I clic passano sotto il widget' : 'Widget interattivo'} {disabled} onclick={toggleInteraction}><Icon name={clickThrough ? 'eye' : 'pointer'} size={16} /></button>{/if}
      {#if options}<button class="widget-options-button" aria-label={`Impostazioni ${title}`} title="Impostazioni widget" aria-haspopup="dialog" {disabled} onclick={options}><Icon name="more" size={20} /></button>{/if}
    </header>
  {:else if remove || titlebar}
    <header class="widget-title"><strong>{title}</strong>
      {#if options}<button class="widget-options-button" aria-label={`Impostazioni ${title}`} title="Impostazioni widget" aria-haspopup="dialog" {disabled} onclick={options}><Icon name="more" size={20} /></button>{/if}
    </header>
  {/if}
  <div class="widget-content">{@render children()}</div>
  {#if editing}
    {#each edges as edge}
      <button class={`resize-edge ${edge}`} aria-label={`Ridimensiona ${title} ${edge}`} title="Trascina per ridimensionare" tabindex="-1" {disabled}
        onpointerdown={event => start(event, edge)} onpointermove={move} onpointerup={() => finish(true)}
        onpointercancel={() => finish(false)} onlostpointercapture={() => finish(false)} onkeydown={keyboard}></button>
    {/each}
  {/if}
</section>

<style>
  .widget-frame{position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;border-radius:14px;overflow:hidden;background:var(--hub-surface,#151722eb)}
  .widget-content{flex:1;min-width:0;min-height:0;overflow:auto;display:flex;flex-direction:column}
  .widget-content>:global(.glass){border:0;box-shadow:none;border-radius:0;background:transparent;flex:1;min-height:0}
  .widget-frame:not(.editing):focus-within{z-index:9}
  .widget-frame:not(.editing):focus-visible,.widget-frame:not(.editing):has(:focus-visible){outline:2px solid var(--accent);outline-offset:-2px}
  .editing{outline:1px dashed var(--accent);background:var(--hub-surface,#151722eb)}
  .selected{outline:2px solid var(--accent);z-index:10}.dragging{z-index:20;user-select:none}
  header{display:flex;flex:none;height:28px;overflow:hidden;background:var(--bg)}
  .widget-title{padding:4px 8px 4px 15px;height:40px;align-items:center;gap:8px;background:none;font-size:12px;white-space:nowrap}
  .widget-title strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .widget-options-button{display:flex;align-items:center;justify-content:center;flex:none;width:32px;height:100%;min-height:24px;border-radius:7px;color:var(--muted)}
  .widget-options-button:hover{background:var(--line);color:var(--accent)}
  .widget-handle{flex:1;min-width:0;padding:4px 10px;text-align:left;font-size:11px;white-space:nowrap;overflow:hidden;cursor:grab;touch-action:none}
  .widget-remove{padding:0 10px}.resize-edge{position:absolute;padding:0;border:0;background:transparent;touch-action:none;z-index:3}
  .n,.s{height:6px;left:9px;right:9px;cursor:ns-resize}.n{top:0}.s{bottom:0}
  .e,.w{width:6px;top:9px;bottom:9px;cursor:ew-resize}.e{right:0}.w{left:0}
  .ne,.nw,.se,.sw{width:10px;height:10px}.ne,.nw{top:0}.se,.sw{bottom:0}
  .ne,.se{right:0}.nw,.sw{left:0}.ne,.sw{cursor:nesw-resize}.nw,.se{cursor:nwse-resize}
  .se{background:var(--accent);border-radius:8px 0 0 0}
</style>
