import { describe, expect, it } from 'vitest';
import { shortcutFromKeyboard } from './shortcut';

describe('hotkey recording', () => {
  it('captures Ctrl+2 and uses the physical digit when Shift changes its symbol', () => {
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true }))).toBe('Ctrl+2');
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { key: '@', code: 'Digit2', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+2');
  });
  it('handles letters, macOS modifiers, function keys and navigation keys', () => {
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true }))).toBe('Super+K');
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { code: 'F9' }))).toBe('F9');
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { code: 'ArrowUp', altKey: true }))).toBe('Alt+ArrowUp');
  });
  it('records synthesized Windows events without code, including shifted digits', () => {
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { key: '2', keyCode: 50, ctrlKey: true }))).toBe('Ctrl+2');
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { key: ')', keyCode: 57, ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+9');
  });
  it('waits for a non-modifier key and rejects unsupported input', () => {
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { code: 'ControlLeft', key: 'Control', ctrlKey: true }))).toBeNull();
    expect(shortcutFromKeyboard(new KeyboardEvent('keydown', { code: 'KeyA', isComposing: true }))).toBeNull();
    expect(() => shortcutFromKeyboard(new KeyboardEvent('keydown', { code: 'Unidentified' }))).toThrow('non supportato');
  });
});
