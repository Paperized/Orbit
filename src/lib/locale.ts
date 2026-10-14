import { writable } from 'svelte/store';
import type { Locale } from '../../sdk/src';
export const locale = writable<Locale>('it');
export function applyLocale(value: Locale) {
  window.dispatchEvent(new CustomEvent('orbit:locale', { detail: value }));
}
window.addEventListener('orbit:locale', event => {
  const value = (event as CustomEvent<Locale>).detail;
  if (value === 'it' || value === 'en') locale.set(value);
});
export const text = (language: Locale, italian: string, english: string) => language === 'en' ? english : italian;
