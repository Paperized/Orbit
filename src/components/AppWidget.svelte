<script lang="ts">
  import { bridge } from '../lib/bridge';
  import type { WidgetContent, WidgetDeclaration } from '../../sdk/src';
  import { widgetGrid, type WidgetInstance } from '../lib/widgets';
  import WidgetImage from './WidgetImage.svelte';
  let { instance, definition, run, appName, actionLabel, openImage, actionsDisabled = false }: {
    instance: WidgetInstance; definition: WidgetDeclaration | undefined;
    appName: string; run: (action: string) => Promise<void>; actionLabel: (action: string) => string;
    openImage?: (name: string) => Promise<void>;
    actionsDisabled?: boolean;
  } = $props();
  let content = $state<WidgetContent | null>(null);
  let error = $state('');
  let actionBusy = $state(false);
  let reload = $state(0);
  let preview = $state<string | null>(null);
  const grid = $derived(widgetGrid(instance, definition));
  const count = $derived(Math.min(grid.rows * grid.columns, definition?.source.limit ?? 4));
  $effect(() => {
    const current = definition, appId = instance.appId, widgetId = instance.widgetId;
    const limit = count;
    void reload;
    let stopped = false, pending = false;
    content = null; error = '';
    if (!current) return;
    async function refresh() {
      if (pending || stopped) return;
      pending = true;
      try {
        const next = await bridge.widgetData(appId, widgetId, limit);
        if (!stopped) { content = next; error = ''; }
      } catch (reason) { if (!stopped) { content = null; error = String(reason); } }
      finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { stopped = true; clearInterval(timer); };
  });
  async function launch(action: string) {
    if (actionBusy) return;
    actionBusy = true;
    try { await run(action); } finally { actionBusy = false; }
  }
</script>

<div class="widget-body" style:--rows={grid.rows} style:--columns={grid.columns}>
  {#if !definition}
    <p class="widget-status" role="status">Widget non disponibile. Riattiva o reinstalla l'app per recuperarlo, oppure rimuovilo dalla home.</p>
  {:else}
    <small class="widget-description">{definition.description}</small>
    {#if error}
      <p class="widget-status" role="alert">{error}</p>
      <button class="widget-retry" onclick={() => reload++}>Riprova widget</button>
    {:else if !content}
      <p class="widget-status" role="status">Caricamento anteprime...</p>
    {:else}
      {#if content.entries.length}
        <div class="widget-thumbnails" data-widget-columns={grid.columns}>
          {#each content.entries.slice(0, count) as entry (entry.name)}
            <figure><button class="image-preview" aria-label={`Ingrandisci ${entry.name}`} onclick={() => { if (openImage) void openImage(entry.name); else preview = entry.name; }}><img src={entry.dataUrl} alt={entry.name} title={entry.name} /></button><figcaption>{entry.name}</figcaption></figure>
          {/each}
        </div>
      {:else}<p class="widget-status">Nessuna immagine. I nuovi PNG appariranno qui.</p>{/if}
      {#if content.warning}<small role="status">{content.warning}</small>{/if}
    {/if}
    {#if definition.actions?.length}<div class="widget-actions">
      {#each definition.actions ?? [] as action}
        <button disabled={actionBusy || actionsDisabled} onclick={() => launch(action)}>{action === 'open' ? `Apri ${appName}` : actionLabel(action)}</button>
      {/each}
    </div>{/if}
  {/if}
</div>

{#if preview}
  <WidgetImage appId={instance.appId} widgetId={instance.widgetId} name={preview} close={() => { preview = null; }} />
{/if}

<style>
  .widget-body{display:flex;flex-direction:column;gap:10px;padding:0 12px 12px;min-height:0;flex:1;overflow:hidden;container:app-widget / size}
  .widget-description,.widget-body>small{font-size:10px;line-height:1.5;color:var(--muted)}
  .widget-status{font-size:12px;color:var(--muted);line-height:1.65;margin:10px 0;overflow-wrap:anywhere}
  .widget-thumbnails{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));grid-template-rows:repeat(var(--rows),minmax(0,1fr));gap:6px;min-height:0;flex:1;overflow:hidden}
  figure{margin:0;min-width:0;min-height:0;display:flex;flex-direction:column;gap:4px}
  .image-preview{display:flex;flex:1;min-height:0;min-width:0;padding:0;border-radius:6px;overflow:hidden;cursor:zoom-in}
  .image-preview:focus-visible{outline-offset:-2px}
  img{display:block;width:100%;height:100%;min-height:0;flex:1;object-fit:contain;background:var(--line);border-radius:6px}
  figcaption{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}
  .widget-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:4px;flex-shrink:0}
  .widget-actions button,.widget-retry{font-size:10px;border:1px solid var(--line);border-radius:7px;padding:8px;color:var(--accent)}
  @container app-widget (max-height:200px){.widget-description,figcaption{display:none}}
  @container app-widget (max-width:260px){figcaption{display:none}.widget-actions button{font-size:10px;padding:6px}}
</style>
