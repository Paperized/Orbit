export function panelPlacement(anchor: { left: number; top: number; width: number; bottom: number },
  viewport: { width: number; height: number }) {
  const gap = 8;
  const width = Math.min(Math.max(anchor.width, 280), Math.max(1, viewport.width - gap * 2));
  const below = Math.max(0, viewport.height - anchor.bottom - gap * 2);
  const above = Math.max(0, anchor.top - gap * 2);
  const upwards = below < 280 && above > below;
  return {
    left: Math.max(gap, Math.min(anchor.left, viewport.width - width - gap)),
    width,
    top: upwards ? undefined : Math.max(gap, anchor.bottom + gap),
    bottom: upwards ? Math.max(gap, viewport.height - anchor.top + gap) : undefined,
    maxHeight: Math.max(1, Math.min(420, upwards ? above : below)),
  };
}

// Observe position as well as size: moving a widget does not fire ResizeObserver.
export function anchoredPanel(node: HTMLElement, anchor: HTMLElement) {
  let frame = 0, previous = '';
  function update() {
    const placement = panelPlacement(anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
    const next = JSON.stringify(placement);
    if (next !== previous) {
      for (const [key, value] of Object.entries(placement)) {
        node.style.setProperty(key === 'maxHeight' ? 'max-height' : key, value === undefined ? 'auto' : `${value}px`);
      }
      previous = next;
    }
    frame = requestAnimationFrame(update);
  }
  update();
  return { update(next: HTMLElement) { anchor = next; }, destroy() { cancelAnimationFrame(frame); } };
}
