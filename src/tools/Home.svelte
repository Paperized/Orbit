<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { installedApps } from '../lib/state';
  import { bridge, desktop } from '../lib/bridge';
  import { defaultHomeLayout, launchItems, searchItems } from '../lib/launcher';
  import type { HomeLayout, LaunchItem } from '../lib/launcher';
  import type { DependencyStatus, ToolProps } from '../lib/types';
  import previewTools from '../../shared/tools.json';
  import WidgetFrame from '../components/WidgetFrame.svelte';
  import AppWidget from '../components/AppWidget.svelte';
  import WidgetSettings from '../components/WidgetSettings.svelte';
  import DockSettings from '../components/DockSettings.svelte';
  import { availableWidgets, widgetDefinition, widgetLimit } from '../lib/widgets';
  import { builtinNames, defaultRects, fitRect, gridStep, layoutWriter, manipulate, type Builtin, type Rect } from '../lib/layout-geometry';
  import type { WidgetDeclaration } from '../../sdk/src';
  import { anchoredPanel } from '../lib/anchored-panel';
  import { locale, text } from '../lib/locale';
  import { widgetNavigation } from '../lib/widget-navigation';
  import { presetBuiltins, type OverlayPreset, type PresetBuiltin } from '../lib/presets';
  import { presetBridge } from '../lib/preset-bridge';

  let { context, preset, persistPreset, only }: ToolProps & {
    preset?: OverlayPreset; persistPreset?: (preset: OverlayPreset) => Promise<void>; only?: string;
  } = $props();
  let query = $state('');
  let browsing = $state(false);
  let layout = $state(defaultHomeLayout());
  let layoutError = $state('');
  let layoutBusy = $state(true);
  let dependencies = $state<DependencyStatus[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let running = $state<string | null>(null);
  let search = $state<HTMLInputElement>(null!);
  let searchAnchor = $state<HTMLDivElement>(null!);
  let widgetPicker = $state<HTMLDetailsElement>(null!);
  let canvas = $state<HTMLDivElement>(null!);
  let bounds = $state({ width: 1200, height: 700 });
  let manipulating = $state(false);
  let selected = $state('search');
  let configuring = $state<string | null>(null);
  let configuringDock = $state(false);
  const configuredWidget = $derived(layout.widgets.find(widget => widget.id === configuring));
  let now = $state(new Date());
  let pending = $state(0);
  let sliderDraft = $state<number | null>(null);
  const sliderValue = $derived(sliderDraft ?? (layout.grid ? layout.gridSize : 0));
  let writer: ReturnType<typeof layoutWriter<HomeLayout>>;
  const defaults = $derived(defaultRects(bounds));
  const editing = $derived(!only && (!!preset || layout.editing));
  function shown(id: PresetBuiltin) { return only ? only === id : !preset || preset.builtins.includes(id); }
  function displayRect(id: Builtin) {
    return only ? { x: 0, y: 0, width: bounds.width, height: bounds.height } : layout.rects[id] ?? defaults[id];
  }
  async function updatePreset(next: OverlayPreset) {
    if (!persistPreset) return;
    pending++;
    try { await persistPreset(next); }
    catch (error) { context.notify(String(error), 'error'); }
    finally { pending--; }
  }
  function interaction(id: string) {
    if (!preset) return;
    void updatePreset({ ...preset, clickThrough: preset.clickThrough.includes(id)
      ? preset.clickThrough.filter(item => item !== id) : [...preset.clickThrough, id] });
  }
  const selectedRect = $derived(fitRect(selected in builtinNames
    ? layout.rects[selected as Builtin] ?? defaults[selected as Builtin]
    : layout.widgets.find(widget => widget.id === selected) ?? defaults.search, bounds));
  let resultList = $state<HTMLDivElement>();
  const items = $derived(launchItems($installedApps, dependencies));
  const widgetGroups = $derived(availableWidgets($installedApps, dependencies));
  const results = $derived(searchItems(items, query));
  const favorites = $derived(layout.favorites.flatMap(id => {
    const item = items.find(item => item.id === id);
    return item ? [item] : [];
  }));
  const apps = $derived(items.filter(item => item.actionId === 'open' && !item.hidden && !item.unavailable && !layout.dockHiddenApps.includes(item.appId)));
  const dockChoices = $derived(desktop
    ? $installedApps.map(app => ({ id: app.manifest.id, name: app.manifest.name, unavailable: !app.enabled || !!app.hidden, disabled: !app.enabled }))
    : previewTools.filter(tool => tool.category === 'tool').map(tool => ({ id: tool.id, name: tool.name, unavailable: false, disabled: false })));
  const searching = $derived(browsing || query.trim().length > 0);
  const demoTools = $derived(previewTools.filter(tool => tool.category === 'tool'
    && searchItems([{ name: tool.name, appName: '', description: tool.description }], query).length));

  async function refresh() {
    loading = true; loadError = '';
    try {
      const [apps, statuses] = await Promise.all([bridge.listApps(), bridge.dependencies()]);
      installedApps.set(apps); dependencies = statuses;
    } catch (error) { loadError = String(error); }
    finally { loading = false; }
  }
  async function save(mutate: (value: HomeLayout) => HomeLayout) {
    if (!writer) return false;
    pending++;
    try {
      await writer(mutate);
      layoutError = '';
      return true;
    } catch (error) { context.notify(`Impossibile salvare il layout: ${String(error)}`, 'error'); return false; }
    finally { pending--; }
  }
  function changeRect(id: string, rect: Rect) {
    void save(value => id in builtinNames ? { ...value, rects: { ...value.rects, [id]: rect } }
      : { ...value, widgets: value.widgets.map(widget => widget.id === id ? { ...widget, ...rect } : widget) });
  }
  function editRect(event: SubmitEvent) {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(data.get(key))])) as unknown as Rect;
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return;
    changeRect(selected, manipulate(rect, 'move', 0, 0, bounds, layout.grid, layout.gridSize));
  }
  function reset() {
    void save(value => ({ ...value, rects: preset ? defaultRects(preset.monitor) : {}, widgets: value.widgets.map((widget, i) => ({
      ...widget, x: 12 + i * 24, y: 185 + i * 24, width: 300, height: 300,
    })) }));
  }
  async function addWidget(appId: string, widget: WidgetDeclaration) {
    if (layout.widgets.length >= widgetLimit || layout.widgets.some(item => item.appId === appId && item.widgetId === widget.id)) return;
    await save(value => ({ ...value, widgets: [...value.widgets, {
      id: crypto.randomUUID(), appId, widgetId: widget.id, title: widget.title,
      ...fitRect({ x: 12 + value.widgets.length * 24, y: 185 + value.widgets.length * 24,
        width: widget.width * 316 - 16, height: widget.height * 316 - 16 }, bounds),
    }] }));
    await tick();
    widgetPicker.querySelector('summary')?.focus();
  }
  async function widgetAction(appId: string, actionId: string) {
    const item = items.find(item => item.appId === appId && item.actionId === actionId);
    if (item) await run(item);
  }
  function favorite(item: LaunchItem) {
    void save(value => ({ ...value, favorites: value.favorites.includes(item.id)
      ? value.favorites.filter(id => id !== item.id) : [...value.favorites, item.id] }));
  }
  async function run(item: LaunchItem) {
    if (preset && !only) return;
    if (running || loading || loadError || item.unavailable) return;
    running = item.id;
    try {
      if (item.actionId === 'open') await bridge.launchPackage(item.appId);
      else await bridge.launchPackageAction(item.appId, item.actionId);
      query = ''; browsing = false;
    } catch (error) { context.notify(String(error), 'error'); }
    finally { running = null; }
  }
  async function keyboard(event: KeyboardEvent) {
    if (only) return;
    if (!event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const target = event.target;
      const fromSearch = target === search;
      if ((fromSearch && event.key === 'ArrowDown')
        || (target instanceof HTMLElement && resultList?.contains(target))) {
        event.preventDefault(); event.stopPropagation();
        if (fromSearch) {
          browsing = true;
          await tick();
          if (document.activeElement !== search) return;
        }
        const buttons = [...(resultList?.querySelectorAll<HTMLButtonElement>('.result-run:not(:disabled)') ?? [])];
        const rowButton = target instanceof HTMLElement
          ? target.closest('.launcher-result')?.querySelector('.result-run') ?? target : null;
        const index = buttons.findIndex(button => button === rowButton);
        if (!fromSearch && event.key === 'ArrowUp' && index <= 0) {
          search.focus(); return;
        }
        const next = fromSearch ? buttons[0]
          : buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        next?.focus();
        next?.scrollIntoView({ block: 'nearest' });
      }
    }
    if (event.key === 'Escape' && widgetPicker.open) {
      event.preventDefault(); event.stopPropagation();
      widgetPicker.open = false; widgetPicker.querySelector('summary')?.focus(); return;
    }
    if (event.key === 'Escape' && searching) {
      event.preventDefault(); event.stopPropagation();
      query = ''; browsing = false; search?.focus();
    }
  }
  function typeToSearch(event: KeyboardEvent) {
    if (preset || only || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
      || event.key.length !== 1 || manipulating || configuring || document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable
      || target.closest('input, textarea, select, [role="textbox"], [role="combobox"], details[open]'))) return;
    if (event.key === ' ' && (!query || (target instanceof Element && target.closest('button, summary, a')))) return;
    event.preventDefault();
    search.focus({ preventScroll: true });
    query += event.key;
  }
  onMount(() => {
    void (preset ? Promise.resolve(preset.layout) : bridge.getHomeLayout()).then(value => { layout = value; })
      .catch(error => { layoutError = String(error); }).finally(() => {
        writer = layoutWriter(layout, value => preset && persistPreset
          ? persistPreset({ ...preset, layout: value }) : only ? Promise.reject(new Error('Modifica disponibile solo nell’hub.')) : bridge.saveHomeLayout(value),
          value => { layout = value; });
        layoutBusy = false;
      });
    void refresh();
    const observer = new ResizeObserver(() => { bounds = { width: canvas.clientWidth, height: canvas.clientHeight }; });
    observer.observe(canvas);
    const clock = setInterval(() => { now = new Date(); }, 1000);
    return () => { observer.disconnect(); clearInterval(clock); };
  });
