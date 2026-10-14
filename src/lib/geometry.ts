import type { Rect } from './types';

export function selectionRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: { width: number; height: number },
): Rect {
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
  const x1 = clamp(start.x, bounds.width);
  const y1 = clamp(start.y, bounds.height);
  const x2 = clamp(end.x, bounds.width);
  const y2 = clamp(end.y, bounds.height);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function toPixels(rect: Rect, display: { width: number; height: number }, image: { width: number; height: number }): Rect {
  if (display.width <= 0 || display.height <= 0) throw new Error('Dimensioni schermo non valide.');
  const x = Math.max(0, Math.floor(rect.x * image.width / display.width));
  const y = Math.max(0, Math.floor(rect.y * image.height / display.height));
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width / display.width));
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height / display.height));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
