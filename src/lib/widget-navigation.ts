const controls = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [contenteditable="true"], [tabindex]';

function available(element: HTMLElement) {
  return element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]');
}

function items(frame: HTMLElement) {
  const content = [...frame.querySelectorAll<HTMLElement>(`.widget-content :is(${controls})`)];
  const options = [...frame.querySelectorAll<HTMLElement>(':scope > header button')];
  return [...content, ...options].filter(available);
}

export function containWidgetDialogTab(event: KeyboardEvent, dialog: HTMLDialogElement) {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
  const children = [...dialog.querySelectorAll<HTMLElement>(controls)].filter(available);
  const first = children[0], last = children.at(-1);
  if (!first || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
  }
}

export function widgetNavigation(canvas: HTMLElement, enabled: boolean) {
  const remembered = new WeakMap<HTMLElement, HTMLElement>();
  function focus(element: HTMLElement) {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function enter(frame: HTMLElement) {
    const children = items(frame);
    const previous = remembered.get(frame);
    focus(previous && children.includes(previous) ? previous : children[0] ?? frame);
  }
  function focused(event: FocusEvent) {
    if (!enabled || !(event.target instanceof HTMLElement) || event.target.closest('dialog')) return;
    const frame = event.target.closest<HTMLElement>('[data-widget-id]');
    if (!frame) return;
    if (event.target !== frame) remembered.set(frame, event.target);
    else if (items(frame).length) enter(frame);
  }
  function keyboard(event: KeyboardEvent) {
    if (!enabled || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
      || !(event.target instanceof HTMLElement) || event.target.closest('dialog, details[open]')) return;
    const target = event.target;
    const frames = [...canvas.querySelectorAll<HTMLElement>('[data-widget-id]')];
    const frame = target.closest<HTMLElement>('[data-widget-id]')
      ?? (target.closest('.launcher-results') ? frames.find(frame => frame.dataset.widgetId === 'search') : null);
    if (!frame) return;
    if (event.key === 'Tab') {
      const next = frames[frames.indexOf(frame) + (event.shiftKey ? -1 : 1)];
      if (next) {
        event.preventDefault(); event.stopPropagation(); enter(next);
      } else {
        // Keep the host toolbar reachable instead of trapping focus inside the canvas.
        const outside = [...(canvas.closest('.app-shell')?.querySelectorAll<HTMLElement>(controls) ?? [])]
          .filter(element => !canvas.contains(element) && available(element));
        const destination = event.shiftKey ? outside.at(-1) : outside[0];
        if (destination) { event.preventDefault(); event.stopPropagation(); focus(destination); }
      }
      return;
    }
    if (target.closest('.launcher-results')) return;
    if (event.shiftKey || target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="combobox"]')) return;
    const directions: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const grid = target.closest<HTMLElement>('[data-widget-columns]');
    const children = grid ? [...grid.querySelectorAll<HTMLElement>(controls)].filter(available) : items(frame);
    const index = children.indexOf(target);
    if (!children.length) {
      const content = frame.querySelector('.widget-content');
      content?.scrollBy({ left: event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? direction * 48 : 0,
        top: event.key === 'ArrowUp' || event.key === 'ArrowDown' ? direction * 48 : 0 });
      return;
    }
    let next = index < 0 ? 0 : (index + direction + children.length) % children.length;
    if (grid && index >= 0 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const columns = Math.max(1, Number(grid.dataset.widgetColumns) || 1);
      const candidate = index + direction * columns;
      const options = frame.querySelector<HTMLButtonElement>('.widget-options-button:not(:disabled)');
      if ((candidate < 0 || candidate >= children.length) && options && available(options)) {
        focus(options); return;
      }
      next = candidate < 0 ? index + Math.floor((children.length - 1 - index) / columns) * columns
        : candidate >= children.length ? index % columns : candidate;
    }
    focus(children[next]);
  }
  canvas.addEventListener('focusin', focused);
  canvas.addEventListener('keydown', keyboard);
  return {
    update(value: boolean) { enabled = value; },
    destroy() {
      canvas.removeEventListener('focusin', focused);
      canvas.removeEventListener('keydown', keyboard);
    },
  };
}
