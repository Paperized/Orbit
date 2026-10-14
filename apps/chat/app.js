const log = document.querySelector('#messages');
const input = document.querySelector('#message');
const attachment = document.querySelector('#attachment');
const selector = document.querySelector('#sessions');
const sessions = [];
let current;
let active = null;
let selecting = null;
let sending = false;
let preferences;
function controls() {
  for (const id of ['send', 'capture', 'delete', 'message', 'remove']) document.getElementById(id).disabled = !!active || !!selecting || sending;
  document.querySelector('#stop').hidden = !active;
  document.querySelector('#cancel-capture').hidden = !selecting;
}
function render() {
  selector.replaceChildren();
  sessions.forEach((session, index) => {
    const option = document.createElement('option'); option.value = session.id;
    option.textContent = `Chat ${index + 1}${session.pending ? ' · immagine' : ''}`; selector.append(option);
  });
  selector.value = current.id; input.value = current.draft;
  log.replaceChildren();
  for (const message of current.messages) {
    const row = document.createElement('div'); row.className = `message ${message.role}`;
    if (message.image) { const image = document.createElement('img'); image.src = message.image; image.alt = 'Area inviata'; row.append(image); }
    row.append(document.createTextNode(message.content)); log.append(row);
  }
  log.scrollTop = log.scrollHeight;
  attachment.hidden = !current.pending;
  document.querySelector('#remove').hidden = !current.pending;
  if (current.pending) attachment.src = current.pending.dataUrl;
  else attachment.removeAttribute('src');
  controls();
}
function newChat() {
  if (sessions.length >= 20) throw new Error('Limite di 20 conversazioni aperte. Eliminane una prima di continuare.');
  current = { id: crypto.randomUUID(), messages: [], draft: '', pending: null };
  sessions.push(current); render(); input.focus();
  return current;
}
async function setImage(session, reference) {
  const data = await Orbit.attachments.read(reference);
  await Orbit.attachments.retain(reference);
  if (session.pending) await Orbit.attachments.release(session.pending.reference);
  session.pending = { ...data, reference };
  render();
}
async function requestCapture(choice) {
  if (selecting || active || sending) throw new Error('Attendi la richiesta in corso.');
  const session = current;
  selecting = new AbortController(); controls(); OrbitUI.clearError();
  document.querySelector('#providers').replaceChildren();
  try {
    const result = await Orbit.services.call({ contract: 'image.capture', intent: 'service', input: {}, provider: choice.appId, actionId: choice.feature.id, signal: selecting.signal });
    await setImage(session, result.image);
  } finally { selecting = null; controls(); }
}
async function capture() {
  if (active || selecting || sending) throw new Error('Attendi la richiesta in corso.');
  const choices = await Orbit.services.list('image.capture');
  if (!choices.length) throw new Error('Installa o abilita Cattura dal catalogo per allegare un’immagine.');
  if (choices.length === 1) return requestCapture(choices[0]);
  const providers = document.querySelector('#providers'); providers.replaceChildren();
  for (const choice of choices) {
    const button = document.createElement('button'); button.textContent = `${choice.appName} · ${choice.feature.title}`; button.title = choice.feature.description;
    button.onclick = () => requestCapture(choice).catch(OrbitUI.error); providers.append(button);
  }
}
input.oninput = () => { current.draft = input.value; };
selector.onchange = () => { current = sessions.find(session => session.id === selector.value); render(); };
document.querySelector('#new').onclick = () => { try { newChat(); } catch (error) { OrbitUI.error(error); } };
document.querySelector('#capture').onclick = () => capture().catch(OrbitUI.error);
document.querySelector('#cancel-capture').onclick = () => selecting?.abort();
document.querySelector('#stop').onclick = () => active?.cancel().catch(OrbitUI.error);
document.querySelector('#remove').onclick = async () => {
  const session = current;
  try { if (session.pending) await Orbit.attachments.release(session.pending.reference); session.pending = null; render(); }
  catch (error) { OrbitUI.error(error); }
};
document.querySelector('#delete').onclick = async () => {
  if (active || selecting || sending) return;
  const session = current;
  try {
    if (session.pending) await Orbit.attachments.release(session.pending.reference);
    sessions.splice(sessions.indexOf(session), 1);
    if (sessions.length) { current = sessions[0]; render(); } else newChat();
  } catch (error) { OrbitUI.error(error); }
};
document.querySelector('#form').onsubmit = async event => {
  event.preventDefault();
  if (active || selecting || sending || !input.value.trim()) return;
  const session = current;
  if (session.messages.length >= 98) { OrbitUI.error('Apri una nuova chat: limite di 50 turni raggiunto.'); return; }
  const outgoing = { role: 'user', content: input.value.trim() };
  sending = true; controls();
  if (session.pending) {
    outgoing.image = session.pending.dataUrl;
    try { await Orbit.attachments.release(session.pending.reference); }
    catch (error) { sending = false; controls(); OrbitUI.error(error); return; }
    session.pending = null;
  }
  session.draft = ''; session.messages.push(outgoing);
  const payload = session.messages.map(message => ({ ...message }));
  const answer = { role: 'assistant', content: '' };
  session.messages.push(answer); OrbitUI.clearError();
  active = Orbit.ai.chat(payload, event => {
    if (event.kind === 'delta') { answer.content += event.text; if (current === session) render(); }
    else if (event.kind === 'error') OrbitUI.error(event.text);
    else if (event.kind === 'cancelled') OrbitUI.error('Risposta interrotta.');
  });
  sending = false;
  render();
  try { await active.done; }
  catch (error) { OrbitUI.error(error); }
  finally { if (!answer.content) session.messages.pop(); active = null; render(); }
};
input.addEventListener('keydown', event => {
  if (preferences?.['send-on-enter'] && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.querySelector('#form').requestSubmit(); }
});
newChat();
Orbit.preferences.onChange(values => { preferences = values; });
(async () => {
  preferences = await Orbit.preferences.read();
  await Orbit.services.register({
    'receive-image': async () => { throw new Error('Usa la funzione interattiva dedicata, non la Chat completa.'); },
  });
  await Orbit.actions.register({ capture, 'new-chat': () => { newChat(); } });
})().catch(OrbitUI.error);
