<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './components/Icon.svelte';
  import AppSettings from './tools/AppSettings.svelte';
  import { tools, getTool } from './lib/registry';
  import { bridge, desktop } from './lib/bridge';
  import { activeTool, fullCapture, visible, settingsStatus, streamingId, installedApps } from './lib/state';
  import type { OpenPayload, ResizeDirection, ToolContext } from './lib/types';
  import { workspacePage } from './lib/workspace-state';

  let toast = '';
  let toastKind: 'info' | 'error' = 'info';
  let toastTimer: ReturnType<typeof setTimeout>;
  let launching = false;
  let initialized = false;
  let selectedAppId: string | null = null;
  type HostView = { tool: string; appId: string | null };
  let settingsHistory: HostView[] = [];
  let returningTo: HostView | null = null;
  let appMenu: { id: string; hidden: boolean; x: number; y: number } | null = null;
  let previewX = Math.max(0, window.innerWidth - 464);
  let previewY = Math.min(64, Math.max(0, window.innerHeight - 520));
  let previewDrag: { x: number; y: number; left: number; top: number } | null = null;
  const resizeEdges: ResizeDirection[] = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'];
  import { locale, applyLocale, text } from './lib/locale';
  let previousFocus: HTMLElement | null = null;
  let shell: HTMLElement;
  $: current = getTool($activeTool);
  $: View = current.component;
  $: selectedApp = $installedApps.find(app => app.manifest.id === selectedAppId);
  $: enabledApps = $installedApps.filter(app => app.enabled && !app.hidden);
  $: hiddenApps = $installedApps.filter(app => app.enabled && app.hidden);
  function appContextMenu(event: MouseEvent, id: string, hidden = false) {
    event.preventDefault();
    appMenu = { id, hidden, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 70)) };
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.app-context-menu button')?.focus());
  }
  async function changeMenuVisibility() {
    if (!appMenu) return;
    const { id, hidden } = appMenu; appMenu = null;
    try { await bridge.hideApp(id, !hidden); installedApps.set(await bridge.listApps()); }
    catch (error) { context.notify(String(error), 'error'); }
  }
  $: capturing = $activeTool === 'capture' && $fullCapture !== null;
  $: standalone = current.category === 'tool';
  $: floating = standalone && !capturing;
  $: home = $activeTool === 'home' && !selectedApp;

  function navigateSettings(next: HostView) {
    if (!$visible) settingsHistory = [];
    else if (returningTo?.tool === next.tool) {
      settingsHistory = settingsHistory.slice(0, -1);
    } else if (next.tool === 'settings' || next.appId || ($activeTool === 'settings' && next.tool === 'catalog')) {
      const previous = settingsHistory.findIndex(view => view.tool === next.tool && view.appId === next.appId);
      if (previous >= 0) settingsHistory = settingsHistory.slice(0, previous);
      else if ($activeTool !== next.tool || selectedAppId !== next.appId) {
        settingsHistory = [...settingsHistory, { tool: $activeTool, appId: selectedAppId }];
      }
    } else settingsHistory = [];
  }
  function clearSettingsHistory() {
    settingsHistory = []; returningTo = null;
  }
  async function dismissView() {
    const previous = settingsHistory.at(-1);
    if (!previous) { await context.hide(); return; }
    if (launching) return;
    launching = true; returningTo = previous;
    try {
      if (desktop) await bridge.open(previous.tool);
      else await receiveOpen({ tool: previous.tool });
    } catch (error) {
      returningTo = null;
      context.notify(String(error), 'error');
    } finally { launching = false; }
  }

  const context: ToolContext = {
    appSettings(id) {
      navigateSettings({ tool: 'catalog', appId: id });
      selectedAppId = id;
      activeTool.set('catalog');
    },
    async launchPackage(id) {
      try { await bridge.launchPackage(id); }
      catch (error) { context.notify(String(error), 'error'); }
    },
    async launch(id) {
      getTool(id);
      if (launching) return;
      launching = true;
      try {
        if (desktop) await bridge.open(id);
        else {
          await receiveOpen({ tool: id });
        }
      } catch (error) { context.notify(String(error), 'error'); }
      finally { launching = false; }
    },
    async hide() {
      try {
        if (desktop) await bridge.hide();
        clearSettingsHistory();
        workspacePage.set(null);
        fullCapture.set(null);
        visible.set(false);
        previousFocus?.focus();
      } catch (error) { context.notify(String(error), 'error'); }
    },
    notify(message, kind = 'info') {
      toast = message;
      toastKind = kind;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast = ''; }, kind === 'error' ? 12000 : 4500);
    },
  };

  async function receiveOpen(payload: OpenPayload) {
    if (payload.tool !== 'capture') {
      fullCapture.set(null);
      await bridge.discardCapture();
    } else fullCapture.set(payload.capture ?? null);
    const next = { tool: payload.tool, appId: returningTo?.tool === payload.tool ? returningTo.appId : null };
    navigateSettings(next);
    returningTo = null;
    selectedAppId = next.appId;
    activeTool.set(payload.tool);
    visible.set(true);
    requestAnimationFrame(() => {
      const target = payload.tool === 'home' ? shell?.querySelector<HTMLInputElement>('[data-home-search]') : null;
      (target ?? shell)?.focus({ preventScroll: true });
    });
  }

  function dragPanel(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (desktop) {
      void bridge.dragPanel().catch(error => context.notify(String(error), 'error'));
    } else {
      previewDrag = { x: event.clientX, y: event.clientY, left: previewX, top: previewY };
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function movePanel(event: PointerEvent) {
    if (!previewDrag) return;
    previewX = Math.max(0, Math.min(window.innerWidth - shell.offsetWidth, previewDrag.left + event.clientX - previewDrag.x));
    previewY = Math.max(0, Math.min(window.innerHeight - shell.offsetHeight, previewDrag.top + event.clientY - previewDrag.y));
  }

  function resizePanel(event: PointerEvent, direction: ResizeDirection) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void bridge.resizePanel(direction).catch(error => context.notify(String(error), 'error'));
  }

  function keyboard(event: KeyboardEvent) {
    if (appMenu && event.key === 'Escape') { event.preventDefault(); appMenu = null; return; }
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      void dismissView();
    }
    if (!desktop && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !event.repeat) {
      const tool = tools.find(tool => tool.shortcut?.toLowerCase() === `ctrl+${event.key.toLowerCase()}`);
      if (tool) {
        event.preventDefault();
        if ($visible && $activeTool === tool.id) void context.hide();
        else void context.launch(tool.id);
      }
    }
    if (event.key === 'Tab' && shell && $visible) {
      const elements = [...shell.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary')]
        .filter(element => element.tabIndex >= 0 && element.getClientRects().length);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === shell)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
  }

  onMount(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    async function initialize() {
      try {
        window.dispatchEvent(new CustomEvent('orbit:theme', { detail: await bridge.getTheme() }));
        applyLocale(await bridge.getLocale());
        if (desktop) {
          const open = await bridge.onOpen(payload => { void receiveOpen(payload).catch(error => context.notify(String(error), 'error')); });
          if (disposed) { open(); return; }
          cleanups.push(open);
          const error = await bridge.onError(message => context.notify(message, 'error'));
          if (disposed) { error(); return; }
          cleanups.push(error);
          cleanups.push(await bridge.onHidden(() => { clearSettingsHistory(); workspacePage.set(null); visible.set(false); fullCapture.set(null); }));
          if (disposed) { cleanups.forEach(cleanup => cleanup()); return; }
          await bridge.ready();
        }
        settingsStatus.set(await bridge.getSettings());
        installedApps.set(await bridge.listApps());
      } catch (error) { context.notify(String(error), 'error'); }
      finally { initialized = true; }
    }
    void initialize();
    return () => { disposed = true; cleanups.forEach(cleanup => cleanup()); clearTimeout(toastTimer); };
  });
