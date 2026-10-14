import { expect, it, vi } from 'vitest';
import controls from '../../shared/window-controls.js?raw';

it('upgrades installed titlebar controls without running their legacy close/hide handlers', async () => {
  document.body.innerHTML = '<script src="ui.js"></script><header><button id="hide">_</button><button id="close">X</button></header><main><button id="action">Action</button></main>';
  const pin = document.querySelector<HTMLButtonElement>('#hide')!;
  const close = document.querySelector<HTMLButtonElement>('#close')!;
  const legacy = vi.fn();
  pin.addEventListener('click', legacy);
  close.addEventListener('click', legacy);
  document.addEventListener('keydown', legacy);
  const api = {
    getState: vi.fn().mockResolvedValue({ pinned: false, visible: true }),
    hide: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn().mockResolvedValue(undefined),
    setPinned: vi.fn(async (pinned: boolean) => {
      window.dispatchEvent(new CustomEvent('orbit:pin', { detail: pinned }));
    }),
  };
  vi.stubGlobal('Orbit', { window: api, context: vi.fn().mockResolvedValue({ mode: 'app' }) });
  window.eval(controls);
  await vi.waitFor(() => expect(pin.disabled).toBe(false));
  expect(close.getAttribute('aria-label')).toBe('Nascondi');
  expect(pin.getAttribute('aria-label')).toBe('Fissa pannello');
  expect(pin.getAttribute('aria-pressed')).toBe('false');
  pin.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await vi.waitFor(() => expect(pin.disabled).toBe(false));
  expect(api.setPinned).toHaveBeenCalledWith(true);
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(api.dismiss).toHaveBeenCalledOnce();
  close.click();
  expect(api.hide).toHaveBeenCalledOnce();
  expect(legacy).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('#action')!.click();
  expect(api.hide).toHaveBeenCalledOnce();
  const errors = vi.fn();
  window.addEventListener('orbit:error', errors);
  api.setPinned.mockRejectedValueOnce(new Error('Pin unavailable'));
  pin.click();
  await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  expect(pin.disabled).toBe(false);
  pin.click();
  await vi.waitFor(() => expect(pin.getAttribute('aria-pressed')).toBe('false'));
  document.removeEventListener('keydown', legacy);
  window.removeEventListener('orbit:error', errors);
  vi.unstubAllGlobals();
});
