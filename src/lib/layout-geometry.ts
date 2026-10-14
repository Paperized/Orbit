export interface Rect { x: number; y: number; width: number; height: number }
export interface Bounds { width: number; height: number }
export type Edge = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const edges: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function gridStep(value: number) { return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.round(finite(value, 20)))); }
export function validRect(value: unknown): value is Rect {
  if (!value || typeof value !== 'object') return false;
  const r = value as Rect;
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width >= 1 && r.height >= 1;
}
export function fitRect(rect: Rect, bounds: Bounds): Rect {
  const bw = Math.max(1, finite(bounds.width, 1)), bh = Math.max(1, finite(bounds.height, 1));
  const width = clamp(finite(rect.width, 1), 1, bw), height = clamp(finite(rect.height, 1), 1, bh);
  return { width, height, x: clamp(finite(rect.x, 0), 0, bw - width), y: clamp(finite(rect.y, 0), 0, bh - height) };
}
export function manipulate(rect: Rect, edge: Edge, dx: number, dy: number, bounds: Bounds, grid: boolean, step: number): Rect {
  const unit = grid ? gridStep(step) : 1;
  // A viewport smaller than one cell still needs a reachable element.
  const bw = Math.max(1, finite(bounds.width, 1)), bh = Math.max(1, finite(bounds.height, 1));
  const snap = (n: number) => grid ? Math.round(n / unit) * unit : n;
  const limit = (n: number) => grid ? Math.max(1, Math.floor(n / unit) * unit) : n;
  const b = { width: limit(bw), height: limit(bh) };
  const r = fitRect(grid ? { x: snap(rect.x), y: snap(rect.y), width: Math.max(unit, snap(rect.width)), height: Math.max(unit, snap(rect.height)) } : rect, b);
  dx = finite(dx, 0); dy = finite(dy, 0);
  if (edge === 'move') return fitRect({ ...r, x: snap(rect.x + dx), y: snap(rect.y + dy) }, b);
  let { x, y, width, height } = r;
  const right = x + width, bottom = y + height;
  if (edge.includes('w')) { x = clamp(snap(rect.x + dx), 0, right - Math.min(unit, right)); width = right - x; }
  if (edge.includes('n')) { y = clamp(snap(rect.y + dy), 0, bottom - Math.min(unit, bottom)); height = bottom - y; }
  if (edge.includes('e')) width = clamp(snap(rect.width + dx), Math.min(unit, b.width - x), b.width - x);
  if (edge.includes('s')) height = clamp(snap(rect.height + dy), Math.min(unit, b.height - y), b.height - y);
  return { x, y, width, height };
}

export const builtinNames = { logo: 'Logo e orologio', search: 'Ricerca', favorites: 'Preferiti', ai: 'Modello AI', dock: 'Avvio rapido' };
export type Builtin = keyof typeof builtinNames;
export function defaultRects(bounds: Bounds): Record<Builtin, Rect> {
  const w = Math.max(1, bounds.width), h = Math.max(1, bounds.height);
  return {
    logo: { x: 12, y: 12, width: 245, height: 80 },
    search: { x: Math.max(12, (w - 720) / 2), y: 94, width: Math.min(720, w - 24), height: 86 },
    favorites: { x: Math.max(12, w - 350), y: 185, width: 330, height: Math.min(320, h - 300) },
    ai: { x: w > 1000 ? 344 : 12, y: w > 1000 ? 185 : 505, width: Math.min(350, w / 2), height: 235 },
    dock: { x: Math.max(12, (w - 520) / 2), y: Math.max(160, h - 100), width: Math.min(520, w - 24), height: 90 },
  };
}

// Each mutation runs against the last successful write, never a stale UI snapshot.
export function layoutWriter<T>(initial: T, write: (value: T) => Promise<void>, commit: (value: T) => void) {
  let current = initial, tail = Promise.resolve();
  return (mutate: (value: T) => T) => {
    const transaction = tail.then(async () => {
      const next = mutate(current);
      await write(next);
      current = next; commit(next);
    });
    tail = transaction.catch(() => {});
    return transaction;
  };
}
