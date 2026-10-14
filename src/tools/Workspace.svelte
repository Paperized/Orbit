<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { workspacePage } from '../lib/workspace-state';
  import Home from './Home.svelte';
  import Icon from '../components/Icon.svelte';
  import { presetBridge } from '../lib/preset-bridge';
  import { bridge, desktop } from '../lib/bridge';
  import { componentIds, newPreset, presetLimit, type OverlayPreset, type PresetDocument } from '../lib/presets';
  import { locale, text } from '../lib/locale';
  import { layoutWriter } from '../lib/layout-geometry';
  import type { ToolProps } from '../lib/types';
  let { context }: ToolProps = $props();
  let document = $state<PresetDocument>({ version: 1, presets: [] });
  let selected = $state<string | null>(get(workspacePage));
  $effect(() => { workspacePage.set(selected); });
  let active = $state<string | null>(null);
  let loading = $state(true), busy = $state(0), error = $state('');
  let name = $state(''), creating = $state(false), removing = $state(false);
  let nameInput = $state<HTMLInputElement>(null!);
  let swipe: { x: number; y: number } | null = null;
  let write = $state<ReturnType<typeof layoutWriter<PresetDocument>>>();
  const preset = $derived(document.presets.find(p => p.id === selected));
  onMount(() => {
    void Promise.all([presetBridge.read(), presetBridge.status()]).then(([data, status]) => {
      document = data; active = status.activeId;
      write = layoutWriter(data, next => presetBridge.save(next), next => { document = next; });
    }).catch(reason => { error = String(reason); }).finally(() => { loading = false; });
  });
  async function commit(mutate: (doc: PresetDocument) => PresetDocument) {
    if (!write) throw new Error('Preset non disponibili.');
    busy++;
    try { await write(mutate); error = ''; }
    catch (reason) { error = String(reason); throw reason; }
    finally { busy--; }
  }
  async function savePreset(next: OverlayPreset) {
    const ids = new Set(componentIds(next));
    await commit(doc => ({ ...doc, presets: doc.presets.map(p => p.id === next.id
      ? { ...next, clickThrough: next.clickThrough.filter(id => ids.has(id)) } : p) }));
  }
  function choose(id: string | null) {
    if (busy) return;
    selected = id; removing = false;
  }
  function cycle(direction: number) {
    const ids = [null, ...document.presets.map(p => p.id)];
    choose(ids[(ids.indexOf(selected) + direction + ids.length) % ids.length]);
  }
  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim() || busy || document.presets.length >= presetLimit) return;
    busy++;
    try {
      const next = newPreset(name.trim(), await presetBridge.monitor());
      await commit(doc => ({ ...doc, presets: [...doc.presets, next] }));
      selected = next.id; name = ''; creating = false;
    } catch (reason) { error = String(reason); }
    finally { busy--; }
  }
  async function activate() {
    if (!preset || busy) return;
    busy++;
    try { await presetBridge.apply(active === preset.id ? null : preset.id); active = active === preset.id ? null : preset.id; error = ''; }
    catch (reason) { error = String(reason); }
    finally { busy--; }
  }
  async function remove() {
    if (!preset || busy) return;
    const id = preset.id;
    try {
      if (active === id) { await presetBridge.apply(null); active = null; }
      await commit(doc => ({ ...doc, presets: doc.presets.filter(p => p.id !== id) }));
      selected = null; removing = false;
    } catch (reason) { error = String(reason); }
  }
  async function copyHub() {
    if (!preset || busy) return;
    busy++;
    try {
      const layout = await bridge.getHomeLayout();
      await savePreset({ ...preset, layout: { ...layout, rects: { ...preset.layout.rects, ...layout.rects }, editing: true },
        builtins: ['logo', 'search', ...(layout.favoritesVisible ? ['favorites' as const] : []), ...(layout.dockVisible ? ['dock' as const] : [])], clickThrough: [] });
      // Remount the editor with the imported layout, without changing the hub.
      revision++;
    } catch (reason) { error = String(reason); }
    finally { busy--; }
  }
  let revision = $state(0);
</script>

<svelte:window onkeydown={event => {
  if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)
    && !window.document.querySelector('dialog[open]')) {
    event.preventDefault(); cycle(event.key === 'ArrowRight' ? 1 : -1);
  }
}} />

