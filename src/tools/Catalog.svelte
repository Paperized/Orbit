<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { bridge, desktop } from '../lib/bridge';
  import { installedApps } from '../lib/state';
  import type { PackagePreview, ToolProps } from '../lib/types';
  let { context }: ToolProps = $props();
  let starters = $state<{ source: string; preview: PackagePreview }[]>([]);
  let review = $state<{ source: string; preview: PackagePreview } | null>(null);
  let approved = $state(false);
  let busy = $state(false);
  let loading = $state(true);
  let removing = $state<string | null>(null);
  let deleteData = $state(false);
  let query = $state('');
  let filter = $state('all');
  let fileInput: HTMLInputElement;
  let installMenu: HTMLDetailsElement;
  const permissionNames: Record<string, string> = { storage: 'Dati locali', timers: 'Timer e notifiche', 'screen-capture': 'Cattura schermo', 'ai-chat': 'Chat AI', 'app-actions': 'Richiama altre app', 'file-save': 'Salva immagini nella cartella dell’app', 'files-read': 'Legge tutti i file accessibili al tuo account, anche fuori da Orbit', 'files-write': 'Scrive ed elimina file solo nella propria cartella' };
  const filtered = $derived($installedApps.filter(app =>
    `${app.manifest.name} ${app.manifest.description}`.toLowerCase().includes(query.toLowerCase())
    && (filter === 'all' || app.enabled === (filter === 'enabled'))));
  const available = $derived(starters.filter(starter => !$installedApps.some(app =>
    app.manifest.id === starter.preview.manifest.id && app.manifest.version === starter.preview.manifest.version)));
  async function reload() { installedApps.set(await bridge.listApps()); }
  onMount(() => {
    void Promise.all([reload(), bridge.starterPackages().then(async sources => {
      starters = await Promise.all(sources.map(async source => ({ source, preview: await bridge.previewPackage(source) })));
    })]).catch(error => context.notify(String(error), 'error')).finally(() => { loading = false; });
  });
  async function select(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true; review = null; approved = false;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Il limite per i pacchetti e 20 MB.');
      const source = await file.text();
      review = { source, preview: await bridge.previewPackage(source) };
    } catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; input.value = ''; }
  }
  function report(warnings: string[], success: string) {
    context.notify(warnings.length ? `${success} ${warnings.join(' ')}` : success, warnings.length ? 'error' : 'info');
  }
  async function install() {
    if (!review || !approved) return;
    busy = true;
    try {
      const warnings = await bridge.installPackage(review.source, review.preview.digest);
      review = null; approved = false; await reload();
      report(warnings, 'Pacchetto installato.');
    } catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; }
  }
  async function change(id: string, action: string) {
    busy = true;
    try {
      const warnings = await bridge.changeApp(id, action, action === 'uninstall' && deleteData);
      removing = null; await reload(); report(warnings, 'Catalogo aggiornato.');
    } catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; }
  }
  function menuKeyboard(event: KeyboardEvent) {
    if (event.key === 'Escape' && installMenu.open) {
      event.stopPropagation(); installMenu.open = false;
      installMenu.querySelector('summary')?.focus();
    }
  }
</script>

<svelte:window onclick={event => { if (installMenu?.open && event.target instanceof Node && !installMenu.contains(event.target)) installMenu.open = false; }} />