</script>

<svelte:window onkeydown={keyboard} onclick={() => { appMenu = null; }} />

{#if !desktop}
  <div class="preview-desktop">
    <div class="preview-orb"></div>
    <div class="desktop-caption"><span class="eyebrow">ORBIT / INTERACTIVE PREVIEW</span><h1>Il tuo contesto.<br />Una nuova prospettiva.</h1><p>L'app desktop vive sopra quello che stai facendo.<br />Qui puoi esplorare la UI e provare la selezione su un'immagine.</p>
      <button class="button primary" onclick={() => context.launch('home')}>Apri Orbit <kbd>Ctrl E</kbd></button>
    </div>
    <div class="preview-label">Preview browser · Hotkey limitate a questa pagina · Nessuna cattura del desktop</div>
  </div>
{/if}

{#if $visible}
  <div class:launcher-mode={home} class:selection-mode={capturing} class:tool-mode={floating} class:native-panel={floating && desktop} class="overlay">
    <section class:home-shell={home} class:selecting={capturing} class:tool-shell={floating} class="app-shell" bind:this={shell} tabindex="-1" aria-label="Orbit AI overlay" aria-busy={!initialized}
      style:left={floating && !desktop ? `${previewX}px` : undefined}
      style:top={floating && !desktop ? `${previewY}px` : undefined}>
      {#if !capturing && !standalone && !home}
        <aside class="sidebar">
          <button class="brand" onclick={() => context.launch('home')} aria-label="Orbit, home"><span class="brand-symbol">o<span></span></span><span>orbit<span class="brand-dot">.</span></span></button>
          <span class="sidebar-label">WORKSPACE</span>
          <div class="sidebar-navigation"><nav aria-label="Strumenti">
            {#each tools.filter(tool => tool.id !== 'settings' && (!desktop || !['capture', 'notes', 'chat'].includes(tool.id))) as tool}
              <button class:active={!selectedApp && $activeTool === tool.id} class="nav-item" onclick={() => context.launch(tool.id)}>
                <Icon name={tool.icon} size={18} /><span>{tool.name}</span>
                {#if tool.shortcut}<span class="nav-key">{tool.shortcut.replace('Ctrl+', '^')}</span>{/if}
              </button>
            {/each}
          </nav>
          {#if enabledApps.length}
            <span class="sidebar-label apps-label">LE TUE APP</span>
            <nav aria-label="Impostazioni delle app">
              {#each enabledApps as app}
                <button class:active={selectedAppId === app.manifest.id} class="nav-item app-nav-item" aria-label={`Impostazioni ${app.manifest.name}`} title={`Impostazioni ${app.manifest.name}`} oncontextmenu={event => appContextMenu(event, app.manifest.id)} onclick={() => context.appSettings(app.manifest.id)}>
                  <Icon name={app.manifest.icon ?? 'grid'} size={18} /><span>{app.manifest.name}</span>
                </button>
              {/each}
            </nav>
          {/if}
          {#if hiddenApps.length}
            <details class="hidden-apps">
              <summary>App nascoste <span>{hiddenApps.length}</span></summary>
              <nav aria-label="Impostazioni app nascoste">
                {#each hiddenApps as app}
                  <button class:active={selectedAppId === app.manifest.id} class="nav-item app-nav-item" aria-label={`Impostazioni ${app.manifest.name}`} title="Tasto destro per mostrare nel menu" oncontextmenu={event => appContextMenu(event, app.manifest.id, true)} onclick={() => context.appSettings(app.manifest.id)}><Icon name={app.manifest.icon ?? 'grid'} size={18} /><span>{app.manifest.name}</span></button>
                {/each}
              </nav>
            </details>
          {/if}
          </div>
          <div class="sidebar-bottom">
            <button class:active={$activeTool === 'settings'} class="nav-item" onclick={() => context.launch('settings')}><Icon name="settings" size={18} />Impostazioni</button>
            <div class="sidebar-version"><span>DEMO 0.1</span><span>{desktop ? 'DESKTOP' : 'WEB PREVIEW'}</span></div>
          </div>
        </aside>
      {/if}
      <main class:full-canvas={capturing}>
        {#if !capturing}
          <header class="topbar">
            {#if floating}
              <button class="panel-drag" aria-label="Sposta pannello" title="Trascina per spostare"
                onpointerdown={dragPanel} onpointermove={movePanel}
                onpointerup={() => { previewDrag = null; }} onpointercancel={() => { previewDrag = null; }}>
                <Icon name={current.icon} size={14} /><span>{current.name}</span>
              </button>
            {:else if home}
              <span></span>
            {:else}
              <button class="icon-button" aria-label="Torna allo spazio" title="Torna allo spazio" onclick={() => context.launch('home')}><Icon name="undo" size={18} /></button>
              <div class="breadcrumb">{selectedApp ? 'Impostazioni app' : 'Il tuo assistente'} <span>/</span><strong>{selectedApp?.manifest.name ?? current.name}</strong></div>
            {/if}
            <div class="topbar-actions">
              {#if $streamingId}<button class="stream-status" onclick={() => context.launch('chat')}><span class="status-dot"></span>AI in corso</button>{/if}
              {#if standalone}
                <button class="icon-button" aria-label="Apri dashboard" onclick={() => context.launch('home')}><Icon name="grid" size={16} /></button>
                <button class="icon-button" aria-label="Impostazioni" onclick={() => context.launch('settings')}><Icon name="settings" size={16} /></button>
              {/if}
              {#if home}
                <button class="hub-settings" aria-label={text($locale, 'Impostazioni', 'Settings')} title={text($locale, 'Impostazioni e gestione app', 'Settings and app management')} onclick={() => context.launch('settings')}><Icon name="settings" size={19} /><span>{text($locale, 'Impostazioni', 'Settings')}</span></button>
              {/if}
              <span class="escape-label">{settingsHistory.length ? text($locale, 'Indietro', 'Back') : text($locale, 'Nascondi', 'Hide')} <kbd>esc</kbd></span>
              <button class="icon-button" aria-label={settingsHistory.length ? text($locale, 'Chiudi impostazioni', 'Close settings') : text($locale, 'Nascondi overlay', 'Hide overlay')} onclick={dismissView}><Icon name="close" size={18} /></button>
            </div>
          </header>
        {/if}
        <div class:canvas-content={capturing} class="tool-content">
          {#if selectedApp}{#key selectedApp.manifest.id}<AppSettings app={selectedApp} {context} />{/key}
          {:else}<svelte:component this={View} {context} />{/if}
        </div>
      </main>
      {#if floating && desktop}
        {#each resizeEdges as direction}
          <button class="resize-handle" data-edge={direction} tabindex="-1"
            aria-label={`Ridimensiona pannello ${direction}`}
            onpointerdown={event => resizePanel(event, direction)}></button>
        {/each}
      {/if}
    </section>
  </div>
{/if}

{#if appMenu}
  <div class="app-context-menu" role="menu" aria-label="Visibilita app" style:left={`${appMenu.x}px`} style:top={`${appMenu.y}px`}>
    <button role="menuitem" onclick={changeMenuVisibility}><Icon name={appMenu.hidden ? 'eye' : 'eye-off'} size={16} />{appMenu.hidden ? 'Mostra nel menu' : 'Nascondi'}</button>
  </div>
{/if}

{#if toast}
  <div class:home-toast={home} class:error={toastKind === 'error'} class="toast" role={toastKind === 'error' ? 'alert' : 'status'}>
    <Icon name={toastKind === 'error' ? 'close' : 'check'} size={18} /><span>{toast}</span>
    <button class="icon-button" aria-label="Chiudi notifica" onclick={() => { toast = ''; }}><Icon name="close" size={16} /></button>
  </div>
{/if}

<style>
  .hidden-apps { margin-top: 16px; }
  .hidden-apps summary { padding: 10px 16px; cursor: pointer; font-size: 12px; opacity: .75; }
  .hidden-apps summary span { margin-left: 8px; }
  .app-context-menu { position: fixed; z-index: 100; min-width: 190px; padding: 6px; border: 1px solid #555567; border-radius: 12px; background: #22222f; color: #f4f4fa; box-shadow: 0 12px 36px #0005; }
  .app-context-menu button { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; padding: 10px; border-radius: 7px; color: inherit; background: transparent; cursor: pointer; }
  .app-context-menu button:hover, .app-context-menu button:focus-visible { background: #8882; outline: 2px solid #9a85ed; }
  :global([data-theme='light']) .app-context-menu { background: #fff; color: #242237; border-color: #d9d7e4; }
</style>
