<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import HotkeyInput from '../components/HotkeyInput.svelte';
  import { bridge } from '../lib/bridge';
  import { installedApps } from '../lib/state';
  import type { InstalledApp, ToolContext, PreferenceValues, ShortcutBinding, DependencyStatus } from '../lib/types';
  let { app, context }: { app: InstalledApp; context: ToolContext } = $props();
  let values = $state<PreferenceValues>({});
  let saved = $state('');
  let loading = $state(true);
  let preferencesError = $state('');
  let busy = $state(false);
  let bindings = $state<ShortcutBinding[]>([]);
  let dependency = $state<DependencyStatus | undefined>();
  let drafts = $state<Record<string, string>>({});
  let conflicts = $state<{ actionId: string; shortcut: string; owners: ShortcutBinding[] } | null>(null);
  const ownBindings = $derived(bindings.filter(binding => binding.appId === app.manifest.id));
  const dirty = $derived(JSON.stringify(values) !== saved);
  async function loadBindings(savedAction?: string) {
    const previous = bindings;
    const next = await bridge.listShortcuts();
    drafts = Object.fromEntries(next.filter(b => b.appId === app.manifest.id).map(b => {
      const old = previous.find(old => old.appId === b.appId && old.actionId === b.actionId);
      const preserve = old && b.actionId !== savedAction && drafts[b.actionId] !== (old.shortcut ?? '');
      return [b.actionId, preserve ? drafts[b.actionId] : b.shortcut ?? ''];
    }));
    bindings = next;
  }
  onMount(() => {
    void Promise.all([
      bridge.getAppPreferences(app.manifest.id).then(result => { values = result; saved = JSON.stringify(result); })
        .catch(error => { preferencesError = String(error); }),
      loadBindings(),
      bridge.dependencies().then(result => { dependency = result.find(item => item.id === app.manifest.id); }),
    ]).catch(error => context.notify(String(error), 'error')).finally(() => { loading = false; });
  });
  async function savePreferences(reset = false) {
    busy = true;
    try {
      values = await bridge.setAppPreferences(app.manifest.id, reset ? {} : values, reset);
      saved = JSON.stringify(values); preferencesError = '';
      context.notify(reset ? 'Preferenze ripristinate.' : 'Preferenze salvate e applicate.');
    } catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; }
  }
  async function recoverWindows() {
    busy = true;
    try {
      await bridge.changeApp(app.manifest.id, 'reset-geometry');
      context.notify('Posizioni e dimensioni delle finestre ripristinate. Contenuti invariati.');
    } catch (error) { context.notify(String(error), 'error'); }
    finally { busy = false; }
  }
  async function saveShortcut(actionId: string, replace = false) {
    busy = true;
    try {
      const resumed = await bridge.setShortcutRecording(false);
      if (resumed.length) context.notify(resumed.join(' '), 'error');
      const shortcut = drafts[actionId].trim();
      const owners = replace && conflicts ? conflicts.owners.map(({ appId, actionId }) => ({ appId, actionId })) : null;
      if (!replace) {
        const found = await bridge.checkAppShortcut(app.manifest.id, actionId, shortcut);
        if (found.length) { conflicts = { actionId, shortcut, owners: found }; return; }
      }
      const warnings = await bridge.setActionShortcut(app.manifest.id, actionId, shortcut, owners);
      conflicts = null;
      await loadBindings(actionId); installedApps.set(await bridge.listApps());
      context.notify(warnings.length ? warnings.join(' ') : 'Hotkey aggiornata.', warnings.length ? 'error' : 'info');
    } catch (error) {
      conflicts = null;
      context.notify(String(error), 'error');
    } finally { busy = false; }
  }
</script>

