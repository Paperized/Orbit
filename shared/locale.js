(() => {
  if (window.__ORBIT_LOCALE_READY__) return;
  window.__ORBIT_LOCALE_READY__ = true;
  function apply(locale) {
    if (locale !== 'it' && locale !== 'en') {
      window.dispatchEvent(new CustomEvent('orbit:error', { detail: 'Lingua non supportata.' }));
      return;
    }
    window.__ORBIT_LOCALE__ = locale;
    if (document.documentElement) document.documentElement.lang = locale;
  }
  window.addEventListener('orbit:locale', event => apply(event.detail));
  document.addEventListener('DOMContentLoaded', () => apply(window.__ORBIT_LOCALE__ || 'it'), { once: true });
  apply(window.__ORBIT_LOCALE__ || 'it');
})();
