const preview = document.querySelector('#attachment');
const destinations = document.querySelector('#destinations');
const gallery = document.querySelector('#gallery');
let image = null;
let selectedPath = null;
let entries = [];
let page = 0;
let busy = false;
const pageSize = 24;
const date = entry => new Date(entry.modifiedMs).toLocaleString(OrbitUI.language, { dateStyle: 'short', timeStyle: 'short' });

function controls() {
  for (const id of ['capture', 'refresh', 'confirm-delete', 'cancel-delete']) document.querySelector(`#${id}`).disabled = busy;
  document.querySelector('#send-to').disabled = busy || !image;
  document.querySelector('#delete').disabled = busy || !selectedPath;
  document.querySelector('#previous').disabled = busy || page === 0;
  document.querySelector('#next').disabled = busy || (page + 1) * pageSize >= entries.length;
  for (const button of gallery.querySelectorAll('button')) button.disabled = busy;
}

async function run(operation) {
  if (busy) throw new Error('Una cattura o un aggiornamento e gia in corso.');
  busy = true; controls(); OrbitUI.clearError();
  try { return await operation(); }
  finally { busy = false; controls(); }
}

async function readImage(path) {
  const { base64 } = await Orbit.files.read(path);
  const element = new Image();
  element.src = `data:image/png;base64,${base64}`;
  await element.decode();
  return element;
}

async function clearSelection() {
  if (image) await Orbit.attachments.release(image);
  image = null; selectedPath = null;
  preview.removeAttribute('src'); preview.hidden = true;
  document.querySelector('#preview-empty').hidden = false;
  document.querySelector('#selected-title').textContent = OrbitUI.t('Seleziona uno screenshot', 'Select a screenshot');
  document.querySelector('#selected-meta').textContent = '';
  destinations.replaceChildren();
  document.querySelector('#delete-confirmation').hidden = true;
}

async function selectEntry(entry) {
  const path = `screenshots/${entry.name}`;
  const element = await readImage(path);
  await clearSelection();
  image = await Orbit.attachments.create({ dataUrl: element.src, width: element.naturalWidth, height: element.naturalHeight });
  selectedPath = path;
  preview.src = element.src; preview.hidden = false;
  document.querySelector('#preview-empty').hidden = true;
  document.querySelector('#selected-title').textContent = date(entry);
  document.querySelector('#selected-meta').textContent = `${element.naturalWidth} × ${element.naturalHeight} px · ${Math.ceil(entry.bytes / 1024)} KB`;
  for (const button of gallery.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.path === selectedPath));
}

async function render() {
  gallery.replaceChildren();
  document.querySelector('#empty').hidden = entries.length > 0;
  document.querySelector('#count').textContent = `${entries.length} screenshot · ${entries.length ? page + 1 : 0}/${Math.ceil(entries.length / pageSize)}`;
  for (const entry of entries.slice(page * pageSize, (page + 1) * pageSize)) {
    const button = document.createElement('button');
    button.className = 'screenshot-card'; button.dataset.path = `screenshots/${entry.name}`;
    button.setAttribute('aria-label', `Apri screenshot ${date(entry)}`);
    button.setAttribute('aria-pressed', String(button.dataset.path === selectedPath));
    button.disabled = busy;
    const thumbnail = document.createElement('img'); thumbnail.alt = '';
    const label = document.createElement('small'); label.textContent = date(entry);
    button.append(thumbnail, label); gallery.append(button);
    button.onclick = () => run(() => selectEntry(entry)).catch(OrbitUI.error);
    try {
      const element = await readImage(button.dataset.path);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 240 / Math.max(element.naturalWidth, element.naturalHeight));
      canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Anteprima non disponibile.');
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      thumbnail.src = canvas.toDataURL('image/png');
    } catch (error) {
      label.textContent = OrbitUI.t('Immagine non leggibile', 'Unreadable image');
      OrbitUI.error(`${entry.name}: ${error}`);
    }
  }
}

