(() => {
  let pin;
  let close;
  let pinned = false;
  let feature = false;
  const error = reason => window.dispatchEvent(new CustomEvent('orbit:error', { detail: String(reason) }));
  function localize(language = document.documentElement.lang) {
    const en = language === 'en';
    if (pin) {
      pin.setAttribute('aria-label', en ? 'Pin panel' : 'Fissa pannello');
      pin.title = en ? (pinned ? 'Unpin panel: Esc and hotkey can hide it' : 'Pin panel: stays open until closed') : (pinned ? 'Sblocca pannello: Esc e hotkey possono nasconderlo' : 'Fissa pannello: rimane aperto fino alla X');
    }
    if (close) {
      close.setAttribute('aria-label', en ? (feature ? 'Close' : 'Hide') : (feature ? 'Chiudi' : 'Nascondi'));
      close.title = en ? (feature ? 'Close this feature' : 'Hide without closing') : (feature ? 'Chiudi questa funzione' : 'Nascondi senza chiudere');
    }
  }
  function update(active) {
    pinned = active;
    if (!pin) return;
    pin.setAttribute('aria-pressed', String(active));
    pin.title = active ? 'Sblocca pannello: Esc e hotkey possono nasconderlo' : 'Fissa pannello: rimane aperto fino alla X';
    localize();
  }
  function ready() {
    if (!document.querySelector('script[src="ui.js"]')) return;
    pin = document.querySelector('header #hide');
    close = document.querySelector('header #close');
    Orbit.context().then(context => {
      feature = context.mode === 'interactive';
      localize();
      if (feature && close) { close.setAttribute('aria-label', 'Chiudi'); close.title = 'Chiudi questa funzione'; }
    }).catch(error);
    if (close) {
      close.setAttribute('aria-label', 'Nascondi');
      close.title = 'Nascondi senza chiudere';
    }
    if (!pin) return;
    pin.setAttribute('aria-label', 'Fissa pannello');
    pin.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-4 1-4 4v4l-2 2-6-6 2-2h4l4-4zM2 22l6-6"/></svg>';
    pin.disabled = true;
    Orbit.window.getState().then(state => update(state.pinned)).catch(error).finally(() => { pin.disabled = false; });
  }
  // Capture before legacy ui.js handlers: installed packages keep their immutable assets.
  window.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (!button || (button !== pin && button !== close)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button === close) {
      (feature ? Orbit.window.close() : Orbit.window.hide()).catch(error);
    } else if (!pin.disabled) {
      pin.disabled = true;
      Orbit.window.setPinned(!pinned).catch(error).finally(() => { pin.disabled = false; });
    }
  }, { capture: true });
  window.addEventListener('keydown', event => {
    if (!close || event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) Orbit.window.dismiss().catch(error);
  }, { capture: true });
  window.addEventListener('orbit:pin', event => update(event.detail));
  window.addEventListener('orbit:locale', event => localize(event.detail));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
