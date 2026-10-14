import { describe, expect, it } from 'vitest';
import { componentIds, newPreset, readPresets } from './presets';

const monitor = { name: 'Display', x: -1920, y: 0, width: 1920, height: 1080 };
describe('persistent overlay definitions', () => {
  it('starts empty with an independent layout and no persisted active state', () => {
    const first = newPreset('Gaming', monitor), second = newPreset('Work', monitor);
    expect(first.id).not.toBe(second.id);
    first.layout.favorites.push('orbit-notes:open');
    expect(second.layout.favorites).toEqual([]);
    expect(componentIds(first)).toEqual([]);
    expect(readPresets({ version: 1, presets: [first] })).not.toHaveProperty('activeId');
  });
  it('uses preset membership independently from hub visibility flags', () => {
    const preset = newPreset('Gaming', monitor);
    preset.builtins = ['dock', 'favorites'];
    preset.layout.dockVisible = false;
    preset.layout.favoritesVisible = false;
    expect(componentIds(preset)).toEqual(['dock', 'favorites']);
    preset.layout.rects = {};
    expect(readPresets({ version: 1, presets: [preset] }).presets[0].layout.rects.dock).toBeDefined();
  });
  it('rejects duplicate presets, reserved IDs, excess components and invalid geometry', () => {
    const preset = newPreset('Gaming', monitor);
    expect(() => readPresets({ version: 1, presets: [preset, preset] })).toThrow();
    const bad = structuredClone(preset);
    bad.layout.widgets = [{ id: 'dock', appId: 'demo', widgetId: 'recent', title: 'Recent', x: 0, y: 0, width: 20, height: 20 }];
    expect(() => readPresets({ version: 1, presets: [bad] })).toThrow();
    bad.layout.widgets[0].id = 'widget';
    bad.layout.widgets[0].width = 131073;
    expect(() => readPresets({ version: 1, presets: [bad] })).toThrow();
    preset.clickThrough = Array.from({ length: 21 }, (_, i) => `widget-${i}`);
    expect(() => readPresets({ version: 1, presets: [preset] })).toThrow();
  });
});
