const notes = document.querySelector('#notes');
const status = document.querySelector('#status');
let saving = Promise.resolve();
function applyPreferences(values) {
  notes.style.fontSize = `${values['font-size']}px`;
  notes.spellcheck = values.spellcheck;
  notes.placeholder = values.placeholder;
}
Orbit.preferences.onChange(applyPreferences);
Promise.all([Orbit.storage.read(), Orbit.preferences.read()]).then(async ([data, preferences]) => {
  applyPreferences(preferences);
  notes.value = typeof data.note === 'string' ? data.note : '';
  notes.disabled = false;
  status.textContent = OrbitUI.t('Salvato sul dispositivo', 'Saved on this device');
  await Orbit.actions.register({ 'focus-editor': () => {
    notes.focus(); notes.setSelectionRange(notes.value.length, notes.value.length);
  } });
}).catch(OrbitUI.error);
notes.addEventListener('input', () => {
  const note = notes.value;
  status.textContent = OrbitUI.t('Salvataggio...', 'Saving...');
  const write = () => Orbit.storage.write({ note });
  saving = saving.then(write, write);
  saving.then(() => { status.textContent = OrbitUI.t('Salvato sul dispositivo', 'Saved on this device'); }).catch(error => {
    status.textContent = OrbitUI.t('Salvataggio non riuscito', 'Save failed');
    OrbitUI.error(error);
  });
});
Orbit.lifecycle.beforeClose(() => saving);
window.addEventListener('orbit:ui-locale', () => {
  for (const pair of [['Salvataggio...', 'Saving...'], ['Salvato sul dispositivo', 'Saved on this device'], ['Salvataggio non riuscito', 'Save failed']]) {
    if (pair.includes(status.textContent)) { status.textContent = OrbitUI.t(...pair); break; }
  }
});
