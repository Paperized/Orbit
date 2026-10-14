import { describe, it, expect } from 'vitest';
import { tools, getTool } from './registry';

describe('shared tool registry', () => {
  it('has unique IDs, shortcuts and a component for every manifest entry', () => {
    expect(new Set(tools.map(tool => tool.id)).size).toBe(tools.length);
    const shortcuts = tools.flatMap(tool => tool.shortcut ? [tool.shortcut] : []);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    for (const tool of tools) expect(tool.component).toBeTypeOf('function');
  });
  it('exposes the exact requested shortcuts', () => {
    expect(getTool('home').shortcut).toBe('Ctrl+E');
    expect(getTool('capture').shortcut).toBe('Ctrl+1');
  });
  it('rejects unknown tools rather than silently opening home', () => {
    expect(() => getTool('missing')).toThrow('Strumento sconosciuto');
  });
});