async function refresh(selectPath) {
  const folders = await Orbit.files.list();
  entries = folders.some(entry => entry.directory && entry.name === 'screenshots')
    ? (await Orbit.files.list('screenshots')).filter(entry => !entry.directory && entry.name.toLowerCase().endsWith('.png'))
      .sort((a, b) => b.modifiedMs - a.modifiedMs || b.name.localeCompare(a.name))
    : [];
  if (selectedPath && !entries.some(entry => `screenshots/${entry.name}` === selectedPath)) await clearSelection();
  page = Math.min(page, Math.max(0, Math.ceil(entries.length / pageSize) - 1));
  const index = selectPath ? entries.findIndex(entry => `screenshots/${entry.name}` === selectPath) : -1;
  if (index >= 0) page = Math.floor(index / pageSize);
  await render();
  if (index >= 0) await selectEntry(entries[index]);
}

async function select(signal) {
  if (signal?.aborted) throw new Error('Richiesta annullata.');
  document.querySelector('#status').textContent = '';
  const cancel = () => Orbit.capture.cancel().catch(OrbitUI.error);
  signal?.addEventListener('abort', cancel, { once: true });
  let next;
  try {
    next = await Orbit.attachments.create(await Orbit.capture.select());
    const saved = await Orbit.attachments.save(next);
    document.querySelector('#status').textContent = OrbitUI.t('Screenshot salvato automaticamente.', 'Screenshot saved automatically.');
    return { image: next, path: saved.path };
  } catch (error) {
    if (next) await Orbit.attachments.release(next);
    throw error;
  } finally { signal?.removeEventListener('abort', cancel); }
}

async function capture() {
  const next = await select();
  await Orbit.attachments.release(next.image);
  await refresh(next.path);
}
document.querySelector('#capture').onclick = () => run(capture).catch(OrbitUI.error);
document.querySelector('#refresh').onclick = () => run(() => refresh()).catch(OrbitUI.error);
document.querySelector('#previous').onclick = () => run(async () => { page--; await render(); }).catch(OrbitUI.error);
document.querySelector('#next').onclick = () => run(async () => { page++; await render(); }).catch(OrbitUI.error);
document.querySelector('#delete').onclick = () => { document.querySelector('#delete-confirmation').hidden = false; };
document.querySelector('#cancel-delete').onclick = () => { document.querySelector('#delete-confirmation').hidden = true; };
document.querySelector('#confirm-delete').onclick = () => run(async () => {
  if (!selectedPath) return;
  await Orbit.files.remove(selectedPath);
  await clearSelection();
  document.querySelector('#status').textContent = OrbitUI.t('Screenshot eliminato.', 'Screenshot deleted.');
  await refresh();
}).catch(OrbitUI.error);
document.querySelector('#send-to').onclick = () => run(async () => {
  if (!image) return;
  destinations.replaceChildren();
  const choices = await Orbit.services.list('image.receive', 1, 'image/png');
  if (!choices.length) { destinations.textContent = 'Nessuna app compatibile. Installa o abilita Chat dal catalogo.'; return; }
  for (const choice of choices) {
    const button = document.createElement('button');
    button.className = 'destination';
    const title = document.createElement('strong'); title.textContent = `${choice.appName} · ${choice.feature.title}`;
    const description = document.createElement('small'); description.textContent = choice.feature.description;
    button.append(title, description);
    button.onclick = () => run(async () => {
      if (!image) throw new Error('Seleziona uno screenshot.');
      destinations.replaceChildren();
      const result = await Orbit.services.call({ contract: 'image.receive', intent: 'interactive', input: { image }, provider: choice.appId, actionId: choice.feature.id });
      if (!result.accepted) throw new Error("La destinazione non ha accettato l'immagine.");
      document.querySelector('#status').textContent = `Immagine inviata a ${choice.appName}.`;
    }).catch(OrbitUI.error);
    destinations.append(button);
  }
}).catch(OrbitUI.error);
const ready = run(() => refresh());
ready.catch(OrbitUI.error);
(async () => {
  const preferences = await Orbit.preferences.read();
  await ready;
  const invoked = await Orbit.services.register({ capture: (_, context) => run(async () => {
    const result = await select(context.signal);
    try { await refresh(); }
    catch (error) { await Orbit.attachments.release(result.image); throw error; }
    return { image: result.image };
  }) });
  const hotkey = await Orbit.actions.register({ capture: () => run(capture) });
  if (!invoked && !hotkey && preferences['auto-capture']) await run(capture);
})().catch(OrbitUI.error);
