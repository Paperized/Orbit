import { describe, expect, it } from 'vitest';
import '../../shared/webview.js';

describe('desktop webview interactions', () => {
  it('suppresses the browser menu without blocking custom context menus', () => {
    const button = document.createElement('button');
    document.body.append(button);
    let received = false;
    button.addEventListener('contextmenu', () => { received = true; });
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(received).toBe(true);
    button.remove();
  });

  it('blocks inspector shortcuts but preserves editing and app shortcuts', () => {
    for (const options of [
      { key: 'F12' },
      { key: 'I', ctrlKey: true, shiftKey: true },
      { key: 'j', ctrlKey: true, shiftKey: true },
      { key: 'C', ctrlKey: true, shiftKey: true },
      { key: 'i', metaKey: true, altKey: true },
    ]) {
      expect(window.dispatchEvent(new KeyboardEvent('keydown', { ...options, cancelable: true }))).toBe(false);
    }
    for (const options of [
      { key: 'c', ctrlKey: true },
      { key: 'v', metaKey: true },
      { key: 'e', ctrlKey: true },
      { key: 'Escape' },
    ]) {
      expect(window.dispatchEvent(new KeyboardEvent('keydown', { ...options, cancelable: true }))).toBe(true);
    }
  });
});
