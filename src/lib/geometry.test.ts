import { describe, it, expect } from 'vitest';
import { selectionRect, toPixels } from './geometry';

describe('capture geometry', () => {
  it('normalizes reverse dragging and clamps outside the screen', () => {
    expect(selectionRect({ x: 200, y: 150 }, { x: -20, y: 40 }, { width: 300, height: 200 }))
      .toEqual({ x: 0, y: 40, width: 200, height: 110 });
  });
  it('maps high-DPI coordinates without losing edge pixels', () => {
    expect(toPixels({ x: 10.2, y: 20.4, width: 100.1, height: 50.3 }, { width: 500, height: 300 }, { width: 1000, height: 600 }))
      .toEqual({ x: 20, y: 40, width: 201, height: 102 });
  });
  it('clips rounding to the image boundary', () => {
    expect(toPixels({ x: 0, y: 0, width: 500, height: 300 }, { width: 500, height: 300 }, { width: 1001, height: 601 }))
      .toEqual({ x: 0, y: 0, width: 1001, height: 601 });
  });
  it('rejects a zero-sized display', () => {
    expect(() => toPixels({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 0 }, { width: 100, height: 100 })).toThrow();
  });
});
