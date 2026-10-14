<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Home from './tools/Home.svelte';
  import WidgetImage from './components/WidgetImage.svelte';
  import { bridge } from './lib/bridge';
  import { presetBridge } from './lib/preset-bridge';
  import { applyLocale } from './lib/locale';
  import type { PersistentView } from './lib/presets';
  import type { ToolContext } from './lib/types';
  let view = $state<PersistentView | null>(null), error = $state('');
  const context: ToolContext = {
    launch: async id => { try { await bridge.open(id); } catch (reason) { error = String(reason); } },
    hide: () => Promise.resolve(),
    launchPackage: id => bridge.launchPackage(id),
    appSettings: () => { void bridge.open('home').catch(reason => { error = String(reason); }); },
    notify: message => { error = message; },
  };
  onMount(() => {
    window.document.documentElement.classList.add('persistent-window');
    void Promise.all([presetBridge.view(), bridge.getTheme(), bridge.getLocale()]).then(async ([data, theme, locale]) => {
      window.dispatchEvent(new CustomEvent('orbit:theme', { detail: theme }));
      applyLocale(locale); view = data; await tick(); await presetBridge.ready();
    }).catch(reason => { error = String(reason); });
  });
</script>
<div class="persistent-surface">
  {#if view?.image}
    <WidgetImage {...view.image} close={() => { void presetBridge.closePreview().catch(reason => { error = String(reason); }); }} />
  {:else if view}<Home {context} preset={view.preset} only={view.component} />{/if}
  {#if error}<div class="persistent-error" role="alert">{error}</div>{/if}
</div>
<style>
  .persistent-surface{height:100dvh;width:100vw;overflow:hidden;color:var(--orbit-text)}
  .persistent-error{position:absolute;inset:auto 4px 4px;padding:10px;background:var(--bg);border:1px solid var(--accent);border-radius:8px;font-size:11px;overflow-wrap:anywhere}
</style>
