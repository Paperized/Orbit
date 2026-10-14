<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { bridge, defaults, desktop } from '../lib/bridge';
  import { installedApps, settingsStatus } from '../lib/state';
  import { tools } from '../lib/registry';
  import { locale, applyLocale, text } from '../lib/locale';
  import type { Locale } from '../../sdk/src';
  import type { Settings, ToolProps, Provider, ThemeMode } from '../lib/types';
  let { context }: ToolProps = $props();
  let form = $state<Settings>({ ...defaults });
  let apiKey = $state('');
  let deleteKey = $state(false);
  let hasKey = $state(false);
  let savedScope = $state('');
  let busy = $state(false);
  let agentResult = $state('');
  let tab = $state('provider');
  let loaded = $state(false);
  let theme = $state<ThemeMode>('system');
  let themeBusy = $state(true);
  let languageBusy = $state(false);
  async function chooseLanguage(value: Locale) {
    languageBusy = true;
    try { await bridge.setLocale(value); if (!desktop) applyLocale(value); }
    catch (error) { context.notify(String(error), 'error'); }
    finally { languageBusy = false; }
  }
  let dataPath = $state('');
  const keyApplies = $derived(hasKey && savedScope === `${form.provider}|${form.baseUrl}`);

  onMount(() => {
    if (desktop) void bridge.dataLocation().then(path => { dataPath = path; }).catch(error => context.notify(String(error), 'error'));
    void bridge.getTheme().then(value => { theme = value; })
      .catch(error => context.notify(String(error), 'error')).finally(() => { themeBusy = false; });
    void bridge.getSettings().then(status => {
      form = { ...status.settings }; hasKey = status.hasKey;
      savedScope = `${form.provider}|${form.baseUrl}`; loaded = true;
    }).catch(error => context.notify(String(error), 'error'));
  });
  async function chooseTheme(mode: ThemeMode) {
    themeBusy = true;
    try { await bridge.setTheme(mode); theme = mode; }
    catch (error) { context.notify(String(error), 'error'); }
    finally { themeBusy = false; }
  }
  function changeProvider(provider: Provider) {
    form.provider = provider;
    form.baseUrl = provider === 'anthropic' ? 'https://api.anthropic.com/v1' : provider === 'openai' ? 'https://api.openai.com/v1' : '';
    form.model = ''; apiKey = ''; deleteKey = false;
  }
  async function save(): Promise<boolean> {
    const status = await bridge.saveSettings({ ...form }, apiKey || null, deleteKey);
    settingsStatus.set(status); form = { ...status.settings };
    hasKey = status.hasKey; savedScope = `${form.provider}|${form.baseUrl}`;
    apiKey = ''; deleteKey = false;
    return true;
  }
  async function action(test = false) {
    busy = true;
    try {
      await save();
      context.notify(test ? await bridge.testProvider() : 'Impostazioni salvate.');
    } catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; }
  }
  async function checkAgent() {
    busy = true; agentResult = '';
    try { agentResult = await bridge.checkAgent(form.agentExecutable); }
    catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; }
  }
</script>

