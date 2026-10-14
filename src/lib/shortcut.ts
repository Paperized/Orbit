export function shortcutFromKeyboard(event: KeyboardEvent): string | null {
  if (event.isComposing || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code)
    || ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) return null;
  // Windows accessibility/synthesized events can omit code, including shifted digits.
  let code = event.code;
  if (!code || code === 'Unidentified') {
    const virtualKey = event.keyCode;
    if (virtualKey >= 48 && virtualKey <= 57) code = `Digit${virtualKey - 48}`;
    else if (virtualKey >= 65 && virtualKey <= 90) code = `Key${String.fromCharCode(virtualKey)}`;
    else if (virtualKey >= 96 && virtualKey <= 105) code = `Numpad${virtualKey - 96}`;
    else if (virtualKey >= 112 && virtualKey <= 135) code = `F${virtualKey - 111}`;
    else code = ({
      8: 'Backspace', 9: 'Tab', 13: event.location === 3 ? 'NumpadEnter' : 'Enter', 27: 'Escape',
      32: 'Space', 33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'ArrowLeft',
      38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 45: 'Insert', 46: 'Delete',
      106: 'NumpadMultiply', 107: 'NumpadAdd', 109: 'NumpadSubtract', 110: 'NumpadDecimal', 111: 'NumpadDivide',
      186: 'Semicolon', 187: 'Equal', 188: 'Comma', 189: 'Minus', 190: 'Period', 191: 'Slash',
      192: 'Backquote', 219: 'BracketLeft', 220: 'Backslash', 221: 'BracketRight', 222: 'Quote',
    } as Record<number, string>)[virtualKey] ?? '';
  }
  let key: string;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)
    || /^Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)$/.test(code)
    || ['Space', 'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
      'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon',
      'Quote', 'Comma', 'Period', 'Slash', 'Backquote'].includes(code)) key = code;
  else throw new Error("Tasto non supportato. Scegli un'altra combinazione.");
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+');
}
