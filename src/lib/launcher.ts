import type { DependencyStatus, InstalledApp } from './types';
import { readWidgets, type WidgetInstance } from './widgets';
import { builtinNames, validRect, type Builtin, type Rect } from './layout-geometry';

export interface LaunchItem {
  id: string;
  appId: string;
  actionId: string;
  name: string;
  appName: string;
  description: string;
  icon: string;
  shortcut: string | null;
  unavailable: string | null;
  hidden: boolean;
}

export function launchItems(apps: InstalledApp[], dependencies: DependencyStatus[]): LaunchItem[] {
  return apps.flatMap(app => {
    const manifest = app.manifest;
    const unavailable = !app.enabled ? 'App disabilitata'
      : dependencies.some(item => item.id === manifest.id && !item.ready) ? 'Dipendenze mancanti' : null;
    const base = {
      appId: manifest.id, appName: manifest.name, icon: manifest.icon ?? 'grid',
      unavailable, hidden: app.hidden ?? false,
    };
    return [
      { ...base, id: `${manifest.id}:open`, actionId: 'open', name: manifest.name,
        description: manifest.description, shortcut: app.shortcutOverride ?? manifest.shortcut },
      ...(manifest.actions ?? []).map(action => ({
        ...base, id: `${manifest.id}:${action.id}`, actionId: action.id, name: action.label,
        description: action.description ?? manifest.description,
        shortcut: app.actionShortcuts?.[action.id] ?? action.shortcut ?? null,
      })),
    ];
  });
}

export function searchItems<T extends Pick<LaunchItem, 'name' | 'appName' | 'description'>>(items: T[], query: string): T[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const terms = normalize(query.trim()).split(/\s+/);
  return items.filter(item => {
    const text = normalize(`${item.name} ${item.appName} ${item.description}`);
    return terms.every(term => text.includes(term));
  });
}

export interface HomeLayout {
  version: 3;
  favorites: string[];
  favoritesVisible: boolean;
  dockVisible: boolean;
  dockHiddenApps: string[];
  clock: boolean;
  ai: boolean;
  widgets: WidgetInstance[];
  rects: Partial<Record<Builtin, Rect>>;
  editing: boolean;
  grid: boolean;
  gridSize: number;
}
export const homeLayoutKey = 'orbit.home-layout';
export const defaultHomeLayout = (): HomeLayout => ({ version: 3, favorites: [], favoritesVisible: true, dockVisible: true, dockHiddenApps: [], clock: false, ai: false, widgets: [],
  rects: {}, editing: false, grid: false, gridSize: 20 });

export function readHomeLayout(storage: Pick<Storage, 'getItem'>): HomeLayout {
  const raw = storage.getItem(homeLayoutKey);
  if (raw === null) return defaultHomeLayout();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object'
    || !('version' in value) || ![1, 2, 3].includes(value.version as number)
    || !('favorites' in value) || !Array.isArray(value.favorites)
    || !value.favorites.every((id: unknown) => typeof id === 'string' && /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(id))
    || new Set(value.favorites).size !== value.favorites.length
    || ('favoritesVisible' in value && typeof value.favoritesVisible !== 'boolean')
    || ('dockVisible' in value && typeof value.dockVisible !== 'boolean')
    || ('dockHiddenApps' in value && (!Array.isArray(value.dockHiddenApps)
      || !value.dockHiddenApps.every((id: unknown) => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id))
      || new Set(value.dockHiddenApps).size !== value.dockHiddenApps.length))
    || !('clock' in value) || typeof value.clock !== 'boolean'
    || !('ai' in value) || typeof value.ai !== 'boolean') {
    throw new Error('Personalizzazione della home non valida. Ripristina il layout per continuare.');
  }
  const widgets = value.version === 1 ? [] : readWidgets('widgets' in value ? value.widgets : undefined, value.version === 3);
  if (value.version === 3) {
    const v = value as HomeLayout;
    if (!v.rects || typeof v.rects !== 'object' || Array.isArray(v.rects)
      || Object.entries(v.rects).some(([key, rect]) => !(key in builtinNames) || !validRect(rect))
      || typeof v.editing !== 'boolean' || typeof v.grid !== 'boolean'
      || !Number.isSafeInteger(v.gridSize) || v.gridSize < 1) throw new Error('Geometria della home non valida.');
    return { ...v, favoritesVisible: v.favoritesVisible ?? true, dockVisible: v.dockVisible ?? true, dockHiddenApps: v.dockHiddenApps ?? [], widgets };
  }
  return { ...defaultHomeLayout(), favorites: value.favorites, clock: value.clock, ai: value.ai,
    widgets: widgets.map(widget => ({ ...widget, x: 12 + widget.x * 316, y: 185 + widget.y * 316,
      width: widget.width * 316 - 16, height: widget.height * 316 - 16 })) };
}

export function saveHomeLayout(storage: Pick<Storage, 'setItem'>, layout: HomeLayout) {
  storage.setItem(homeLayoutKey, JSON.stringify(layout));
}