</script>

<svelte:window onkeydown={typeToSearch} />

<div class="launcher" onkeydown={keyboard} role="presentation">
  <p id="widget-keyboard-help" class="keyboard-help">{text($locale, 'Tab: widget successivo. Maiusc+Tab: precedente. Frecce: contenuto. Invio: attiva.', 'Tab: next widget. Shift+Tab: previous. Arrow keys: content. Enter: activate.')}</p>
  {#if !only}
  <div class="layout-controls" aria-label="Controlli layout">
    {#if !preset}
    <button class="layout-toggle" class:active={layout.editing} aria-label={layout.editing ? 'Termina modifica layout' : 'Modifica layout'}
      title={layout.editing ? 'Termina modifica layout' : 'Modifica layout'} aria-pressed={layout.editing} disabled={layoutBusy || manipulating || pending > 0}
      onclick={() => save(value => ({ ...value, editing: !value.editing }))}><Icon name={layout.editing ? 'check' : 'edit'} size={19} /></button>
    {/if}
    {#if editing}
      <div class="grid-slider">
        <div class="grid-caption"><Icon name="grid" size={14} /><span>{sliderValue === 0 ? 'Libero' : `${sliderValue} px`}</span></div>
        <input aria-label="Dimensione griglia" aria-valuetext={sliderValue === 0 ? 'Libero' : `${sliderValue} pixel`}
          type="range" min="0" max={Math.max(200, layout.gridSize)} step="1" value={sliderValue}
          disabled={layoutBusy || manipulating || pending > 0}
          oninput={event => { sliderDraft = event.currentTarget.valueAsNumber; }}
          onchange={event => {
            const size = event.currentTarget.valueAsNumber;
            void save(value => ({ ...value, grid: size > 0, gridSize: size > 0 ? gridStep(size) : value.gridSize }))
              .finally(() => { sliderDraft = null; });
          }} />
      </div>
      <details class="recovery">
        <summary aria-label="Elementi / recupero" title="Elementi / recupero"><Icon name="settings" size={17} /></summary>
        <form onsubmit={editRect}>
          <label>Elemento <select aria-label="Elemento layout" bind:value={selected}>
            {#each Object.entries(builtinNames).filter(([id]) => id !== 'ai' && (!preset || preset.builtins.includes(id as PresetBuiltin)) && (id !== 'favorites' || layout.favoritesVisible) && (id !== 'dock' || layout.dockVisible)) as [id, name]}<option value={id}>{name}</option>{/each}
            {#each layout.widgets as widget}<option value={widget.id}>{widget.title}</option>{/each}
          </select></label>
          {#key `${selected}:${JSON.stringify(selectedRect)}`}
            {#each ['x', 'y', 'width', 'height'] as key}
              <label>{({ x: 'X', y: 'Y', width: 'Larghezza', height: 'Altezza' })[key]}
                <input name={key} aria-label={key} type="number" min={key === 'x' || key === 'y' ? 0 : 1} step="any" required value={selectedRect[key as keyof Rect]} />
              </label>
            {/each}
          {/key}
          <button type="submit" disabled={layoutBusy || manipulating}>Applica geometria</button>
          <button type="button" disabled={layoutBusy || manipulating} onclick={() => changeRect(selected, fitRect({ x: 12, y: 165, width: 300, height: 250 }, bounds))}>Recupera elemento</button>
          {#if !(selected in builtinNames)}<button type="button" onclick={() => save(value => ({ ...value, widgets: value.widgets.filter(w => w.id !== selected) }))}>Rimuovi widget selezionato</button>{/if}
          <button type="button" disabled={layoutBusy || manipulating} onclick={reset}>Ripristina posizioni e dimensioni</button>
          <small>Frecce sulla maniglia: sposta. Maiusc+frecce: ridimensiona. Esc: annulla. Nessun contenuto viene eliminato.</small>
        </form>
      </details>
    {/if}
    <details class="widget-picker" bind:this={widgetPicker}>
      <summary aria-label="Widget" title="Aggiungi widget"><Icon name="plus" size={18} /></summary>
      <div class="widget-options">
        <strong>Personalizza lo spazio</strong>
        {#if preset}
          {#each presetBuiltins as id}
            <label><input type="checkbox" checked={preset.builtins.includes(id)} disabled={layoutBusy || pending > 0}
              onchange={event => { const checked = event.currentTarget.checked;
                void updatePreset({ ...preset!, builtins: checked ? [...preset!.builtins, id] : preset!.builtins.filter(item => item !== id) }); }} />{builtinNames[id]}</label>
          {/each}
        {:else}
        {#each [{ id: 'favorites', key: 'favoritesVisible', label: text($locale, 'Preferiti', 'Favorites') }, { id: 'dock', key: 'dockVisible', label: text($locale, 'Avvio rapido', 'Quick launch') }] as widget}
        {@const key = widget.key as 'favoritesVisible' | 'dockVisible'}
        <label><input type="checkbox" checked={layout[key]} disabled={layoutBusy || pending > 0 || !!layoutError}
          onchange={event => {
            const input = event.currentTarget, shown = input.checked;
            void save(value => ({ ...value, [key]: shown })).then(saved => {
              input.checked = layout[key];
              if (saved && !shown && selected === widget.id) selected = 'search';
            });
          }} />{widget.label}</label>
        {/each}
        {/if}
        {#each widgetGroups as group (group.app.manifest.id)}
          <fieldset><legend>{group.app.manifest.name}</legend>
            {#each group.widgets as widget (widget.id)}
              <button class="add-widget" title={widget.description}
                disabled={layoutBusy || pending > 0 || !!layoutError || layout.widgets.length >= widgetLimit || layout.widgets.some(item => item.appId === group.app.manifest.id && item.widgetId === widget.id)}
                onclick={() => addWidget(group.app.manifest.id, widget)}><Icon name="plus" size={14} />{widget.title}</button>
            {/each}
          </fieldset>
        {:else}<small>Nessun widget esposto dalle app abilitate.</small>{/each}
        <small>Attiva Modifica layout per spostare e ridimensionare ogni elemento. La × rimuove solo il widget. Massimo {widgetLimit} widget.</small>
        <small>Le stelle aggiungono app e azioni ai preferiti.</small>
      </div>
    </details>
  </div>
  {/if}
  {#if layoutError}
    <div class="launcher-error" role="alert">{layoutError}<button class="button secondary" disabled={layoutBusy} onclick={() => save(() => defaultHomeLayout())}>Ripristina layout</button></div>
  {/if}
  <div class="home-canvas" bind:this={canvas} use:widgetNavigation={!editing && !manipulating}
    class:grid-active={layout.grid && manipulating} style:--grid-step={`${layout.gridSize}px`}>
  {#snippet frame(id: Builtin, children: import('svelte').Snippet)}
    <WidgetFrame {id} title={builtinNames[id]} rect={displayRect(id)} {bounds} {editing}
      grid={layout.grid} step={layout.gridSize} disabled={layoutBusy || !!layoutError || pending > 0} selected={editing && selected === id}
      toggleInteraction={preset && !only ? () => interaction(id) : undefined} clickThrough={preset?.clickThrough.includes(id)}
      change={rect => changeRect(id, rect)} activity={active => manipulating = active} select={id => selected = id} {children} />
  {/snippet}
  {#if shown('logo')}{@render frame('logo', logo)}{/if}
  {#snippet logo()}
    <div class="home-brand"><span class="brand-symbol">o<span></span></span><strong>orbit<span>.</span></strong><time aria-label="Ora corrente" datetime={now.toISOString()}>{now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</time></div>
  {/snippet}
  {#if shown('search') || (preset && !only && searching)}{@render frame('search', searchContent)}{/if}
  {#snippet searchContent()}
    {#if only}
      <button class="persistent-search" onclick={() => context.launch('home')}><Icon name="search" />{text($locale, 'Cerca con Orbit', 'Search with Orbit')}<kbd>Ctrl E</kbd></button>
    {:else}
    <div class="launcher-search" bind:this={searchAnchor}>
      <Icon name="search" size={20} />
      <input data-home-search bind:this={search} bind:value={query} aria-label={text($locale, 'Cerca app e azioni', 'Search apps and actions')} aria-controls={searching ? 'launcher-results' : undefined} placeholder={text($locale, "Cerca un'app o qualcosa da fare...", 'Search for an app or something to do...')} autocomplete="off" />
      {#if query}<button class="icon-button" aria-label="Cancella ricerca" onclick={() => { query = ''; search.focus(); }}><Icon name="close" size={16} /></button>{/if}
      <button class:active={browsing} class="browse-button" aria-expanded={searching} onclick={() => { browsing = !searching; query = ''; }}><Icon name="grid" size={16} /><span>{text($locale, 'App e azioni', 'Apps and actions')}</span></button>
    </div>
    {/if}
  {/snippet}
  {#if loadError}
    <div class="launcher-error" role="alert">{loadError}<button class="button secondary" onclick={refresh}>Riprova caricamento</button></div>
  {/if}
  {#if searching}
    <section id="launcher-results" class="launcher-results glass" aria-label="Risultati app e azioni" use:anchoredPanel={searchAnchor}>
      <div class="results-heading"><h2>{query.trim() ? 'Risultati' : 'App e azioni'}</h2><span>{desktop ? results.length : demoTools.length} disponibili</span></div>
      <div class="results-list" bind:this={resultList}>
        {#if loading}<p class="launcher-empty" role="status">Caricamento app...</p>
        {:else if desktop}
          {#each results as item (item.id)}
            <div class="launcher-result">
              <button class="result-run" aria-label={`${item.actionId === 'open' ? 'Apri' : 'Esegui'} ${item.name}`} disabled={!!preset || !!running || !!loadError || !!item.unavailable} onclick={() => run(item)}>
                <span class="launch-icon"><Icon name={item.icon} size={20} /></span>
                <span class="result-copy"><strong>{item.name}</strong><small>{item.unavailable ?? (item.actionId === 'open' ? 'Apri app' : item.appName)} · {item.description}</small></span>
                {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
              </button>
              <button class:starred={layout.favorites.includes(item.id)} class="star-button" aria-label={`${layout.favorites.includes(item.id) ? 'Rimuovi' : 'Aggiungi'} ${item.name} ${layout.favorites.includes(item.id) ? 'dai' : 'ai'} preferiti`} aria-pressed={layout.favorites.includes(item.id)} disabled={layoutBusy || !!layoutError} onclick={() => favorite(item)}><Icon name="star" size={19} /></button>
            </div>
          {:else}<p class="launcher-empty">Nessun risultato. Prova il nome di un'app o di una funzione.</p>{/each}
        {:else}
          {#each demoTools as tool}
            <button class="result-run" disabled={!!preset} onclick={() => context.launch(tool.id)}><Icon name={tool.icon} /><span class="result-copy"><strong>{tool.name}</strong><small>Preview browser · {tool.description}</small></span></button>
          {:else}<p class="launcher-empty">Nessun risultato.</p>{/each}
        {/if}
      </div>
      <button class="manage-link" onclick={() => context.launch('catalog')}>Gestisci e installa app <Icon name="arrow" size={14} /></button>
    </section>
  {/if}
        {#each layout.widgets.filter(widget => !only || only === widget.id) as widget (widget.id)}
          {@const definition = widgetDefinition(widget, $installedApps, dependencies)}
          {@const app = $installedApps.find(app => app.manifest.id === widget.appId)}
          <WidgetFrame id={widget.id} title={widget.title} rect={only ? { x: 0, y: 0, ...bounds } : widget} {bounds} {editing} titlebar={!!only}
            grid={layout.grid} step={layout.gridSize} disabled={layoutBusy || !!layoutError || pending > 0} selected={editing && selected === widget.id}
            toggleInteraction={preset && !only ? () => interaction(widget.id) : undefined} clickThrough={preset?.clickThrough.includes(widget.id)}
            change={rect => changeRect(widget.id, rect)} activity={active => manipulating = active} select={id => selected = id}
            options={only ? undefined : () => { configuring = widget.id; }}
            remove={only ? undefined : () => save(value => ({ ...value, widgets: value.widgets.filter(item => item.id !== widget.id) }))}>
            <AppWidget instance={widget} {definition} appName={app?.manifest.name ?? widget.appId}
              actionsDisabled={!!preset && !only}
              actionLabel={action => app?.manifest.actions?.find(item => item.id === action)?.label ?? action}
              openImage={only ? name => presetBridge.preview(name).catch(error => context.notify(String(error), 'error')) : undefined}
              run={action => widgetAction(widget.appId, action)} />
          </WidgetFrame>
        {/each}
      {#if shown('favorites') && (preset || layout.favoritesVisible)}{@render frame('favorites', favoriteContent)}{/if}
      {#snippet favoriteContent()}
      <div class="favorites-widget glass">
        <div class="results-heading"><h2><Icon name="star" size={16} />Preferiti</h2><button class="icon-button" aria-label="Aggiungi preferiti" onclick={() => { if (only) { void context.launch('home'); return; } browsing = true; search?.focus(); }}><Icon name="plus" size={17} /></button></div>
        {#if favorites.length}
          <div class="favorite-list">
            {#each favorites as item (item.id)}
              <div class="favorite-item">
                <button class="result-run" aria-label={`${item.actionId === 'open' ? 'Apri' : 'Esegui'} ${item.name}`} disabled={(!!preset && !only) || loading || !!loadError || !!running || !!item.unavailable} onclick={() => run(item)}>
                  <span class="launch-icon"><Icon name={item.icon} size={19} /></span>
                  <span class="result-copy"><strong>{item.name}</strong><small>{item.unavailable ?? (item.actionId === 'open' ? 'Apri app' : item.appName)}</small></span>
                </button>
                {#if !only}<button class="star-button starred" aria-label={`Rimuovi ${item.name} dai preferiti`} aria-pressed="true" disabled={layoutBusy || !!layoutError} onclick={() => favorite(item)}><Icon name="star" size={17} /></button>{/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-favorites"><Icon name="star" size={25} /><p>Le tue azioni, qui.</p><small>Cerca un'app o una funzione e premi la stellina per aggiungerla.</small><button onclick={() => { if (only) { void context.launch('home'); return; } browsing = true; search?.focus(); }}>Scegli i preferiti <Icon name="plus" size={14} /></button></div>
        {/if}
      </div>
      {/snippet}
  {#if shown('dock') && (preset || layout.dockVisible)}{@render frame('dock', dockContent)}{/if}
  {#snippet dockContent()}
    <nav class="app-dock" aria-label="Avvio rapido app">
      {#if desktop}
        {#each apps as item (item.id)}
          <button class="dock-app" aria-label={`Apri ${item.name}`} title={item.description} disabled={(!!preset && !only) || loading || !!loadError || !!running} onclick={() => run(item)}><Icon name={item.icon} size={23} /><span>{item.name}</span></button>
        {/each}
      {:else}
        {#each previewTools.filter(tool => tool.category === 'tool' && !layout.dockHiddenApps.includes(tool.id)) as tool}
          <button class="dock-app" aria-label={tool.name} disabled={!!preset && !only} onclick={() => context.launch(tool.id)}><Icon name={tool.icon} size={23} /><span>{tool.name}</span></button>
        {/each}
      {/if}
      <button class="dock-app dock-all" aria-label="Tutte le app e azioni" onclick={() => { if (only) { void context.launch('home'); return; } browsing = !searching; query = ''; search?.focus(); }}><Icon name="grid" size={23} /><span>Tutte le app</span></button>
      {#if !only}
      <button class="dock-options" aria-label={text($locale, 'Impostazioni Avvio rapido', 'Quick launch settings')} title={text($locale, 'Impostazioni widget', 'Widget settings')} aria-haspopup="dialog"
        disabled={layoutBusy || !!layoutError} onclick={() => { configuringDock = true; }}><Icon name="more" size={20} /></button>
      {/if}
    </nav>
  {/snippet}
  </div>
</div>

{#if configuringDock}
  <DockSettings apps={dockChoices} hidden={layout.dockHiddenApps}
    save={dockHiddenApps => save(value => ({ ...value, dockHiddenApps }))} close={() => { configuringDock = false; }} />
{/if}

{#if configuredWidget}
  <WidgetSettings instance={configuredWidget} definition={widgetDefinition(configuredWidget, $installedApps, dependencies)}
    save={settings => save(value => ({ ...value, widgets: value.widgets.map(widget => widget.id === configuredWidget.id ? { ...widget, settings } : widget) }))}
    remove={() => save(value => ({ ...value, widgets: value.widgets.filter(widget => widget.id !== configuredWidget.id) }))}
    close={() => { configuring = null; }} />
{/if}

<style>
  .persistent-search{display:flex;align-items:center;justify-content:center;gap:12px;flex:1;color:var(--accent)}
  .dock-options{display:flex;align-items:center;justify-content:center;align-self:center;flex:0 0 28px;height:32px;border-radius:8px;color:var(--muted)}
  .dock-options:hover{color:var(--accent);background:var(--line)}
  .keyboard-help{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  .launcher{height:100%;display:flex;flex-direction:column;min-height:0;position:relative}
  .home-canvas{position:relative;flex:1;min-height:0;overflow:hidden}
  .grid-active{background-image:linear-gradient(to right,#aa8aff38 1px,transparent 1px),linear-gradient(to bottom,#aa8aff38 1px,transparent 1px);background-size:var(--grid-step) var(--grid-step)}
  .layout-controls{position:absolute;right:20px;top:52px;display:flex;flex-direction:column;align-items:flex-end;gap:7px;z-index:40;font-size:11px;pointer-events:none}
  .layout-controls>*{pointer-events:auto}
  .layout-toggle,.recovery summary{display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:7px;border:1px solid var(--hub-line,#ffffff20);border-radius:10px;cursor:pointer;background:var(--hub-surface,#151722eb);color:var(--hub-text,#ddd6ee)}
  .layout-toggle:hover,.recovery summary:hover{border-color:var(--accent);color:var(--accent)}
  .grid-slider{width:180px;padding:10px 12px;background:var(--hub-surface,#151722eb);border:1px solid var(--hub-line,#ffffff20);border-radius:12px;box-shadow:0 8px 25px #0002}
  .grid-caption{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-variant-numeric:tabular-nums;margin-bottom:8px}
  .grid-slider input{display:block;width:100%;margin:0;padding:0;accent-color:var(--accent);cursor:pointer}
  .layout-controls label{display:flex;align-items:center;gap:5px}
  .layout-controls input[type=number]{width:65px;padding:5px;min-width:0}
  .layout-controls .active{color:var(--accent)}
  .recovery{position:relative}.recovery summary{list-style:none}.recovery summary::-webkit-details-marker{display:none}.recovery form{position:absolute;top:40px;right:0;width:275px;max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:16px;background:var(--bg);border:1px solid var(--line);border-radius:12px}
  .recovery form label{justify-content:space-between}.recovery select{max-width:190px}.recovery button{padding:8px;border:1px solid var(--line);border-radius:7px}.recovery small{line-height:1.5;color:var(--muted)}
  .home-brand{display:flex;align-items:center;gap:12px;height:100%;white-space:nowrap;padding:5px 10px}
  .home-brand strong{font-size:26px}.home-brand strong>span{color:var(--accent)}.home-brand time{font-size:19px;font-variant-numeric:tabular-nums}
  .glass{background:var(--hub-surface,#151722eb);border:1px solid var(--hub-line,#ffffff18);box-shadow:0 16px 50px #0002;border-radius:18px}
  .launcher-search{display:flex;align-items:center;gap:12px;background:var(--hub-surface,#151722eb);border:1px solid var(--hub-line,#ffffff20);border-radius:13px;padding:8px 10px 8px 18px;flex:1;min-width:0;color:var(--muted)}
  .launcher-search:focus-within{border-color:var(--accent)}
  .launcher-search input{width:100%;min-width:0;color:inherit;background:none;border:0;font-size:13px;padding:9px 0;box-shadow:none!important}
  .browse-button,.widget-picker summary{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;font-size:11px;white-space:nowrap;border-radius:8px}
  .browse-button:hover,.browse-button.active{background:#aa8aff18;color:var(--accent)}
  .widget-picker{position:relative;flex-shrink:0;z-index:3}
  .widget-picker summary{list-style:none;cursor:pointer;border:1px solid var(--hub-line,#ffffff20);background:var(--hub-surface,#151722eb);height:34px;width:34px;padding:7px;border-radius:10px}
  .widget-picker summary::-webkit-details-marker{display:none}
  .widget-options{position:absolute;right:0;top:42px;width:290px;max-height:55vh;overflow:auto;padding:18px;border:1px solid var(--line);border-radius:13px;background:var(--bg);box-shadow:0 12px 35px #0005;display:flex;flex-direction:column;gap:18px}
  .widget-options fieldset{border:0;padding:0;min-width:0}.widget-options legend{font-size:11px;color:var(--muted);margin-bottom:8px}.add-widget{display:flex;align-items:center;gap:8px;text-align:left;font-size:12px;padding:10px 0;color:var(--accent)}
  .widget-options strong{font-size:12px}.widget-options label{display:flex;gap:10px;font-size:12px}.widget-options input{accent-color:var(--accent)}.widget-options small{color:var(--muted);font-size:11px;line-height:1.6}
  .favorites-widget{width:100%;height:100%;min-height:0;display:flex;flex-direction:column}
  .results-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--hub-line,#ffffff0d)}.results-heading h2{font-size:13px;display:flex;gap:9px;align-items:center}.results-heading h2 :global(svg){color:var(--accent)}.results-heading>span{font-size:10px;color:var(--muted)}
  .empty-favorites{padding:27px 25px;color:var(--muted)}.empty-favorites>:global(svg){opacity:.6}.empty-favorites p{margin:12px 0 5px;font-size:14px;color:var(--hub-text,#e7e1f4)}.empty-favorites small{font-size:12px;line-height:1.7}.empty-favorites button{display:flex;align-items:center;gap:7px;margin-top:20px;padding:0;color:var(--accent);font-size:12px}
  .favorite-list{padding:8px;overflow:auto}.favorite-item,.launcher-result{display:flex;align-items:center;border-radius:10px}.favorite-item:hover,.launcher-result:hover{background:#a78ccc0c}
  .result-run{display:flex;align-items:center;gap:12px;min-width:0;flex:1;text-align:left;padding:12px;border-radius:9px}.result-copy{min-width:0;flex:1}.result-copy strong{display:block;font-size:12px;font-weight:550;overflow-wrap:anywhere}.result-copy small{font-size:10px;color:var(--muted);margin-top:5px;line-height:1.5;overflow-wrap:anywhere}.launch-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:36px;height:36px;background:#b398ef12;border-radius:10px;color:var(--accent)}
  .star-button{padding:12px;display:flex;align-items:center;color:var(--muted);border-radius:8px}.star-button:hover{background:#b398ef18}.starred{color:var(--accent)}.starred :global(svg){fill:#b398ef30}
  .launcher-results{position:fixed;z-index:30;display:flex;flex-direction:column;overflow:hidden}.results-list{padding:8px;overflow:auto;flex:1}.launcher-result kbd{font-size:10px}.manage-link{display:flex;align-items:center;gap:8px;padding:17px 20px;color:var(--accent);font-size:11px;flex-shrink:0}.launcher-empty{font-size:12px;color:var(--muted);padding:26px}
  .app-dock{display:flex;flex:1;min-height:0;gap:4px;padding:4px;max-width:100%;overflow:auto}.dock-app{display:flex;flex:1 0 75px;align-items:center;justify-content:center;flex-direction:column;gap:6px;border-radius:10px;min-width:0;padding:6px;color:var(--hub-text,#ddd6ee)}.dock-app:hover{background:#b398ef18;color:var(--accent)}.dock-app span{font-size:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dock-all{color:var(--accent)}
  .launcher-error{position:absolute;top:52px;left:20px;right:220px;z-index:45;padding:12px 18px;border:1px solid #aa7184;background:var(--bg);border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:12px;flex-wrap:wrap}
  @media(max-width:800px){.browse-button span{display:none}.layout-controls{right:12px}.recovery form,.widget-options{max-width:calc(100vw - 24px)}.launcher-error{left:12px;right:60px}}
</style>