<div class="page app-settings-page">
  <div class="page-heading">
    <div class="app-settings-title"><span class="tool-icon"><Icon name={app.manifest.icon ?? 'grid'} size={24} /></span><div><span class="eyebrow">IMPOSTAZIONI APP</span><h1>{app.manifest.name}</h1></div></div>
    <span class:enabled={app.enabled} class="app-status">{app.enabled ? 'Abilitata' : 'Disabilitata'}</span>
  </div>
  <p class="muted">{app.manifest.description}</p>
  <p class="fine-print">v{app.manifest.version} · {app.manifest.id} · Questa pagina non apre la sotto-app.</p>
  <button class="button secondary" disabled={busy} onclick={recoverWindows}>Recupera finestre: posizione e dimensioni</button>
  {#if !app.enabled}<div class="notice">App disabilitata: puoi configurarla, ma le hotkey saranno attive solo dopo la riabilitazione dal catalogo.</div>{/if}
  {#if app.enabled && dependency && !dependency.ready}<div class="inline-error" role="alert">Dipendenze obbligatorie mancanti: installa o abilita un fornitore compatibile prima di avviare l'app.</div>{/if}
  {#if dependency?.dependencies.length || app.manifest.exports?.length}
    <section class="app-settings-section" aria-label="Funzioni e dipendenze">
      <h2>Funzioni condivise</h2>
      {#each app.manifest.exports ?? [] as feature}
        <div class="app-shortcut-row"><div><strong>{feature.title}</strong><small>{feature.description}</small><small>{feature.contract} v{feature.version} · {feature.mode === 'handoff' ? 'Apre questa app' : 'Restituisce un risultato'}</small></div></div>
      {/each}
      {#each dependency?.dependencies ?? [] as item}
        <div class="app-shortcut-row"><div><strong>{item.contract} v{item.version} · {item.required ? 'Obbligatoria' : 'Opzionale'}</strong><small>{item.providers.length ? item.providers.map(provider => `${provider.appName} / ${provider.feature.title}`).join(', ') : 'Nessun fornitore disponibile'}</small></div></div>
      {/each}
    </section>
  {/if}
  {#if loading}<p class="notice" role="status">Caricamento impostazioni...</p>
  {:else}
    <section class="app-settings-section" aria-label="Preferenze app">
      <div class="section-heading"><h2><Icon name="settings" size={16} />Preferenze</h2><span>SALVATE SUL DISPOSITIVO</span></div>
      {#if preferencesError}<div class="inline-error" role="alert">{preferencesError}</div>{/if}
      {#if app.manifest.preferences?.length}
        {#if !preferencesError}
          <div class="preference-fields">
            {#each app.manifest.preferences as preference}
              {#if preference.type === 'boolean'}
                <label class="preference-toggle"><span>{preference.label}<small>{preference.description ?? ''}</small></span><input type="checkbox" role="switch" checked={values[preference.id] === true} disabled={busy} onchange={event => { values[preference.id] = event.currentTarget.checked; }} /></label>
              {:else}
                <label class="field">{preference.label}
                  {#if preference.type === 'select'}
                    <select value={String(values[preference.id] ?? '')} disabled={busy} onchange={event => { values[preference.id] = event.currentTarget.value; }}>{#each preference.options as option}<option value={option.value}>{option.label}</option>{/each}</select>
                  {:else if preference.type === 'number'}
                    <input type="number" min={preference.min} max={preference.max} step="any" value={Number(values[preference.id])} disabled={busy} oninput={event => { values[preference.id] = event.currentTarget.value === '' ? '' : event.currentTarget.valueAsNumber; }} />
                  {:else}
                    <input type="text" maxlength="2000" value={String(values[preference.id] ?? '')} disabled={busy} oninput={event => { values[preference.id] = event.currentTarget.value; }} />
                  {/if}
                  <small>{preference.description ?? ''}</small>
                </label>
              {/if}
            {/each}
          </div>
        {/if}
        <div class="settings-actions"><span class="muted">{dirty && !preferencesError ? 'Modifiche non salvate' : ''}</span><button class="button secondary" disabled={busy} onclick={() => savePreferences(true)}>Ripristina predefinite</button><button class="button primary" disabled={busy || !dirty || !!preferencesError} onclick={() => savePreferences()}>Salva preferenze</button></div>
      {:else}<p class="muted">Questa versione dell'app non espone preferenze.</p>{/if}
    </section>
    <section class="app-settings-section" aria-label="Hotkey app">
      <div class="section-heading"><h2><Icon name="key" size={16} />Azioni e hotkey</h2><span>GESTITE DA ORBIT</span></div>
      <p class="muted">Clicca il campo e premi la combinazione, poi conferma con la spunta. Esc annulla; la × rimuove la hotkey. Durante la selezione le hotkey di Orbit sono sospese.</p>
      {#each ownBindings as binding}
        <div class="app-shortcut-row">
          <div><strong>{binding.label}</strong><small>{binding.actionId === 'open' ? 'Mostra o nasconde la finestra, salvo quando il pin la mantiene aperta.' : app.manifest.actions?.find(action => action.id === binding.actionId)?.description}</small>
            {#if binding.shortcut}<small class:shortcut-warning={binding.enabled && !binding.registered}>{!binding.enabled ? 'Inattiva: app disabilitata' : binding.registered ? 'Attiva' : 'Non disponibile: cambia combinazione'}</small>{/if}
          </div>
          <div class="shortcut-editor">
            <HotkeyInput label={binding.label} bind:value={drafts[binding.actionId]} disabled={busy}
              onchange={() => { conflicts = null; }} onclear={() => { void saveShortcut(binding.actionId); }}
              onerror={error => context.notify(error, 'error')} />
            <button class="icon-button" aria-label={`Salva hotkey ${binding.label}`} title="Salva hotkey" disabled={busy || drafts[binding.actionId] === (binding.shortcut ?? '')} onclick={() => saveShortcut(binding.actionId)}><Icon name="check" size={18} /></button>
          </div>
        </div>
        {#if conflicts?.actionId === binding.actionId}
          <div class="shortcut-conflict" role="alert">
            <strong>{conflicts.shortcut} e gia in uso</strong>
            <p>{conflicts.owners.map(owner => `${owner.appName} / ${owner.label}${owner.enabled ? '' : ' (app disabilitata)'}`).join(', ')}</p>
            {#if conflicts.owners.some(owner => owner.appId === null)}
              <p>Le hotkey di Orbit sono riservate. Scegli un'altra combinazione.</p>
            {:else}
              <p>Sostituendo, queste assegnazioni saranno rimosse. Le altre funzioni delle app non cambiano.</p>
              <button class="button secondary" disabled={busy} onclick={() => saveShortcut(binding.actionId, true)}>Sostituisci assegnazioni</button>
            {/if}
            <button class="button secondary" disabled={busy} onclick={() => { conflicts = null; }}>Annulla</button>
          </div>
        {/if}
      {/each}
      <details class="shortcut-directory"><summary>Combinazioni gia assegnate in Orbit</summary>
        {#each bindings.filter(binding => binding.shortcut) as binding}<div class="shortcut-row"><span>{binding.appName} · {binding.label}{!binding.enabled ? ' (disabilitata)' : ''}</span><kbd>{binding.shortcut}</kbd></div>{/each}
      </details>
      <p class="fine-print">Orbit controlla le proprie assegnazioni, anche delle app disabilitate. I conflitti con altre applicazioni o il sistema vengono verificati al salvataggio di una hotkey attiva.</p>
    </section>
  {/if}
</div>
