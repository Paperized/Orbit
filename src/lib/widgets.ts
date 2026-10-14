import type { WidgetDeclaration, WidgetGrid } from '../../sdk/src';
import type { InstalledApp, DependencyStatus } from './types';

export interface WidgetInstance {
  id: string; appId: string; widgetId: string; title: string;
  x: number; y: number; width: number; height: number;
  settings?: WidgetGrid;
}
export function readWidgetGrid(value: unknown): WidgetGrid {
  if (!value || typeof value !== 'object' || !('rows' in value) || !('columns' in value)
    || Object.keys(value).some(key => key !== 'rows' && key !== 'columns')
    || !Number.isInteger(value.rows) || !Number.isInteger(value.columns)
    || typeof value.rows !== 'number' || typeof value.columns !== 'number'
    || value.rows < 1 || value.rows > 6 || value.columns < 1 || value.columns > 6) {
    throw new Error('Griglia widget non valida: righe e colonne devono essere interi da 1 a 6.');
  }
  return { rows: value.rows, columns: value.columns };
}
export function widgetGrid(instance: WidgetInstance, definition?: WidgetDeclaration): WidgetGrid {
  return instance.settings ?? definition?.grid ?? { rows: Math.ceil((definition?.source.limit ?? 4) / 2), columns: 2 };
}
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
export const widgetLimit = 16;
export function readWidgets(value: unknown, pixels = false): WidgetInstance[] {
  if (!Array.isArray(value) || value.length > widgetLimit) throw new Error('Elenco widget non valido.');
  const ids = new Set<string>(), pairs = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id)
      || typeof item.appId !== 'string' || !idPattern.test(item.appId)
      || typeof item.widgetId !== 'string' || !idPattern.test(item.widgetId)
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160
      || ['x', 'y', 'width', 'height'].some(key => typeof item[key] !== 'number' || !Number.isFinite(item[key]))
      || ids.has(item.id) || pairs.has(`${item.appId}:${item.widgetId}`)) throw new Error('Widget salvato non valido.');
    ids.add(item.id); pairs.add(`${item.appId}:${item.widgetId}`);
    const settings = item.settings === undefined ? {} : { settings: readWidgetGrid(item.settings) };
    if (pixels) {
      if (item.x < 0 || item.y < 0 || item.width < 1 || item.height < 1) throw new Error('Rettangolo widget non valido.');
      return { id: item.id, appId: item.appId, widgetId: item.widgetId, title: item.title,
        x: item.x, y: item.y, width: item.width, height: item.height, ...settings };
    }
    const width = Math.max(1, Math.min(2, Math.round(item.width)));
    return { id: item.id, appId: item.appId, widgetId: item.widgetId, title: item.title,
      width, height: Math.max(1, Math.min(2, Math.round(item.height))),
      x: Math.max(0, Math.min(2 - width, Math.round(item.x))), y: Math.max(0, Math.min(31, Math.round(item.y))), ...settings };
  });
}
export function availableWidgets(apps: InstalledApp[], dependencies: DependencyStatus[]) {
  return apps.filter(app => app.enabled && !dependencies.some(d => d.id === app.manifest.id && !d.ready))
    .map(app => ({ app, widgets: app.manifest.widgets ?? [] })).filter(group => group.widgets.length);
}
export function widgetDefinition(instance: WidgetInstance, apps: InstalledApp[], dependencies: DependencyStatus[]): WidgetDeclaration | undefined {
  return availableWidgets(apps, dependencies).find(group => group.app.manifest.id === instance.appId)?.widgets.find(widget => widget.id === instance.widgetId);
}
export function placeWidgets(widgets: WidgetInstance[], columns = 2): WidgetInstance[] {
  const occupied = new Set<string>();
  return widgets.map(widget => {
    const width = Math.min(columns, widget.width);
    let x = Math.min(columns - width, widget.x), y = widget.y;
    const cells = (x: number, y: number) => Array.from({ length: width * widget.height }, (_, i) => `${x + i % width}:${y + Math.floor(i / width)}`);
    while (cells(x, y).some(cell => occupied.has(cell))) {
      x++; if (x + width > columns) { x = 0; y++; }
    }
    cells(x, y).forEach(cell => occupied.add(cell));
    return { ...widget, x, y, width };
  });
}
export function moveWidget(widgets: WidgetInstance[], id: string, x: number, y: number) {
  const target = widgets.find(widget => widget.id === id);
  if (!target) return widgets;
  const moved = { ...target, x: Math.max(0, Math.min(2 - target.width, Math.round(x))), y: Math.max(0, Math.min(31, Math.round(y))) };
  const placed = placeWidgets([moved, ...widgets.filter(widget => widget.id !== id)]);
  // Repack only overflowing collisions; stored coordinates always stay inside the bounded canvas.
  if (placed.some(widget => widget.y > 31)) return widgets;
  return widgets.map(widget => placed.find(next => next.id === widget.id)!);
}