<div class="workspace" class:preset-workspace={!!preset} role="presentation"
  onkeydown={event => {
    if (event.key === 'Escape' && (creating || removing)) {
      event.preventDefault(); event.stopPropagation(); creating = false; removing = false;
    }
  }}
  ontouchstart={event => {
    if ((event.target as Element).closest('button,input,textarea,select,.widget-frame,dialog')) return;
    const touch = event.touches[0]; swipe = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }}
  ontouchend={event => {
    const touch = event.changedTouches[0];
    if (swipe && touch && Math.abs(touch.clientX - swipe.x) > 90 && Math.abs(touch.clientY - swipe.y) < 60) cycle(touch.clientX < swipe.x ? 1 : -1);
    swipe = null;
  }}>
  <nav class="workspace-switcher" aria-label={text($locale, 'Spazi overlay', 'Overlay spaces')}>
    <div class="workspace-tabs" role="tablist" tabindex="-1" aria-label={text($locale, 'Hub e preset', 'Hub and presets')}
      onkeydown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]?.focus();
      }}>
      <button role="tab" aria-selected={!selected} class:current={!selected} onclick={() => choose(null)}><Icon name="grid" size={15} />Hub</button>
      {#each document.presets as p (p.id)}
        <button role="tab" aria-selected={selected === p.id} class:current={selected === p.id} onclick={() => choose(p.id)}>
          {#if active === p.id}<span class="live-dot"></span>{:else}<Icon name="monitor" size={15} />{/if}
          <span>{p.name}</span>
        </button>
      {/each}
    </div>
    <button class="new-preset" aria-label={text($locale, 'Nuovo preset', 'New preset')} title="Nuovo preset"
      disabled={loading || busy > 0 || !write || document.presets.length >= presetLimit}
      onclick={async () => { creating = !creating; name = ''; if (creating) { await tick(); nameInput?.focus(); } }}><Icon name="plus" size={18} /></button>
  </nav>
  {#if creating}
    <form class="create-preset" onsubmit={create}>
      <label>{text($locale, 'Nome del preset', 'Preset name')}<input bind:this={nameInput} aria-label={text($locale, 'Nome del preset', 'Preset name')} bind:value={name} maxlength="80" required placeholder="Gaming / Focus / Work" /></label>
      <button class="button primary" disabled={busy > 0 || !name.trim()}>{text($locale, 'Crea', 'Create')}</button>
      <button type="button" class="icon-button" aria-label="Annulla nuovo preset" onclick={() => { creating = false; }}><Icon name="close" size={16} /></button>
    </form>
  {/if}
  {#if error}<div class="workspace-error" role="alert">{error}</div>{/if}
  {#if preset}
    {#key `${preset.id}:${revision}`}<Home {context} {preset} persistPreset={savePreset} />{/key}
    {#if componentIds(preset).length === 0}
      <div class="preset-empty"><Icon name="monitor" size={36} /><h1>{text($locale, 'Il tuo prossimo spazio.', 'Your next workspace.')}</h1>
        <p>{text($locale, 'Aggiungi componenti dal pulsante + a destra, oppure parti dal tuo hub.', 'Add components with the + button on the right, or start from your hub.')}</p>
        <button class="button secondary" disabled={busy > 0} onclick={copyHub}>{text($locale, 'Copia il layout dell’hub', 'Copy hub layout')}</button>
      </div>
    {/if}
    <section class="preset-console" aria-label={text($locale, 'Controlli preset', 'Preset controls')}>
      <div class="preset-identity"><small>{active === preset.id ? text($locale, 'PRESET ATTIVO', 'ACTIVE PRESET') : text($locale, 'EDITOR PERSISTENTE', 'PERSISTENT EDITOR')}</small>
        <input aria-label={text($locale, 'Rinomina preset', 'Rename preset')} value={preset.name} maxlength="80" disabled={busy > 0}
          onchange={event => {
            const input = event.currentTarget, value = input.value.trim();
            if (!value) { input.value = preset!.name; return; }
            void savePreset({ ...preset!, name: value }).catch(reason => { error = String(reason); input.value = preset!.name; });
          }} />
      </div>
      <div class="preset-instructions">
        <strong>{text($locale, 'Posiziona. Personalizza. Applica.', 'Arrange. Customize. Apply.')}</strong>
        <span>{text($locale, 'Il puntatore sulla maniglia imposta i clic. Le modifiche compaiono uscendo dall’hub.', 'The pointer on each handle controls clicks. Changes appear when you leave the hub.')}</span>
      </div>
      <button class="icon-button" aria-label={text($locale, 'Elimina preset', 'Delete preset')} disabled={busy > 0} onclick={() => { removing = !removing; }}><Icon name="trash" size={18} /></button>
      <button class="preset-apply" class:applied={active === preset.id} disabled={busy > 0 || (active !== preset.id && !componentIds(preset).length)} onclick={activate}>
        <Icon name={active === preset.id ? 'eye-off' : 'play'} size={17} />{active === preset.id ? 'HIDE' : 'APPLY'}
      </button>
    </section>
    {#if removing}
      <div class="delete-preset" role="group" aria-label="Conferma eliminazione preset">
        <span>{text($locale, 'Eliminare questo preset? I dati delle app restano intatti.', 'Delete this preset? App data is kept.')}</span>
        <button class="button secondary" onclick={() => { removing = false; }}>{text($locale, 'Annulla', 'Cancel')}</button>
        <button class="button primary" disabled={busy > 0} onclick={remove}>{text($locale, 'Elimina', 'Delete')}</button>
      </div>
    {/if}
  {:else}<Home {context} />{/if}
  {#if !preset && active}<div class="active-preset-badge"><span class="live-dot"></span>{document.presets.find(p => p.id === active)?.name} · {text($locale, 'visibile fuori dall’hub', 'visible outside the hub')}</div>{/if}
  {#if !desktop}<span class="preview-preset-note">{text($locale, 'Preview web: i widget sempre in primo piano richiedono l’app desktop.', 'Web preview: always-on-top widgets require the desktop app.')}</span>{/if}
</div>

<style>
  .workspace{height:100%;position:relative;isolation:isolate}
  .workspace-switcher{position:absolute;z-index:48;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;max-width:calc(100% - 600px);padding:4px;background:var(--hub-surface);border:1px solid var(--hub-line);border-radius:12px;box-shadow:0 12px 32px #0002}
  .workspace-switcher{pointer-events:none}.workspace-switcher button{pointer-events:auto}
  .workspace-tabs{display:flex;overflow:auto;gap:4px}.workspace-tabs button{display:flex;align-items:center;gap:8px;border-radius:8px;padding:9px 14px;white-space:nowrap;color:var(--muted);font-size:12px}.workspace-tabs button span:not(.live-dot){max-width:140px;overflow:hidden;text-overflow:ellipsis}
  .workspace-tabs .current{background:var(--line);color:var(--orbit-text)}.new-preset{display:grid;place-items:center;width:34px;flex:none;color:var(--accent)}
  .live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}
  .create-preset{position:absolute;z-index:60;top:68px;left:50%;transform:translateX(-50%);display:flex;align-items:end;gap:12px;background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 16px 50px #0004;max-width:calc(100% - 32px)}
  label{font-size:11px;color:var(--muted)}input{display:block;min-width:0;background:transparent;color:inherit;border:0;font:inherit}
  label input{margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:10px;width:210px;max-width:100%}
  .preset-console{position:absolute;z-index:40;bottom:20px;left:50%;transform:translateX(-50%);width:min(850px,calc(100% - 40px));display:flex;align-items:center;gap:18px;padding:16px 18px;border:1px solid var(--hub-line);background:var(--hub-surface);border-radius:16px;box-shadow:0 18px 50px #0003}
  .preset-identity{min-width:100px;max-width:220px;flex:1}.preset-identity small{font-size:9px;letter-spacing:1.5px;color:var(--accent);margin-bottom:7px}.preset-identity input{width:100%;font-size:16px;font-weight:600}
  .preset-instructions{flex:2;display:flex;flex-direction:column;gap:4px;font-size:12px}.preset-instructions span{font-size:11px;line-height:1.5;color:var(--muted)}
  .preset-apply{display:flex;align-items:center;justify-content:center;gap:10px;min-width:110px;padding:13px 18px;background:var(--accent);color:var(--workspace-ink,#111a17);border-radius:10px;font-weight:700;font-size:12px;letter-spacing:1px}
  .preset-apply.applied{background:var(--line);color:var(--orbit-text)}
  .preset-empty{position:absolute;inset:25% 22% 30%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px;pointer-events:none}
  .preset-empty :global(svg){color:var(--accent)}.preset-empty h1{font-size:32px}.preset-empty p{color:var(--muted);max-width:400px;font-size:13px}.preset-empty button{pointer-events:auto}
  .workspace-error,.delete-preset{position:absolute;z-index:65;left:50%;transform:translateX(-50%);background:var(--bg);border:1px solid var(--accent);border-radius:12px;padding:16px;max-width:calc(100% - 32px);font-size:12px}
  .workspace-error{top:72px}.delete-preset{bottom:112px;display:flex;align-items:center;gap:12px}
  .active-preset-badge{position:absolute;bottom:8px;left:16px;font-size:10px;color:var(--muted);display:flex;align-items:center;gap:8px}
  .preview-preset-note{position:absolute;bottom:4px;right:16px;font-size:9px;color:var(--muted);pointer-events:none}
  @media(max-width:1000px){.workspace-switcher{top:52px;max-width:calc(100% - 110px)}.create-preset{top:104px}.preset-instructions{display:none}.preset-empty{inset:25% 10%}.preset-console{gap:8px}}
  @media(prefers-reduced-motion:no-preference){.preset-console,.create-preset{animation:appear .18s ease-out}@keyframes appear{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}}
</style>