<div class="page settings-page">
  <span class="eyebrow">{text($locale, 'FALLO TUO', 'MAKE IT YOURS')}</span><h1>{text($locale, 'Impostazioni', 'Settings')}<span class="accent-text">.</span></h1><p class="muted">{text($locale, 'Il tuo provider. I tuoi strumenti. Le tue regole.', 'Your provider. Your tools. Your rules.')}</p>
  <div class="settings-tabs" role="tablist" aria-label="Impostazioni">
    {#each [{ id: 'provider', label: 'Provider AI', english: 'AI provider', icon: 'spark' }, { id: 'agent', label: 'Backend agent', english: 'Agent backend', icon: 'terminal' }, { id: 'general', label: 'Generali', english: 'General', icon: 'settings' }] as item}
      <button role="tab" aria-selected={tab === item.id} class:active={tab === item.id} onclick={() => { tab = item.id; }}><Icon name={item.icon} size={16} />{text($locale, item.label, item.english)}</button>
    {/each}
  </div>
  {#if !desktop}<div class="notice">Preview browser: nessuna chiave viene memorizzata. Configurazione e verifiche sono disponibili nell'app desktop.</div>{/if}
  {#if tab === 'provider'}
    <section class="settings-section"><div class="section-heading"><h2>Connessione al modello</h2><span class="pill subtle">BRING YOUR OWN KEY</span></div><p class="muted">Usato da chat rapida e cattura. Indipendente dalla configurazione di OpenCode.</p>
      <div class="provider-options">
        {#each [{ id: 'openai', title: 'OpenAI', detail: 'API ufficiale', symbol: 'O' }, { id: 'compatible', title: 'Compatibile OpenAI', detail: 'Cloud o server locale', symbol: '<>' }, { id: 'anthropic', title: 'Claude', detail: 'Anthropic API', symbol: 'A' }] as provider}
          <button class:selected={form.provider === provider.id} class="provider-option" disabled={busy} onclick={() => changeProvider(provider.id as Provider)}><span class="provider-symbol">{provider.symbol}</span><strong>{provider.title}</strong><small>{provider.detail}</small><span class="radio-dot"></span></button>
        {/each}
      </div>
      {#if form.provider === 'compatible'}<label class="field">Base URL<input type="url" bind:value={form.baseUrl} placeholder="http://localhost:11434/v1" disabled={busy} /><small>Endpoint Chat Completions, incluso il prefisso /v1 se richiesto. HTTP consentito solo su loopback.</small></label>{/if}
      <label class="field">API key <span class="field-hint">{keyApplies ? 'Chiave salvata per questo endpoint' : form.provider === 'compatible' ? 'Facoltativa per server senza autenticazione' : 'Richiesta'}</span><input type="password" autocomplete="new-password" spellcheck="false" bind:value={apiKey} disabled={busy || !desktop} placeholder={keyApplies ? 'Lascia vuoto per mantenere la chiave' : 'Incolla la tua API key'} /></label>
      {#if keyApplies}<label class="checkbox-field"><input type="checkbox" bind:checked={deleteKey} disabled={busy} /> Rimuovi la chiave salvata per questo endpoint</label>{/if}
      <label class="field">Modello<input bind:value={form.model} placeholder={form.provider === 'anthropic' ? 'ID del modello Claude' : 'ID del modello del tuo provider'} disabled={busy} /><small>Inserisci l'ID esatto. Per analizzare catture serve un modello con supporto immagini.</small></label>
      <div class="notice"><Icon name="shield" size={18} /><span>Le chiavi sono conservate nel portachiavi del sistema. Solo i messaggi e le immagini che invii raggiungono il provider selezionato. Cambiare endpoint non trasferisce la sua chiave.</span></div>
      <div class="settings-actions"><button class="button secondary" disabled={busy || !desktop || !loaded} onclick={() => action(true)}>Salva e verifica <Icon name="check" size={16} /></button><button class="button primary" disabled={busy || !desktop || !loaded} onclick={() => action()}>{busy ? 'Operazione in corso...' : 'Salva impostazioni'}</button></div>
      <p class="fine-print">La verifica invia un breve messaggio di testo al modello e puo avere un costo. Non certifica il supporto immagini. Gli abbonamenti alle app ChatGPT/Claude non equivalgono al credito API.</p>
    </section>
  {:else if tab === 'agent'}
    <section class="settings-section"><div class="section-heading"><h2>Backend agent</h2><span class="pill subtle">OPENCODE</span></div>
      <div class="agent-card"><span class="tool-icon purple"><Icon name="terminal" size={27} /></span><div><h3>OpenCode</h3><p>Installazione e credenziali restano sotto il tuo controllo.</p></div></div>
      <label class="checkbox-field"><input type="checkbox" bind:checked={form.agentEnabled} disabled={busy} /> Seleziona OpenCode come backend agent</label>
      <label class="field">Eseguibile<input bind:value={form.agentExecutable} placeholder="opencode oppure percorso assoluto" disabled={busy} /><small>Solo un eseguibile attendibile, senza argomenti. Su macOS le app GUI possono avere un PATH diverso dal terminale.</small></label>
      <div class="notice"><Icon name="terminal" size={18} /><span>Questa demo salva la scelta e verifica <code>opencode --version</code>. Non esegue ancora task agentici. Chat e cattura usano il provider AI della scheda precedente.</span></div>
      <p class="muted">Installa e configura OpenCode separatamente: la nostra app non legge, copia o modifica le sue chiavi API.</p>
      {#if agentResult}<div class="success-message" role="status"><Icon name="check" size={17} />{agentResult}</div>{/if}
      <div class="settings-actions"><button class="button secondary" disabled={busy || !desktop} onclick={checkAgent}>Verifica installazione</button><button class="button primary" disabled={busy || !desktop || !loaded} onclick={() => action()}>Salva impostazioni</button></div>
    </section>
  {:else}
    <section class="settings-section">
      <div class="section-heading"><h2>{text($locale, 'Lingua', 'Language')}</h2></div>
      <label class="field">{text($locale, 'Lingua di Orbit e delle app', 'Orbit and app language')}
        <select aria-label={text($locale, 'Lingua', 'Language')} value={$locale} disabled={languageBusy} onchange={event => chooseLanguage(event.currentTarget.value as Locale)}>
          <option value="it">Italiano</option><option value="en">English</option>
        </select>
      </label>
      <p class="muted">{text($locale, 'La scelta viene salvata e comunicata alle app aperte. Ogni app fornisce le proprie traduzioni.', 'Your choice is saved and shared with open apps. Each app provides its own translations.')}</p>
    </section>
    {#if desktop}
      <section class="settings-section">
        <div class="section-heading"><h2>Cartella dati</h2><span>ARCHIVIO CENTRALIZZATO</span></div>
        <p class="muted" style="overflow-wrap:anywhere">{dataPath || 'Caricamento percorso...'}</p>
        <p class="fine-print">Impostazioni in host; pacchetti e dati separati in apps; cache WebView in runtime su Windows. Le chiavi API restano nel portachiavi del sistema. La lettura di file esterni richiede il permesso esplicito dell’app; la scrittura resta nella sua cartella.</p>
      </section>
    {/if}
    <section class="settings-section appearance-settings">
      <div class="section-heading"><h2>Aspetto</h2><span>SALVATAGGIO AUTOMATICO</span></div>
      <p class="muted">Scegli il tema di Orbit e delle sotto-app. Automatico segue il tema del computer, anche quando cambia.</p>
      <div class="theme-options" role="group" aria-label="Tema">
        {#each [{ id: 'light' as const, label: 'Chiaro', icon: 'sun' }, { id: 'dark' as const, label: 'Scuro', icon: 'moon' }, { id: 'system' as const, label: 'Automatico', icon: 'monitor' }] as option}
          <button class:active={theme === option.id} aria-pressed={theme === option.id} disabled={themeBusy} onclick={() => chooseTheme(option.id)}><Icon name={option.icon} size={20} /><span>{option.label}</span>{#if theme === option.id}<Icon name="check" size={16} />{/if}</button>
        {/each}
      </div>
    </section>
    <section class="settings-section"><h2>Scorciatoie globali</h2><p class="muted">Control anche su macOS, non Command. Le hotkey di apertura mostrano o nascondono l'app; quelle delle funzioni eseguono l'azione indicata.</p>
      {#each tools.filter(tool => tool.shortcut && (!desktop || tool.id !== 'capture')) as tool}<div class="shortcut-row"><span><Icon name={tool.icon} size={18} />{tool.name}</span><kbd>{tool.shortcut?.replace('+', ' + ')}</kbd></div>{/each}
      {#each $installedApps.filter(app => app.enabled) as app}
        {#if app.shortcutOverride ?? app.manifest.shortcut}<div class="shortcut-row"><button class="text-button" onclick={() => context.appSettings(app.manifest.id)}>{app.manifest.name} · Apri / nascondi</button><kbd>{app.shortcutOverride ?? app.manifest.shortcut}</kbd></div>{/if}
        {#each app.manifest.actions ?? [] as action}
          {#if app.actionShortcuts?.[action.id] ?? action.shortcut}<div class="shortcut-row"><button class="text-button" onclick={() => context.appSettings(app.manifest.id)}>{app.manifest.name} · {action.label}</button><kbd>{app.actionShortcuts?.[action.id] ?? action.shortcut}</kbd></div>{/if}
        {/each}
      {/each}
      <button class="text-button" onclick={() => context.launch('catalog')}>Gestisci app e impostazioni</button>
      <div class="shortcut-row"><span>Nascondi overlay</span><kbd>Esc</kbd></div>
      <div class="notice">Ctrl+E apre Orbit. Per preferenze e hotkey scegli l'app nella sidebar: questa voce apre le sue impostazioni, non la finestra dell'app. Le scorciatoie sono globali mentre Orbit e in esecuzione e l'app e abilitata.</div>
      <h2 class="spaced-heading">Dati e funzionamento</h2><p class="muted">Chat e screenshot restano solo in memoria nella demo. Gli appunti e le impostazioni persistono sul dispositivo. Nessuna registrazione continua e nessun modello locale caricato in background.</p>
      <div class="settings-actions"><span class="fine-print">Orbit 0.1 · Windows + macOS · Borderless</span><button class="button secondary danger" disabled={!desktop} onclick={() => { void bridge.quit().catch(error => context.notify(String(error), 'error')); }}><Icon name="power" size={16} /> Esci da Orbit</button></div>
    </section>
  {/if}
</div>
