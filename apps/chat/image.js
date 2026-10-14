const log = document.querySelector('#messages');
const input = document.querySelector('#message');
const preview = document.querySelector('#attachment');
const messages = [];
let image;
let active;
let preferences;
function render() {
  log.replaceChildren();
  for (const message of messages) {
    const row = document.createElement('div'); row.className = `message ${message.role}`;
    if (message.image) { const img = document.createElement('img'); img.src = message.image; img.alt = 'Immagine inviata'; row.append(img); }
    row.append(document.createTextNode(message.content)); log.append(row);
  }
  log.scrollTop = log.scrollHeight;
  input.disabled = !!active;
  document.querySelector('#send').disabled = !!active || !image;
  document.querySelector('#stop').hidden = !active;
}
document.querySelector('#stop').onclick = () => active?.cancel().catch(OrbitUI.error);
document.querySelector('#form').onsubmit = async event => {
  event.preventDefault();
  if (active || !image || !input.value.trim()) return;
  if (messages.length >= 98) { OrbitUI.error('Limite di 50 turni raggiunto.'); return; }
  messages.push({ role: 'user', content: input.value.trim(), ...(!messages.length ? { image: image.dataUrl } : {}) });
  input.value = ''; preview.hidden = true;
  const payload = messages.map(message => ({ ...message }));
  const answer = { role: 'assistant', content: '' }; messages.push(answer);
  OrbitUI.clearError();
  active = Orbit.ai.chat(payload, event => {
    if (event.kind === 'delta') { answer.content += event.text; render(); }
    if (event.kind === 'error' || event.kind === 'cancelled') OrbitUI.error(event.text || 'Risposta interrotta.');
  });
  render();
  try { await active.done; } catch (error) { OrbitUI.error(error); }
  finally { if (!answer.content) messages.pop(); active = null; render(); input.focus(); }
};
input.addEventListener('keydown', event => {
  if (preferences?.['send-on-enter'] && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.querySelector('#form').requestSubmit(); }
});
Orbit.preferences.onChange(values => { preferences = values; });
render();
(async () => {
  const context = await Orbit.context();
  if (context.mode !== 'interactive' || context.invocation?.actionId !== 'receive-image') throw new Error('Questa pagina richiede una sessione di funzione.');
  preferences = await Orbit.preferences.read();
  await Orbit.services.register({
    'receive-image': async (value, context) => {
      if (context.intent !== 'interactive' || image) throw new Error('Invocazione non valida.');
      const loaded = await Orbit.attachments.read(value.image);
      if (context.signal.aborted) throw new Error('Richiesta annullata.');
      image = loaded;
      preview.src = image.dataUrl; preview.hidden = false;
      input.value = value.prompt ?? '';
      document.querySelector('#caller').textContent = `Immagine da ${context.callerName}`;
      render(); input.focus();
      return { accepted: true };
    },
  });
})().catch(OrbitUI.error);
