import { describe, expect, it } from 'vitest';
import { panelPlacement } from './anchored-panel';
describe('anchored results', () => {
  it('follows the search bar position and width with an eight pixel gap', () => {
    expect(panelPlacement({ left: 123, top: 60, bottom: 120, width: 480 }, { width: 1000, height: 800 }))
      .toEqual({ left: 123, width: 480, top: 128, bottom: undefined, maxHeight: 420 });
  });
  it('flips above near the bottom and keeps small or oversized fields readable within the viewport', () => {
    expect(panelPlacement({ left: 950, top: 650, bottom: 700, width: 1 }, { width: 1000, height: 800 }))
      .toEqual({ left: 712, width: 280, top: undefined, bottom: 158, maxHeight: 420 });
    expect(panelPlacement({ left: 0, top: 0, bottom: 60, width: 1000 }, { width: 250, height: 400 }))
      .toEqual({ left: 8, width: 234, top: 68, bottom: undefined, maxHeight: 324 });
  });
});
