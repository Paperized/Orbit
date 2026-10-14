import { defaultHomeLayout, readHomeLayout, type HomeLayout } from './launcher';
import { defaultRects, type Bounds, type Builtin } from './layout-geometry';

export const presetBuiltins = ['logo', 'search', 'favorites', 'dock'] as const;
export type PresetBuiltin = typeof presetBuiltins[number];
export interface PresetMonitor { name: string | null; x: number; y: number; width: number; height: number }
export interface OverlayPreset {
  id: string; name: string; layout: HomeLayout; builtins: PresetBuiltin[];
  clickThrough: string[]; monitor: PresetMonitor;
}
export interface PresetDocument { version: 1; presets: OverlayPreset[] }
export interface PresetStatus { activeId: string | null }
export interface PersistentView { preset: OverlayPreset; component: string; image?: { appId: string; widgetId: string; name: string } | null }
export const presetLimit = 12;
export function newPreset(name: string, monitor: PresetMonitor): OverlayPreset {
  return { id: crypto.randomUUID(), name, monitor, builtins: [], clickThrough: [],
    layout: { ...defaultHomeLayout(), rects: defaultRects(monitor), editing: true } };
}
export function componentIds(preset: OverlayPreset): string[] {
  return [...preset.builtins, ...preset.layout.widgets.map(widget => widget.id)];
}
export function presetRect(preset: OverlayPreset, id: string, bounds: Bounds = preset.monitor) {
  return preset.layout.widgets.find(widget => widget.id === id)
    ?? preset.layout.rects[id as Builtin] ?? defaultRects(bounds)[id as Builtin];
}
export function readPresets(value: unknown): PresetDocument {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('presets' in value) || !Array.isArray(value.presets) || value.presets.length > presetLimit) throw new Error('Preset non validi.');
  const ids = new Set<string>();
  const presets = value.presets.map((p: OverlayPreset) => {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id) || ids.has(p.id)
      || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80
      || !Array.isArray(p.builtins) || p.builtins.some(id => !presetBuiltins.includes(id))
      || new Set(p.builtins).size !== p.builtins.length
      || !Array.isArray(p.clickThrough) || p.clickThrough.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
      || new Set(p.clickThrough).size !== p.clickThrough.length
      || p.clickThrough.length > 20
      || !p.monitor || (p.monitor.name !== null && typeof p.monitor.name !== 'string')
      || ![p.monitor.x, p.monitor.y, p.monitor.width, p.monitor.height].every(Number.isFinite)
      || p.monitor.width < 1 || p.monitor.height < 1 || p.monitor.width > 32768 || p.monitor.height > 32768
      || Math.abs(p.monitor.x) > 131072 || Math.abs(p.monitor.y) > 131072) throw new Error('Preset non valido.');
    ids.add(p.id);
    const layout = readHomeLayout({ getItem: () => JSON.stringify(p.layout) });
    if (p.layout.version !== 3 || layout.widgets.some(w => presetBuiltins.some(id => id === w.id))) throw new Error('Identita widget preset non valida.');
    const rects = { ...defaultRects(p.monitor), ...layout.rects };
    if ([...Object.values(rects), ...layout.widgets].some(r => [r.x, r.y, r.width, r.height].some(n => n > 131072))) throw new Error('Geometria preset fuori limite.');
    return { ...p, layout: { ...layout, rects } };
  });
  return { version: 1, presets };
}
