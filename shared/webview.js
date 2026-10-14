(() => {
  window.addEventListener('contextmenu', event => event.preventDefault(), { capture: true });
  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const inspect = ['i', 'j', 'c'].includes(key)
      && ((event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey));
    if (key === 'f12' || inspect) event.preventDefault();
  }, { capture: true });
})();
