const list = document.querySelector('#timers');
let timers = [];
let loading = false;
let preferences;
window.addEventListener('orbit:ui-locale', () => render());
Orbit.preferences.onChange(values => { preferences = values; });
function render() {
  list.replaceChildren();
  for (const timer of timers) {
    const row = document.createElement('div');
    row.className = 'timer'; row.setAttribute('role', 'listitem');
    const label = document.createElement('span');
    const left = Math.max(0, timer.deadline - Math.floor(Date.now() / 1000));
    label.textContent = `${timer.label} · ${timer.fired ? OrbitUI.t('Terminato', 'Finished') : `${left} s`}`;
    const cancel = document.createElement('button');
    cancel.textContent = timer.fired ? OrbitUI.t('Rimuovi', 'Remove') : OrbitUI.t('Annulla', 'Cancel');
    cancel.onclick = () => Orbit.timers.cancel(timer.id).then(refresh).catch(OrbitUI.error);
    row.append(label, cancel); list.append(row);
  }
}
async function refresh() {
  if (loading) return;
  loading = true;
  try { timers = await Orbit.timers.list(); render(); }
  finally { loading = false; }
}
document.querySelector('#form').onsubmit = async event => {
  event.preventDefault(); OrbitUI.clearError();
  try {
    await Orbit.timers.start(`timer-${crypto.randomUUID()}`, document.querySelector('#label').value,
      Number(document.querySelector('#seconds').value));
    await refresh();
  } catch (error) { OrbitUI.error(error); }
};
document.querySelector('#form button').disabled = true;
Orbit.preferences.read().then(async values => {
  preferences = values;
  document.querySelector('#seconds').value = values.duration;
  await refresh();
  document.querySelector('#form button').disabled = false;
  await Orbit.actions.register({
    'quick-timer': async () => {
      await Orbit.timers.start(`timer-${crypto.randomUUID()}`, 'Timer rapido', Number(preferences.duration));
      await refresh();
    },
    'focus-timer': () => { document.querySelector('#seconds').focus(); document.querySelector('#seconds').select(); },
  });
}).catch(OrbitUI.error);
setInterval(() => {
  if (!document.hidden) refresh().catch(OrbitUI.error);
}, 1000);
