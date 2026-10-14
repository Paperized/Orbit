import { invoke } from '@tauri-apps/api/core';
import { desktop } from './bridge';
import { readPresets, type PresetDocument, type PresetMonitor, type PresetStatus, type PersistentView } from './presets';
let activeId: string | null = null;
export const presetBridge = {
  async read(): Promise<PresetDocument> {
    return readPresets(desktop ? await invoke('get_overlay_presets') : JSON.parse(localStorage.getItem('orbit.presets') ?? '{"version":1,"presets":[]}'));
  },
  async save(document: PresetDocument): Promise<void> {
    const data = readPresets(document);
    if (desktop) await invoke('save_overlay_presets', { document: data });
    else { localStorage.setItem('orbit.presets', JSON.stringify(data)); if (!data.presets.some(p => p.id === activeId)) activeId = null; }
  },
  async status(): Promise<PresetStatus> { return desktop ? invoke('overlay_preset_status') : { activeId }; },
  async apply(id: string | null): Promise<void> {
    if (desktop) await invoke('apply_overlay_preset', { id });
    else {
      if (id && !(await this.read()).presets.some(p => p.id === id)) throw new Error('Preset non disponibile.');
      activeId = id;
    }
  },
  async monitor(): Promise<PresetMonitor> {
    return desktop ? invoke('overlay_monitor') : { name: null, x: 0, y: 0, width: innerWidth, height: innerHeight };
  },
  async view(): Promise<PersistentView> { return invoke('persistent_view'); },
  async ready(): Promise<void> { await invoke('persistent_ready'); },
  async closePreview(): Promise<void> { await invoke('close_persistent_preview'); },
  async preview(name: string): Promise<void> { await invoke('preview_persistent_image', { name }); },
};
