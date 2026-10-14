import { describe, expect, it } from 'vitest';
import { availableWidgets, moveWidget, placeWidgets, readWidgets, readWidgetGrid, widgetGrid, widgetDefinition, type WidgetInstance } from './widgets';
import { defaultHomeLayout, readHomeLayout } from './launcher';
import type { InstalledApp } from './types';
const widget: WidgetInstance = { id: 'instance-a', appId: 'example', widgetId: 'recent', title: 'Recenti', x: 0, y: 0, width: 1, height: 1 };
const app: InstalledApp = { enabled: true, hidden: true, previousVersion: null,
  manifest: { id: 'example', name: 'Example', description: '', version: '1.0.0', sdk: 1, entry: 'index.html', permissions: ['files-read'], shortcut: null,
    widgets: [{ id: 'recent', title: 'Recenti', description: '', width: 1, height: 1, source: { type: 'recent-images', path: '', limit: 4 } }] } };
describe('home widgets', () => {
  it('preserves per-instance grid preferences and accepts app defaults without changing saved geometry', () => {
    const configured = { ...widget, settings: { rows: 3, columns: 4 } };
    expect(readWidgets([configured], true)[0]).toEqual(configured);
    expect(widgetGrid(configured, app.manifest.widgets![0])).toEqual(configured.settings);
    expect(widgetGrid(widget, { ...app.manifest.widgets![0], grid: { rows: 1, columns: 3 } })).toEqual({ rows: 1, columns: 3 });
    for (const value of [null, {}, { rows: 0, columns: 1 }, { rows: 1, columns: 7 }, { rows: 1.5, columns: 2 },
      { rows: '2', columns: 2 }, { rows: 2, columns: 2, path: '../file' }]) {
      expect(() => readWidgetGrid(value)).toThrow();
      expect(() => readWidgets([{ ...widget, settings: value }], true)).toThrow();
    }
  });
  it('migrates v1 without losing favorites or AI and clamps finite coordinates', () => {
    const old = { version: 1, favorites: ['example:open'], ai: true, clock: true };
    expect(readHomeLayout({ getItem: () => JSON.stringify(old) })).toEqual({ ...defaultHomeLayout(), ...old, version: 3 });
    const widgets = readWidgets([{ ...widget, x: 900, y: -1, width: -3, height: 999 }]);
    expect(widgets[0]).toEqual({ ...widget, x: 1, height: 2 });
  });
  it('rejects missing, non-finite, duplicate or forged widget instances', () => {
    for (const value of [null, [{ ...widget, x: null }], [{ ...widget, appId: '../other' }], [{ ...widget, y: Infinity }],
      [widget, widget], [widget, { ...widget, id: 'instance-b' }], Array(17).fill(widget)]) expect(() => readWidgets(value)).toThrow();
  });
  it('moves only requested coordinates, resolves collisions and keeps responsive placement non-destructive', () => {
    const original = [widget, { ...widget, id: 'instance-b', widgetId: 'other', x: 1 }];
    const moved = moveWidget(original, widget.id, 1, 0);
    expect(moved[0]).toEqual({ ...widget, x: 1 });
    expect(moved[1].y).toBe(1);
    expect(original[0]).toEqual(widget);
    const compact = placeWidgets(moved, 1);
    expect(compact.map(w => w.x)).toEqual([0, 0]);
    expect(compact[1].y).toBeGreaterThan(compact[0].y);
    expect(moved[0].x).toBe(1);
    expect(moveWidget(moved, widget.id, -100, 999)[0]).toMatchObject({ x: 0, y: 31 });
    expect(moved.filter(w => w.id !== widget.id)).toHaveLength(1);
  });
  it('includes hidden apps but keeps disabled, removed and missing definitions unavailable', () => {
    expect(availableWidgets([app], [])).toHaveLength(1);
    expect(widgetDefinition(widget, [app], [])?.id).toBe('recent');
    expect(widgetDefinition(widget, [{ ...app, enabled: false }], [])).toBeUndefined();
    expect(widgetDefinition(widget, [], [])).toBeUndefined();
    expect(widgetDefinition(widget, [app], [{ id: 'example', ready: false, dependencies: [] }])).toBeUndefined();
    expect(widgetDefinition({ ...widget, widgetId: 'removed' }, [app], [])).toBeUndefined();
  });
});
