import { describe, expect, it } from 'vitest';
import { edges, fitRect, gridStep, layoutWriter, manipulate, validRect } from './layout-geometry';
import { defaultHomeLayout, readHomeLayout } from './launcher';
const bounds = { width: 1000, height: 800 }, rect = { x: 100, y: 100, width: 300, height: 200 };
describe('pixel canvas', () => {
  it('moves exact fractional deltas without grid and snaps to the selected cell when enabled', () => {
    expect(manipulate(rect, 'move', 13.5, -2.25, bounds, false, 20)).toEqual({ ...rect, x: 113.5, y: 97.75 });
    expect(manipulate(rect, 'move', 13.5, -2.25, bounds, true, 20)).toEqual({ ...rect, x: 120 });
    expect(manipulate(rect, 'move', 13.5, -2.25, bounds, true, 25)).toEqual({ ...rect, x: 125 });
    expect(gridStep(NaN)).toBe(20); expect(gridStep(-2)).toBe(1); expect(gridStep(12.6)).toBe(13);
  });
  it.each(edges)('resizes %s with opposite anchors fixed', edge => {
    const next = manipulate(rect, edge, 10, 15, bounds, false, 20);
    expect(next.x).toBe(edge.includes('w') ? 110 : 100);
    expect(next.y).toBe(edge.includes('n') ? 115 : 100);
    expect(next.width).toBe(edge.includes('w') ? 290 : edge.includes('e') ? 310 : 300);
    expect(next.height).toBe(edge.includes('n') ? 185 : edge.includes('s') ? 215 : 200);
    const snapped = manipulate(rect, edge, 13, 13, bounds, true, 20);
    for (const value of Object.values(snapped)) expect(value % 20).toBe(0);
  });
  it('permits one pixel, one cell, all available space and clamps boundaries without changing stored geometry', () => {
    expect(manipulate(rect, 'se', -999, -999, bounds, false, 20)).toEqual({ ...rect, width: 1, height: 1 });
    expect(manipulate(rect, 'se', -999, -999, bounds, true, 25)).toEqual({ ...rect, width: 25, height: 25 });
    expect(manipulate(rect, 'nw', 999, 999, bounds, false, 20)).toEqual({ x: 399, y: 299, width: 1, height: 1 });
    expect(manipulate(rect, 'se', 9999, 9999, bounds, false, 20)).toEqual({ ...rect, width: 900, height: 700 });
    expect(fitRect(rect, { width: 50, height: 30 })).toEqual({ x: 0, y: 0, width: 50, height: 30 });
    expect(rect.width).toBe(300);
    for (const edge of ['move', ...edges] as const) {
      expect(validRect(manipulate(rect, edge, Infinity, NaN, { width: NaN, height: Infinity }, true, Infinity))).toBe(true);
      expect(validRect(manipulate(rect, edge, -999, 999, { width: 10, height: 10 }, true, 20))).toBe(true);
    }
    expect(validRect({ ...rect, x: NaN })).toBe(false);
    expect(validRect({ ...rect, width: Infinity })).toBe(false);
  });
  it('migrates v2 chosen widgets and grid positions exactly once, preserving all user choices', () => {
    const old = { version: 2, clock: true, ai: true, favorites: ['example:open'],
      widgets: [{ id: 'saved', appId: 'example', widgetId: 'recent', title: 'Recenti', x: 1, y: 3, width: 1, height: 2 }] };
    const next = readHomeLayout({ getItem: () => JSON.stringify(old) });
    expect(next).toMatchObject({ version: 3, favorites: old.favorites, clock: true, ai: true,
      widgets: [{ ...old.widgets[0], x: 328, y: 1133, width: 300, height: 616 }] });
    expect(readHomeLayout({ getItem: () => JSON.stringify(next) })).toEqual(next);
    for (const invalid of [{ rects: { search: { ...rect, width: 0 } } }, { gridSize: 0 }, { grid: 1 }, { editing: null }]) {
      expect(() => readHomeLayout({ getItem: () => JSON.stringify({ ...defaultHomeLayout(), ...invalid }) })).toThrow();
    }
  });
  it('serializes concurrent mutations against successful state, reports failures and keeps later unrelated changes', async () => {
    let committed = { x: 0, grid: false };
    let reject = true;
    const writer = layoutWriter(committed, async next => {
      await Promise.resolve();
      if (reject && next.x === 1) { reject = false; throw new Error('disk full'); }
    }, next => { committed = next; });
    const failed = writer(value => ({ ...value, x: 1 }));
    const grid = writer(value => ({ ...value, grid: true }));
    const moved = writer(value => ({ ...value, x: 2 }));
    await expect(failed).rejects.toThrow('disk full');
    await Promise.all([grid, moved]);
    expect(committed).toEqual({ x: 2, grid: true });
  });
});
