import { describe, expect, it } from 'vitest';
import { defaultHomeLayout, homeLayoutKey, launchItems, readHomeLayout, saveHomeLayout, searchItems } from './launcher';
import type { InstalledApp } from './types';

const app: InstalledApp = {
  manifest: { id: 'example', name: 'Appunti', description: 'Attività e idee', version: '1.0.0', sdk: 1,
    entry: 'index.html', permissions: [], shortcut: 'Ctrl+3',
    actions: [{ id: 'write', label: 'Nuova nota', description: 'Scrivi subito', shortcut: 'Ctrl+Shift+3' }] },
  enabled: true, previousVersion: null, shortcutOverride: '', actionShortcuts: { write: '' },
};
describe('overlay launcher', () => {
  it('stores only dock exclusions, defaults old layouts to all apps and rejects malformed IDs', () => {
    const { dockHiddenApps, ...legacy } = defaultHomeLayout();
    expect(dockHiddenApps).toEqual([]);
    localStorage.setItem(homeLayoutKey, JSON.stringify(legacy));
    expect(readHomeLayout(localStorage).dockHiddenApps).toEqual([]);
    const layout = { ...defaultHomeLayout(), dockHiddenApps: ['orbit-notes', 'previously-installed'] };
    saveHomeLayout(localStorage, layout);
    expect(readHomeLayout(localStorage)).toEqual(layout);
    for (const invalid of [null, 'orbit-notes', ['../bad'], ['orbit-notes', 'orbit-notes'], [42]]) {
      localStorage.setItem(homeLayoutKey, JSON.stringify({ ...layout, dockHiddenApps: invalid }));
      expect(() => readHomeLayout(localStorage)).toThrow();
    }
  });
  it('migrates dock visibility and preserves hidden dock geometry', () => {
    const layout = { ...defaultHomeLayout(), rects: { dock: { x: 10, y: 20, width: 350, height: 95 } } };
    const { dockVisible, ...legacy } = layout;
    expect(dockVisible).toBe(true);
    localStorage.setItem(homeLayoutKey, JSON.stringify(legacy));
    expect(readHomeLayout(localStorage)).toEqual(layout);
    saveHomeLayout(localStorage, { ...layout, dockVisible: false });
    expect(readHomeLayout(localStorage)).toEqual({ ...layout, dockVisible: false });
    localStorage.setItem(homeLayoutKey, JSON.stringify({ ...layout, dockVisible: 'false' }));
    expect(() => readHomeLayout(localStorage)).toThrow();
  });
  it('defaults old layouts to visible favorites and persists visibility independently of stars and geometry', () => {
    const layout = { ...defaultHomeLayout(), favorites: ['example:write'], rects: { favorites: { x: 20, y: 30, width: 250, height: 180 } } };
    const { favoritesVisible, ...legacy } = layout;
    expect(favoritesVisible).toBe(true);
    localStorage.setItem(homeLayoutKey, JSON.stringify(legacy));
    expect(readHomeLayout(localStorage)).toEqual(layout);
    saveHomeLayout(localStorage, { ...layout, favoritesVisible: false });
    expect(readHomeLayout(localStorage)).toEqual({ ...layout, favoritesVisible: false });
    localStorage.setItem(homeLayoutKey, JSON.stringify({ ...layout, favoritesVisible: 'false' }));
    expect(() => readHomeLayout(localStorage)).toThrow();
  });
  it('exposes app and action launches without requiring a shortcut and preserves explicit empty overrides', () => {
    const items = launchItems([app], []);
    expect(items.map(item => [item.id, item.shortcut, item.unavailable])).toEqual([
      ['example:open', '', null], ['example:write', '', null],
    ]);
    expect(searchItems(items, 'appunti scrivi').map(item => item.actionId)).toEqual(['write']);
    expect(searchItems(items, 'ATTIVITA').map(item => item.actionId)).toEqual(['open']);
    expect(searchItems(items, 'not present')).toEqual([]);
  });
  it('keeps hidden apps discoverable and reports disabled/missing-dependency entries', () => {
    expect(launchItems([{ ...app, hidden: true }], []).every(item => item.hidden)).toBe(true);
    expect(launchItems([{ ...app, enabled: false }], [])[0].unavailable).toBe('App disabilitata');
    expect(launchItems([app], [{ id: 'example', ready: false, dependencies: [] }])[0].unavailable).toBe('Dipendenze mancanti');
  });
  it('persists starred actions and widget choices without silently swallowing errors', () => {
    localStorage.clear();
    expect(readHomeLayout(localStorage)).toEqual(defaultHomeLayout());
    const layout = { ...defaultHomeLayout(), favorites: ['example:write'], clock: false, ai: true };
    saveHomeLayout(localStorage, layout);
    expect(readHomeLayout(localStorage)).toEqual(layout);
    expect(() => saveHomeLayout({ setItem: () => { throw new Error('Quota'); } }, layout)).toThrow('Quota');
    for (const value of ['invalid', '{}', '{"version":2}', JSON.stringify({ ...layout, favorites: ['x:open', 'x:open'] })]) {
      localStorage.setItem(homeLayoutKey, value);
      expect(() => readHomeLayout(localStorage)).toThrow();
    }
  });
});
