window.OrbitUI = {
  language: document.documentElement.lang === 'en' ? 'en' : 'it',
  t(italian, english) { return this.language === 'en' ? english : italian; },
  error(error) {
    const status = document.querySelector('#error');
    status.textContent = String(error);
    status.hidden = false;
  },
  clearError() { document.querySelector('#error').hidden = true; },
};
const localizedLabels = [
  ['#new', 'Nuova chat', 'New chat'], ['#capture', 'Nuovo screenshot', 'New screenshot'],
  ['#remove', 'Rimuovi allegato', 'Remove attachment'], ['#cancel-capture', 'Annulla richiesta', 'Cancel request'],
  ['#send', 'Invia', 'Send'], ['#stop', 'Interrompi', 'Stop'], ['#refresh', 'Aggiorna', 'Refresh'],
  ['#previous', 'Precedente', 'Previous'], ['#next', 'Successiva', 'Next'],
  ['#send-to', 'Invia a...', 'Send to...'], ['#confirm-delete', 'Elimina definitivamente', 'Delete permanently'],
  ['#cancel-delete', 'Annulla', 'Cancel'], ['.detail-actions #delete', 'Elimina', 'Delete'],
  ['.gallery-toolbar h1', 'I tuoi screenshot', 'Your screenshots'],
  ['.gallery-toolbar p', 'Salvati sul dispositivo, dal piu recente.', 'Saved on this device, newest first.'],
  ['#empty', 'Nessuno screenshot. Cattura il primo dettaglio.', 'No screenshots yet. Capture your first detail.'],
  ['#preview-empty', "L'anteprima comparira qui.", 'Your preview will appear here.'],
  ['#delete-confirmation p', 'Eliminare questo screenshot dal dispositivo?', 'Delete this screenshot from your device?'],
  ['#form small', "L'immagine parte solo con Invia.", 'The image is shared only when you send.'],
];
function renderLanguage(language) {
  OrbitUI.language = language;
  document.documentElement.lang = language;
  for (const [selector, italian, english] of localizedLabels) {
    const element = document.querySelector(selector);
    if (element) element.textContent = OrbitUI.t(italian, english);
  }
  const message = document.querySelector('#message');
  if (message) {
    message.placeholder = OrbitUI.t('Cosa vuoi sapere?', 'What would you like to know?');
    message.setAttribute('aria-label', OrbitUI.t('Messaggio', 'Message'));
  }
  if (document.querySelector('#sessions')) {
    document.querySelector('#capture').textContent = OrbitUI.t('Allega cattura', 'Attach screenshot');
    document.querySelector('#sessions').setAttribute('aria-label', OrbitUI.t('Conversazione', 'Conversation'));
  }
  if (document.querySelector('#notes')) {
    document.querySelector('#drag').textContent = OrbitUI.t('Appunti', 'Notes');
    document.querySelector('#notes').setAttribute('aria-label', OrbitUI.t('Appunti', 'Notes'));
  }
  if (document.querySelector('#seconds')) {
    document.querySelector('main h1').textContent = OrbitUI.t('Un promemoria, al momento giusto.', 'A reminder at the right time.');
    document.querySelector('#form .primary').textContent = OrbitUI.t('Avvia', 'Start');
    document.querySelector('#seconds').setAttribute('aria-label', OrbitUI.t('Secondi', 'Seconds'));
    document.querySelector('main > small').textContent = OrbitUI.t(
      'Puoi chiudere la finestra: Orbit conserva la scadenza. Se esci da Orbit, la riprende al prossimo avvio.',
      'You can close this window: Orbit keeps the deadline. If you quit Orbit, it resumes on the next launch.');
  }
  window.dispatchEvent(new CustomEvent('orbit:ui-locale', { detail: language }));
}
renderLanguage(OrbitUI.language);
if (Orbit.locale) {
  let changed = false;
  Orbit.locale.onChange(language => { changed = true; renderLanguage(language); });
  Orbit.locale.get().then(language => { if (!changed) renderLanguage(language); }).catch(OrbitUI.error);
}
document.querySelector('#drag').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  Orbit.window.drag().catch(OrbitUI.error);
});
document.querySelector('#close').addEventListener('click', () => Orbit.window.close().catch(OrbitUI.error));
document.querySelector('#hide').addEventListener('click', () => Orbit.window.hide().catch(OrbitUI.error));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing) return;
  event.preventDefault();
  Orbit.window.hide().catch(OrbitUI.error);
});
window.addEventListener('orbit:error', event => OrbitUI.error(event.detail));
for (const direction of ['North','South','East','West','NorthEast','NorthWest','SouthEast','SouthWest']) {
  const handle = document.createElement('button');
  handle.className = 'resize';
  handle.dataset.edge = direction;
  handle.tabIndex = -1;
  handle.setAttribute('aria-label', `Ridimensiona ${direction}`);
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    Orbit.window.resize(direction).catch(OrbitUI.error);
  });
  document.body.append(handle);
}
