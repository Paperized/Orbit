(() => {
  if (window.__ORBIT_APPEARANCE_READY__) return;
  window.__ORBIT_APPEARANCE_READY__ = true;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = window.__ORBIT_THEME_MODE__ || 'system';
  function apply() {
    if (!document.documentElement) return;
    const theme = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = theme;
    window.dispatchEvent(new CustomEvent('orbit:appearance', { detail: { mode, theme } }));
  }
  window.addEventListener('orbit:theme', event => {
    if (!['system', 'light', 'dark'].includes(event.detail)) {
      window.dispatchEvent(new CustomEvent('orbit:error', { detail: 'Modalita tema non valida.' }));
      return;
    }
    mode = event.detail;
    apply();
  });
  system.addEventListener('change', () => { if (mode === 'system') apply(); });
  if (document.documentElement) apply();
  else {
    const observer = new MutationObserver(() => {
      if (document.documentElement) { apply(); observer.disconnect(); }
    });
    observer.observe(document, { childList: true });
  }
  function ready() {
    if (location.protocol === 'orbitapp:' || location.hostname.startsWith('orbitapp.')) {
      if (document.querySelector('script[src="ui.js"]')) document.documentElement.dataset.orbitUi = '';
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/orbit-theme.css';
      document.head.append(link);
    }
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