<div class="page catalog-page">
  <div class="page-heading catalog-heading">
    <div><span class="eyebrow">IL TUO TOOLKIT</span><h1>App e catalogo</h1><p>Uno spazio per ogni app. Solo gli strumenti che scegli.</p></div>
    <details class="install-menu" bind:this={installMenu}>
      <summary class="button primary" onkeydown={menuKeyboard}><Icon name="plus" size={16} />Installa<Icon name="chevron" size={14} /></summary>
      <div class="install-options">
        <button disabled={!desktop || busy} onkeydown={menuKeyboard} onclick={() => { installMenu.open = false; fileInput.click(); }}>
          <Icon name="upload" size={18} /><span>Installazione manuale<small>Importa o aggiorna un file .orbit</small></span>
        </button>
        {#if available.length}
          <span class="menu-label">APP INCLUSE CON ORBIT</span>
          {#each available as starter}
            <button disabled={busy} onkeydown={menuKeyboard} onclick={() => { review = starter; approved = false; installMenu.open = false; }}>
              <Icon name={starter.preview.manifest.icon ?? 'grid'} size={18} /><span>{starter.preview.manifest.name}<small>Versione {starter.preview.manifest.version}</small></span>
            </button>
          {/each}
        {/if}
      </div>
    </details>
    <input hidden bind:this={fileInput} aria-label="Pacchetto Orbit" type="file" accept=".orbit,application/json" disabled={!desktop || busy} onchange={select} />
  </div>
  {#if !desktop}<div class="notice">Installazione e sotto-app isolate sono disponibili nell'app desktop. La preview mostra solo l'host.</div>{/if}
  {#if review}
    <section class="package-review" aria-label="Revisione pacchetto">
      <span class="eyebrow">CONFERMA INSTALLAZIONE</span>
      <h2>{review.preview.manifest.name} <small>v{review.preview.manifest.version} · SDK {review.preview.manifest.sdk}</small></h2>
      <p>{review.preview.manifest.description}</p>
      <div class="permission-tags">{#each review.preview.manifest.permissions as permission}<span>{permissionNames[permission] ?? permission}</span>{/each}</div>
      {#if review.preview.manifest.network?.connect.length}
        <div class="notice">Accesso di rete: questa app puo inviare dati alle destinazioni seguenti. Le connessioni usano fetch/WebSocket del browser; codice remoto e processi restano bloccati.</div>
        <ul aria-label="Destinazioni di rete autorizzate">{#each review.preview.manifest.network.connect as origin}<li><code>{origin}</code></li>{/each}</ul>
      {/if}
      {#each review.preview.manifest.dependencies ?? [] as dependency}<p class="fine-print">{dependency.required ? 'Richiede' : 'Supporta opzionalmente'}: {dependency.contract} v{dependency.version}{dependency.provider ? ` (${dependency.provider})` : ''}</p>{/each}
      <p class="muted">ID: {review.preview.manifest.id}. Un aggiornamento mantiene i dati. Termina prima l'app dal catalogo.</p>
      <div class="notice"><Icon name="shield" size={16} />Pacchetto locale non firmato: installa solo da fonti attendibili. Le chiavi AI restano in Orbit.</div>
      <label class="checkbox-field"><input type="checkbox" bind:checked={approved} /> Autorizzo questi permessi e l'installazione di questo pacchetto</label>
      <div class="package-actions"><button class="button primary" disabled={busy || !approved} onclick={install}>Installa pacchetto</button><button class="button secondary" disabled={busy} onclick={() => { review = null; }}>Annulla</button></div>
    </section>
  {/if}
  {#if available.some(starter => starter.preview.manifest.id === 'orbit-chat') || $installedApps.some(app => app.manifest.id === 'orbit-capture' && !app.manifest.exports?.length)}
    <div class="notice">Cattura e Chat sono ora app separate. Aggiorna Cattura dalla sua scheda e aggiungi Chat da Installa per usare lo scambio di immagini.</div>
  {/if}
  <div class="catalog-toolbar">
    <label class="catalog-search"><Icon name="search" size={16} /><input aria-label="Cerca app installate" placeholder="Cerca nelle tue app..." bind:value={query} /></label>
    <select aria-label="Filtra app" bind:value={filter}><option value="all">Tutte ({$installedApps.length})</option><option value="enabled">Abilitate</option><option value="disabled">Disabilitate</option></select>
  </div>
  {#if loading}<p class="muted" role="status">Caricamento catalogo...</p>
  {:else if !filtered.length}<div class="catalog-empty"><Icon name="grid" size={32} /><h2>{$installedApps.length ? 'Nessuna app corrispondente' : 'Il tuo toolkit parte da qui'}</h2><p class="muted">{$installedApps.length ? 'Modifica la ricerca o il filtro.' : 'Apri Installa per aggiungere le app incluse o un pacchetto locale.'}</p></div>{/if}
  <div class="package-grid">
    {#each filtered as app (app.manifest.id)}
      <section class:disabled-app={!app.enabled} class="package-card" aria-label={app.manifest.name}>
        <div class="package-card-top"><span class="tool-icon"><Icon name={app.manifest.icon ?? 'grid'} size={22} /></span><span class:enabled={app.enabled} class="app-status">{app.enabled ? 'Abilitata' : 'Disabilitata'}</span></div>
        <h2>{app.manifest.name}</h2><p class="muted package-description">{app.manifest.description}</p>
        <div class="package-meta"><span>v{app.manifest.version}</span><span>{(app.manifest.actions?.length ?? 0) + 1} azioni</span></div>
        {#if app.manifest.network?.connect.length}
          <details><summary>Accesso di rete ({app.manifest.network.connect.length})</summary><ul>{#each app.manifest.network.connect as origin}<li><code>{origin}</code></li>{/each}</ul></details>
        {/if}
        <div class="package-card-actions" role="group" aria-label={`Azioni ${app.manifest.name}`}>
          <button class="icon-button launch-icon" aria-label={`Apri ${app.manifest.name}`} title="Apri app" disabled={busy || !app.enabled} onclick={() => context.launchPackage(app.manifest.id)}><Icon name="play" size={18} /></button>
          <button class="icon-button" aria-label={`Impostazioni ${app.manifest.name}`} title="Preferenze e hotkey" onclick={() => context.appSettings(app.manifest.id)}><Icon name="settings" size={18} /></button>
          <button class="icon-button" aria-label={`${app.enabled ? 'Disabilita' : 'Abilita'} ${app.manifest.name}`} title={app.enabled ? 'Disabilita' : 'Abilita'} disabled={busy} onclick={() => change(app.manifest.id, app.enabled ? 'disable' : 'enable')}><Icon name="power" size={18} /></button>
          <button class="icon-button" aria-label={`Termina ${app.manifest.name}`} title="Termina app (non solo nascondi)" disabled={busy} onclick={() => change(app.manifest.id, 'close')}><Icon name="stop" size={17} /></button>
          {#each available.filter(starter => starter.preview.manifest.id === app.manifest.id) as update}
            <button class="icon-button" aria-label={`Aggiorna ${app.manifest.name}`} title={`Aggiorna a v${update.preview.manifest.version}`} disabled={busy} onclick={() => { review = update; approved = false; }}><Icon name="upload" size={18} /></button>
          {/each}
          {#if app.previousVersion}<button class="icon-button" aria-label={`Ripristina ${app.manifest.name} v${app.previousVersion}`} title={`Ripristina v${app.previousVersion}`} disabled={busy} onclick={() => change(app.manifest.id, 'rollback')}><Icon name="undo" size={18} /></button>{/if}
          <button class="icon-button danger" aria-label={`Disinstalla ${app.manifest.name}`} title="Disinstalla" disabled={busy} onclick={() => { removing = app.manifest.id; deleteData = false; }}><Icon name="trash" size={18} /></button>
        </div>
        {#if removing === app.manifest.id}
          <div class="removal-confirmation">
            <p>Rimuovere {app.manifest.name}? Termina prima l'app dal catalogo. Hotkey e timer saranno rimossi.</p>
            <label class="checkbox-field"><input type="checkbox" bind:checked={deleteData} /> Elimina anche i dati di questa app</label>
            <div class="package-actions"><button class="button secondary danger compact" disabled={busy} onclick={() => change(app.manifest.id, 'uninstall')}>Conferma rimozione</button><button class="button secondary compact" disabled={busy} onclick={() => { removing = null; }}>Annulla</button></div>
          </div>
        {/if}
      </section>
    {/each}
  </div>
  <p class="catalog-footnote"><Icon name="shield" size={14} />Pacchetti interni a Orbit, non app installate nel sistema. Preferenze e hotkey sono nel menu di ogni app.</p>
</div>
