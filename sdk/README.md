# SDK Orbit v1

Pacchetto SDK **1.9.0**, compatibile con il protocollo `sdk: 1`. Manteniamo le richieste precedenti; le vecchie funzioni `handoff` devono dichiarare una pagina dedicata prima di essere invocate.

Una sotto-app e un pacchetto statico HTML/JS/CSS con una propria finestra sempre in primo piano. Puo usare JavaScript semplice o un framework compilato: non serve Svelte e non viene eseguito un server Node. Orbit fornisce i servizi nativi, non il layout interno dell'app.

## Creare un pacchetto

Usare `apps/notes` come esempio minimo, oppure `apps/timer` per una utility non AI. Ogni cartella contiene un `manifest.json` e gli asset:

```json
{
  "id": "my-notes",
  "name": "Le mie note",
  "description": "Una utility locale",
  "version": "1.0.0",
  "sdk": 1,
  "entry": "index.html",
  "permissions": ["storage"],
  "shortcut": null
}
```

L'ID deve iniziare con una lettera minuscola e contenere solo `a-z`, cifre e trattini, massimo 64 caratteri. Le versioni hanno tre segmenti numerici, senza prerelease. Una versione gia distribuita non puo cambiare contenuto: incrementarla.

Caricare JavaScript e CSS da file esterni; script, handler HTML e stili inline sono bloccati dalla CSP:

```html
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Le mie note</title>
  <link rel="stylesheet" href="style.css">
  <script src="/orbit-sdk.js" defer></script>
  <script src="app.js" defer></script>
</head>
<body>
  <textarea id="note" aria-label="Nota" disabled></textarea>
  <button id="close">Chiudi</button>
  <p id="status" role="status"></p>
</body>
</html>
```

`/orbit-sdk.js` e fornito dall'host e rende disponibile `Orbit`; non includere un file con quel nome nel pacchetto. Per progetti con bundler, `npm run build:sdk` genera anche `sdk/dist/orbit-sdk.mjs` e `index.d.ts`. `npm pack ./sdk` crea l'archivio installabile come dipendenza `@orbit/sdk`, non pubblicata su npm.

Il packer elabora le sottocartelle di una directory:

```sh
# Le quattro app del progetto
npm run build:sdk
npm run build:apps

# Directory esterna: my-apps/my-notes/{manifest.json,index.html,...}
node scripts/pack-apps.mjs ./my-apps ./my-packages
```

Eseguire dalla radice del progetto. Il packer aggiunge `ui.js` e `common.css` da `apps/shared`; usarli e facoltativo, ma quei due nomi sono riservati dal packer. La UI condivisa richiede i controlli `#drag`, `#hide`, `#close`, `#error` degli esempi. L'host riconosce `script[src="ui.js"]` e gestisce i controlli nell'header: `#hide` diventa il pin, `#close` nasconde senza terminare, Esc rispetta il pin. Questo vale anche per i pacchetti precedenti, senza modificarne gli asset; trascinamento e resize restano nella UI condivisa. In alternativa implementare la propria UI usando `Orbit.window`.

Il file `.orbit` e JSON, non ZIP: `{ "manifest": {...}, "files": { "index.html": "<base64>", ... } }`. Limiti: 20 MiB per il file, 12 MiB di asset decodificati, 128 asset. I percorsi sono relativi e non ammettono traversal o symlink. Aprire **App e catalogo > Installa > Installazione manuale**, importare il file e approvare i permessi: installazione e avvio non richiedono ricompilazione dell'host.

## Servizi disponibili

| API | Permesso | Comportamento |
|---|---|---|
| `Orbit.context()` | Nessuno | ID, nome, versione, SDK, piattaforma e permessi |
| `Orbit.appearance.get()/onChange(handler)` | Nessuno | Legge il tema host; riceve modalita e tema effettivo, anche al cambio del tema del computer |
| `Orbit.window.hide/close/drag/resize(...)` | Nessuno | Agisce soltanto sulla finestra chiamante |
| `Orbit.window.dismiss()` | Nessuno | Nasconde solo se il pannello non e fissato; usare per Esc |
| `Orbit.window.getState()` | Nessuno | Restituisce `{ pinned, visible }` della finestra chiamante |
| `Orbit.window.setPinned(boolean)/onPinChange(handler)` | Nessuno | Imposta il pin o ascolta i cambiamenti; il listener restituisce una funzione di rimozione |
| `Orbit.lifecycle.beforeClose(handler)` | Nessuno | Registra un hook asincrono; restituisce la funzione per rimuoverlo |
| `Orbit.preferences.read/update(values)/onChange(handler)` | Nessuno | Preferenze dichiarate, private dell'app; aggiornamento parziale e notifiche dal vivo |
| `Orbit.actions.register(handlers)` | Nessuno | Collega una funzione JS a ogni azione dichiarata; gestisce anche le richieste all'avvio |
| `Orbit.shortcuts.list()` | Nessuno | Registro delle assegnazioni Orbit, anche inattive; non espone dati o preferenze delle altre app |
| `Orbit.shortcuts.check(actionId,shortcut)` | Nessuno | Valida la hotkey della propria azione e restituisce i conflitti con app/host |
| `Orbit.storage.read/write(value)` | `storage` | Documento JSON privato dell'app, inizialmente `{}`, massimo 1 MiB |
| `Orbit.timers.list/start(id,label,seconds)/cancel(id)` | `timers` | Fino a 32 timer, da 1 secondo a 24 ore, deadline Unix in secondi |
| `Orbit.capture.select()` | `screen-capture` | Selezione gestita dall'host; restituisce `{ dataUrl, width, height }` del solo ritaglio |
| `Orbit.capture.cancel()` | `screen-capture` | Annulla soltanto la selezione attiva della propria app |
| `Orbit.services.list/register/call(...)` | `app-actions` | Scoperta e chiamate asincrone delle funzioni dichiarate |
| `Orbit.attachments.create(image)` | `screen-capture` | Crea un riferimento opaco a un PNG validato |
| `Orbit.attachments.read/retain/release(ref)` | Nessuno aggiuntivo | Richiede un accesso gia concesso all'allegato |
| `Orbit.attachments.save(ref)` | `file-save` | Salva il PNG nella propria cartella `files/screenshots`, restituisce `{ saved: true, path }` relativo |
| `Orbit.files.read(path)` | `files-read` | Legge un file e restituisce `{ base64 }`; percorso assoluto esterno o relativo alla propria cartella file |
| `Orbit.files.list(path = '')` | `files-read` | Elenca `{ name, directory, bytes, modifiedMs }`; anche cartelle esterne accessibili all'account. `modifiedMs` e l'ultima modifica in millisecondi Unix |
| `Orbit.files.write(path, base64)` | `files-write` | Scrive solo nella propria cartella file, creando le sottocartelle; restituisce `{ path, bytes }` |
| `Orbit.files.remove(path)` | `files-write` | Elimina un file della propria cartella; non elimina directory |
| `Orbit.widgets.read(widgetId)` | `files-read` | Legge `{ entries: [{ name, dataUrl }], warning }` della propria dichiarazione widget; nessun ID app o percorso arbitrario |
| `Orbit.ai.chat(messages,onEvent)` | `ai-chat` | Streaming via provider configurato nell'host; restituisce `{ done, cancel }` |

I metodi asincroni rifiutano la Promise in caso di errore: mostrarlo nella UI, senza simulare risultati. `storage.write` sostituisce l'intero documento; serializzare i salvataggi per non sovrascrivere modifiche piu recenti. I dati non sono cifrati e non sono un portachiavi.

I dati sono centralizzati in `Documenti/Orbit`; `storage`, preferenze e timer in `apps/data/<id>`, i file in `apps/data/<id>/files`. La lettura `files-read` non e confinata: puo includere file sensibili e dati delle altre app, nei limiti dei permessi del sistema operativo. Va dichiarata nel manifest e autorizzata all'installazione. La scrittura resta confinata indipendentemente dal permesso di lettura: usare percorsi relativi con `/`, senza `..`, volumi, nomi riservati Windows o collegamenti filesystem. Un file puo avere fino a 16 MiB; quota scrittura 256 MiB per app; elenco fino a 2000 elementi (oltre viene restituito un errore).

Il manifest puo dichiarare `window: { "width": 1180, "height": 800 }` per la dimensione iniziale in pixel logici (larghezza 340–1920, altezza 300–1200). L'host la adatta al monitor disponibile; senza questo campo rimane il pannello 440 × 520. La dimensione e un default di creazione, non blocca il ridimensionamento dell'utente.

Le WebView non hanno Node, shell o plugin filesystem generici. Anche chiamando direttamente IPC, Rust verifica finestra chiamante, permesso e percorso. Il JavaScript puo usare lo storage web della propria origine, ma non scrivere percorsi arbitrari del computer. Il confine non protegge da processi locali esterni che possiedono gli stessi privilegi dell'host.

### Widget nella home

Il clic su una miniatura apre un visualizzatore modale gestito dall'host. L'originale viene letto solo su richiesta, con gli stessi limiti di decodifica e solo nella sorgente dichiarata; nessuna finestra app viene aperta. `actions: []` lascia il solo catalogo immagini. Il polling rimane automatico; non c'e un pulsante di aggiornamento permanente.

Ogni app puo dichiarare fino a 8 widget; nessuna registrazione nel codice dell'host. Esempio:

```json
{
  "widgets": [{
    "id": "recent-captures",
    "title": "Ultimi screenshot",
    "description": "Le catture piu recenti.",
    "width": 1,
    "height": 1,
    "source": { "type": "recent-images", "path": "screenshots", "limit": 36 },
    "grid": { "rows": 2, "columns": 2 },
    "actions": ["capture", "open"]
  }]
}
```

`id` e stabile (stesse regole dell'ID app), titolo 1–80 byte, descrizione fino a 400 byte. `width` e `height` sono 1 o 2 celle, non pixel. Fino a 3 azioni uniche: `open` o ID gia presenti in `actions` dell'app. Il clic usa il normale launcher, con controlli di abilitazione/dipendenze; visualizzare il widget non avvia finestre o sessioni dell'app e non modifica quelle esistenti.

Questa versione offre **solo l'handler dichiarativo `recent-images`**: cartella relativa a `apps/data/<id>/files`, fino a 36 PNG recenti, ordinati per ultima modifica decrescente (nome decrescente a parita). Richiede `files-read`, ma **le sorgenti widget non consentono percorsi assoluti, traversal, symlink o junction**, a differenza della lettura generale `Orbit.files`. L'app puo produrre immagini attraverso il normale SDK; la home non esegue i suoi script. Non sono supportati provider JavaScript, HTML/CSS arbitrario, immagini remote o azioni verso altre app.

`grid` e facoltativo: dichiara i valori iniziali di righe/colonne e abilita i relativi controlli nei tre puntini. Entrambi sono interi 1–6 e il prodotto iniziale non puo superare `source.limit` (1–36). I valori scelti dall'utente devono rispettare lo stesso limite e si salvano in `instance.settings: { rows, columns }`, non nelle preferenze globali dell'app. Orbit rende la griglia nel rettangolo disponibile, adatta le immagini con `object-fit: contain` e nasconde didascalie/descrizione quando manca spazio. L'app stabilisce sorgente, limite e default; il renderer dell'host applica le scelte per istanza senza eseguire codice remoto o arbitrario. Le vecchie dichiarazioni senza `grid` conservano due colonne e il precedente limite; i tre puntini consentono comunque la rimozione. `Orbit.widgets.read()` usa i default della dichiarazione, non le impostazioni personali della home. Il comando riservato all'host accetta un conteggio e lo limita nuovamente alla dichiarazione.

L'host genera anteprime PNG fino a 240 × 140 px: massimo 16 MiB per originale, dimensioni 8192 × 8192 e budget decoder 128 MiB, 160 KiB per anteprima, 2000 elementi per cartella. Legge solo i PNG selezionati; cache in memoria fino a 96 anteprime, invalidata per percorso/ultima modifica/dimensione. File illeggibili vengono segnalati e saltati. Nessuna cattura automatica o trasmissione in rete.

Aggiornamento all'apertura della home, al cambio della griglia e ogni 10 secondi. Cambio strumento, chiusura overlay o rimozione fermano il polling; una lettura nativa gia iniziata termina entro i limiti indicati, senza applicare risultati a componenti rimossi. Non esistono provider WebView da mantenere o terminare. `Orbit.widgets.read()` consente anche all'app completa di leggere le proprie anteprime; nelle sessioni interattive dedicate e vietato come le API file.

Il layout v3 salva istanze con UUID, ID app/widget, titolo di fallback, coordinate/dimensioni in pixel logici e impostazioni facoltative; massimo una istanza per coppia app/widget, 16 totali. Le posizioni si adattano allo spazio senza sovrascrivere le coordinate desktop. Aggiornamenti, disabilitazione e disinstallazione non eliminano le istanze: un segnaposto permette di rimuoverle o recuperarle. Mantenere gli ID dichiarati negli aggiornamenti; incrementare sempre la versione del pacchetto.

### Lingua condivisa

`Orbit.locale.get(): Promise<'it' | 'en'>` legge la lingua selezionata nell'host. `Orbit.locale.onChange(handler)` notifica i cambiamenti nelle finestre gia aperte e restituisce una funzione per rimuovere il listener. Non servono permessi aggiuntivi; l'app deve essere installata e abilitata. La lettura e disponibile anche nelle sessioni interattive. Solo l'host puo modificare la lingua globale.

```js
let changed = false;
const render = language => {
  document.querySelector('#send').textContent = language === 'en' ? 'Send' : 'Invia';
};
const unsubscribe = Orbit.locale.onChange(language => {
  changed = true;
  render(language);
});
Orbit.locale.get().then(language => { if (!changed) render(language); }).catch(OrbitUI.error);
// Chiamare unsubscribe() quando il componente viene smontato.
```

Le nuove finestre ricevono subito il codice lingua; `document.documentElement.lang` viene mantenuto allineato. Le traduzioni appartengono all'app: non vengono tradotti automaticamente i dati utente o il testo restituito dal provider. `apps/shared/ui.js` mostra una piccola implementazione condivisa dalle app incluse, senza dipendenze esterne.

### Rete JavaScript senza wrapper

Il manifest puo dichiarare le origini utilizzabili da `fetch`, `XMLHttpRequest`, WebSocket ed EventSource:

```json
{
  "network": {
    "connect": ["https://api.example.com", "wss://events.example.com:8443"]
  }
}
```

```js
const response = await fetch('https://api.example.com/data');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
```

`network.connect` e un permesso: il catalogo mostra le destinazioni prima dell'approvazione e nelle schede installate. Assente o vuoto, non abilita connessioni esterne. Sono ammesse fino a 32 origini HTTPS/WSS esatte e canoniche: niente slash finale, percorsi, credenziali, wildcard, duplicati, indirizzi IP o nomi locali. Una porta diversa richiede una voce distinta. Gli aggiornamenti passano nuovamente dalla revisione; il rollback non puo ripristinare destinazioni non piu autorizzate.

La CSP viene generata dall'host per ogni WebView, inclusi i pannelli interattivi. CORS e certificati TLS restano applicati dal motore web: il server deve autorizzare l'origine effettiva dell'app. Gli errori seguono le API JavaScript standard; la console puo distinguere CSP, CORS e TLS. I redirect non autorizzano nuove origini.

Il permesso consente anche l'invio di dati: concederlo insieme a `files-read` permette all'app di trasmettere file leggibili dall'account alle destinazioni approvate. Questa e una lista di origini, **non un firewall IP**: un dominio approvato puo risolvere su un indirizzo privato; le ulteriori protezioni di rete locale dipendono dalla WebView. Non viene promesso isolamento dalla LAN basato sul solo nome di dominio.

Restano vietati script/import remoti, `eval`/`new Function`, worker, frame, form e caricamenti diretti di immagini/media remoti. Le librerie devono essere incluse nel pacchetto. Un'app puo leggere un'immagine come dati con `fetch` autorizzato e visualizzarla come `data:`. Il permesso di rete non aggiunge accesso a processi o scrittura filesystem: per scrivere file persistenti rimane necessario l'SDK, confinato alla cartella dell'app.

## Funzioni pubbliche e composizione

`actions` collega hotkey locali; **`exports`** pubblica funzioni invocabili dalle altre app. L'app sceglie titolo, descrizione, contratto e modalita; l'host autentica il chiamante, valida input/output e gestisce il ciclo di vita. Non c'e accesso diretto al codice o allo storage del destinatario.

Contratti standard incorporati nell'host:

| Contratto | Input | Output |
|---|---|---|
| `image.capture`, versione `1` | `{}` | `{ image: AttachmentRef }` |
| `image.receive`, versione `1` | `{ image: AttachmentRef, prompt?: string }` | `{ accepted: boolean }` |

`AttachmentRef` e `{ attachmentId: string }`, non un percorso o una data URL. Per offrire una funzione di ricezione immagini, aggiungere al manifest:

```json
{
  "permissions": ["app-actions"],
  "exports": [{
    "id": "receive-image",
    "title": "Apri una bozza",
    "description": "Prepara una nuova conversazione senza inviare all'AI.",
    "contract": "image.receive",
    "version": 1,
    "accepts": ["image/png"],
    "mode": "handoff",
    "invocationModes": ["interactive"],
    "interactiveEntry": "image.html"
  }]
}
```

Registrare esattamente gli ID esportati, una volta, dopo aver inizializzato la UI:

```js
const handledRequest = await Orbit.services.register({
  'receive-image': async (value, { signal, callerName, intent }) => {
    if (signal.aborted) throw new Error('Richiesta annullata.');
    await Orbit.attachments.retain(value.image);
    const image = await Orbit.attachments.read(value.image);
    showDraft(image.dataUrl, value.prompt ?? '', callerName);
    return { accepted: true };
  },
});
```

`showDraft` appartiene alla propria UI. Conservare anche il riferimento per rilasciarlo quando la bozza viene eliminata o inviata. `register` gestisce le chiamate arrivate durante l'avvio e restituisce se ne ha ricevute: usarlo per evitare un avvio automatico duplicato, come in `apps/capture/app.js`. I gestori ricevono input e `{ signal, callerName }`; possono restituire valori o Promise e lanciare errori. Le chiamate possono essere concorrenti: serializzare o rifiutare le operazioni incompatibili nella propria app.

Il chiamante dichiara le dipendenze nel manifest:

```json
{
  "permissions": ["app-actions"],
  "dependencies": [
    { "contract": "image.capture", "version": 1, "required": false }
  ]
}
```

```ts
import { services, attachments, type AttachmentRef } from '@orbit/sdk';

const choices = await services.list('image.capture');
// Se sono piu di una, mostrare un selettore; se nessuna, spiegare cosa manca.
const choice = await chooseProvider(choices);
const controller = new AbortController();
const { image } = await services.call<{ image: AttachmentRef }>({
  contract: 'image.capture',
  intent: 'service',
  input: {},
  provider: choice.appId,
  actionId: choice.feature.id,
  signal: controller.signal,
});
const capture = await attachments.read(image);
showImage(capture.dataUrl);
await attachments.release(image);
```

`chooseProvider` e `showImage` appartengono alla UI; collegare un pulsante Annulla a `controller.abort()`. `services.list(contract, version = 1, mime?)` restituisce `{ appId, appName, feature }[]`, inclusi titolo, descrizione e MIME accettati. Per **Invia a...**, usare `services.list('image.receive', 1, 'image/png')`. Il core non sceglie arbitrariamente tra piu funzioni: specificare `provider`/`actionId` quando la destinazione non e univoca.

**Tre contesti, senza apertura implicita dell'app:**

- `intent: 'service'`: risultato senza UI del provider, salvo passaggi indispensabili (selettore schermo). Ritorno al chiamante; salvataggi completati prima della risposta. Il provider freddo viene distrutto, quello gia aperto conserva la visibilita. Gli hook `beforeClose` non sono eseguiti durante questa distruzione.
- `intent: 'interactive'`: una nuova finestra per ogni invocazione, sulla `interactiveEntry` dichiarata, diversa dall'entry principale. Mostro la finestra quando registra la funzione richiesta, prima della risposta: il gestore puo attendere l'interazione dell'utente. Dopo la risposta, la conversazione continua indipendentemente dal chiamante; errore, annullamento o timeout prima della risposta la distruggono. × chiude solo questa sessione; Esc rispetta il suo pin. Non esiste promozione automatica alla UI completa.
- Launcher, tray e hotkey aprono esplicitamente l'app completa e le sue azioni.

Il manifest dichiara `invocationModes: ['service']`, `['interactive']` o entrambe. L'host rifiuta intenti non supportati. Senza `intent`, `mode: 'request'` (anche omesso) seleziona servizio; `mode: 'handoff'` seleziona interattivo, ma senza pagina e modalita dichiarate restituisce un errore di migrazione, mai la UI completa. In `image.html` registro solo la funzione richiesta; `Orbit.context()` espone `mode` e `invocation` con app, funzione e ID richiesta. Le vecchie registrazioni complete restano valide nella finestra principale.

Isolo origine web, allegati, richieste, AI, cattura, pin e chiusura per finestra. Le finestre di funzione possono leggere le preferenze ma non modificare preferenze, storage, file o timer dell'app, ne registrare azioni/hotkey. Gli allegati prestati scadono alla risposta salvo `retain`; chiudere la finestra libera i suoi grant. `attachments.save` resta riservato all'app. Aggiornamenti/rimozioni richiedono la chiusura di tutte le sue finestre. Non implemento “Apri nell'app”: nessuna perdita silenziosa di contesto.

**Dipendenze:** `required` e `false` se omesso; `provider` facoltativo vincola a un ID app. Servono per ogni contratto chiamato, anche opzionale. Una dipendenza obbligatoria senza provider pronto impedisce avvio e hotkey. Rimozione, disabilitazione, aggiornamento e rollback non possono rompere dipendenze obbligatorie gia soddisfatte: installare un'alternativa o disabilitare prima il consumatore. I provider nascosti nel menu restano disponibili; quelli disabilitati no. Le dipendenze cicliche senza alternativa valida e le chiamate ricorsive fra app vengono rifiutate.

### Contratti personalizzati

Le app possono definire contratti oltre a quelli standard. Chiamante e provider includono la stessa definizione in `contracts`; ID e versione uguali devono avere schemi identici in tutto il catalogo:

```json
{
  "contracts": [{
    "id": "example.text.count",
    "version": 1,
    "input": {
      "type": "object",
      "properties": { "text": { "type": "string", "maxLength": 20000 } },
      "required": ["text"]
    },
    "output": { "type": "number" }
  }]
}
```

Il provider aggiunge un export riferito a `example.text.count`; il chiamante una dipendenza. Usare ID con namespace, segmenti minuscoli separati da punti, e incrementare la versione per cambiare schema. Non ridefinire gli standard con significati diversi.

Gli schemi supportano `null`, `boolean`, `number` finiti, `string` con `maxLength` in byte UTF-8 (default 20000, massimo 100000), `array` con `items` e `maxItems` obbligatorio (massimo 100), `object` con `properties` e `required`, e `attachment`. Gli oggetti rifiutano chiavi sconosciute. Massimo 8 livelli, 32 proprieta per oggetto; nomi di campo alfanumerici ASCII con `_`/`-`, massimo 64 caratteri, esclusi `__proto__`, `constructor`, `prototype`. Massimo 16 contratti, 32 export e 32 dipendenze per manifest. Input/output serializzati hanno un limite di 1 MiB; il parametro generico TypeScript di `call<T>` non sostituisce la validazione Rust.

### Allegati, annullamento e limiti

L'app produttrice usa `attachments.create({ dataUrl, width, height })`; il risultato concede accesso conservato al produttore. I riferimenti presenti negli schemi di input danno al destinatario un accesso **in prestito**, valido fino alla conclusione della chiamata. `retain(ref)` lo conserva fino a `release(ref)` o chiusura della finestra. I riferimenti restituiti concedono accesso conservato al chiamante prima dell'eventuale chiusura del provider. `retain` e idempotente, non un contatore.

Il core elimina i byte quando non restano accessi. Non salvare riferimenti nello storage: scadono con la sessione. Chiudere il produttore non invalida gli accessi gia conservati dai destinatari. Un'app non puo leggere un riferimento semplicemente conoscendone l'ID.

Sono supportati solo PNG validi, fino a 1800 x 1800 pixel; `accepts` ammette `image/png` e `image/*` ed e obbligatorio per `image.receive`. Limiti condivisi: 32 allegati e 48 MiB di byte PNG; input base64 fino a 16 MiB. `attachments.save(ref)` salva senza dialogo in `files/screenshots/<id-univoco>.png` della sotto-app chiamante e restituisce `{ saved: true, path: "screenshots/..." }`. Gli errori di scrittura rifiutano la Promise. Non richiede il nuovo permesso `files-write`: il permesso esistente `file-save` resta limitato ai PNG di cui l'app possiede un riferimento.

Massimo 32 chiamate attive, risposta attesa fino a 180 secondi dopo l'avvio del provider. Annullamento, timeout e chiusura di una delle app terminano la chiamata e revocano i prestiti. Il gestore riceve l'annullamento tramite `signal`: interrompere le proprie operazioni, per esempio con `Orbit.capture.cancel()`. I permessi e gli effetti gia completati non vengono annullati retroattivamente.

## Tema condiviso

L'host imposta su `<html>` `data-theme="light|dark"` e `data-theme-mode="light|dark|system"`, aggiorna `color-scheme` e carica `/orbit-theme.css`. Questo percorso, come `/orbit-sdk.js`, e riservato: non inserirlo negli asset del pacchetto. In modalita `system` i cambiamenti del computer vengono ascoltati tramite `matchMedia`, senza polling.

Le app che caricano la UI condivisa `ui.js` ricevono anche lo stile chiaro per i controlli esistenti, incluse le versioni gia installate. Una UI personalizzata deve usare i token `--orbit-bg`, `--orbit-surface`, `--orbit-text`, `--orbit-muted`, `--orbit-border`, `--orbit-accent`, oppure definire i propri stili per `[data-theme=light]`; Orbit non inverte immagini, screenshot o colori arbitrari del pacchetto.

`Orbit.appearance.get()` restituisce la preferenza `light`, `dark` o `system`. `Orbit.appearance.onChange(handler)` restituisce una funzione di disiscrizione e notifica `{ mode, theme }`, con il tema effettivo `light|dark`. Per inizializzare un canvas si puo leggere `document.documentElement.dataset.theme` e poi ascoltare le variazioni. La sotto-app non puo cambiare il tema globale: la scelta e dell'utente nelle impostazioni dell'host.

## Preferenze e azioni nel menu dell'host

Il manifest puo aggiungere `icon`, `preferences` e `actions`. Orbit costruisce la pagina nella sidebar: non esegue codice della sotto-app dentro l'host e non apre la sua WebView per mostrare queste impostazioni.

**I default appartengono al pacchetto**, non a una tabella nell'host: `shortcut` definisce la hotkey di apertura, `actions[].shortcut` quelle delle funzioni e `preferences[].default` i valori iniziali delle preferenze. Sono effettivi subito dopo l'installazione. `null` significa nessuna hotkey proposta. Sugli aggiornamenti i valori non personalizzati seguono il manifest; gli override utente, incluse le hotkey esplicitamente cancellate, vengono conservati. Le nuove preferenze ricevono il loro default. Un conflitto disattiva la nuova assegnazione con un avviso, senza sottrarre la combinazione a un'altra app.

La tray usa nome, azioni e hotkey effettive dello stesso manifest e viene aggiornata dal runtime quando cambia il catalogo o un'assegnazione: il pacchetto non deve registrare un menu separato.

```json
{
  "icon": "note",
  "shortcut": "Ctrl+3",
  "preferences": [
    { "id": "spellcheck", "label": "Controllo ortografico", "type": "boolean", "default": true },
    { "id": "font-size", "label": "Dimensione testo", "type": "number", "default": 14, "min": 12, "max": 24 },
    { "id": "placeholder", "label": "Suggerimento", "type": "text", "default": "Scrivi qui..." },
    { "id": "mode", "label": "Modalita", "type": "select", "default": "compact",
      "options": [{ "value": "compact", "label": "Compatta" }, { "value": "full", "label": "Completa" }] }
  ],
  "actions": [
    { "id": "focus-editor", "label": "Scrivi un appunto", "description": "Posiziona il cursore nella nota.", "shortcut": "Ctrl+Shift+3" }
  ]
}
```

Questi campi si aggiungono al manifest completo, non lo sostituiscono. Massimo 32 preferenze e 32 azioni, ID univoci con la stessa sintassi dell'ID app; etichette fino a 80 caratteri e descrizioni facoltative fino a 400. Le icone disponibili sono `grid`, `scan`, `chat`, `note`, `clock`, `spark`, `terminal`, `image`; senza icona viene usata `grid`.

I campi `boolean`, `number`, `text`, `select` producono controlli standardizzati. I numeri possono essere decimali e devono rispettare `min`/`max`; i testi sono limitati a 2000 byte UTF-8; le selezioni hanno da 1 a 32 opzioni. Il valore predefinito deve rispettare lo schema. `preferences.read()` restituisce i valori salvati con i default per quelli mai configurati. `update()` valida e modifica soltanto le chiavi fornite; chiavi sconosciute e tipi/valori errati sono rifiutati in Rust.

```js
const applyPreferences = values => {
  editor.spellcheck = values.spellcheck;
  editor.style.fontSize = `${values['font-size']}px`;
};
const unsubscribe = Orbit.preferences.onChange(applyPreferences);
applyPreferences(await Orbit.preferences.read());
await Orbit.preferences.update({ spellcheck: false });
```

Le preferenze sono in `preferences.json`, separate da `storage.json`, senza bisogno del permesso `storage`. `onChange` restituisce una funzione di disiscrizione e riceve l'intero documento effettivo; non e una notifica iniziale, quindi leggere anche i valori all'avvio. Non usarle per segreti.

Ogni app ha sempre l'azione host **`open`** (apri/nascondi), configurata da `shortcut` e non registrabile in JavaScript. Le altre azioni si dichiarano nel manifest e si collegano una volta, dopo aver inizializzato l'app:

```js
await loadDocument();
const handledStartupAction = await Orbit.actions.register({
  'focus-editor': () => { editor.focus(); }
});
// Eseguire eventuali azioni automatiche di avvio solo se !handledStartupAction.
```

`register` richiede esattamente gli ID dichiarati e restituisce `true` se ha gestito richieste in attesa. La registrazione va attesa e gli errori mostrati. Le hotkey avviano la finestra se chiusa, attendono la registrazione e consegnano l'azione; a finestra aperta o nascosta la mostrano e inviano la funzione. L'SDK esegue i gestori in sequenza e segnala i fallimenti via `orbit:error`. Prima della registrazione il core conserva fino a 16 richieste; la chiusura della finestra cancella le richieste ancora in attesa. Non e un sistema di task senza WebView.

La sotto-app puo consultare le assegnazioni e controllare una proposta:

```js
const allBindings = await Orbit.shortcuts.list();
const conflicts = await Orbit.shortcuts.check('focus-editor', 'Ctrl+Shift+9');
```

Ogni voce contiene `{ appId, actionId, appName, label, shortcut, enabled, registered }`; `appId: null` identifica una hotkey riservata all'host. Un array vuoto da `check` significa nessun conflitto **interno a Orbit**, non garantisce disponibilita nel sistema. Il registro include app disabilitate; `registered` indica la registrazione nativa effettiva.

Solo la pagina attendibile dell'host modifica le assegnazioni e puo sostituire quelle di altre app, dopo la conferma dell'utente. L'SDK non puo appropriarsi silenziosamente delle loro hotkey. La sostituzione ricontrolla i proprietari al salvataggio e rifiuta conferme obsolete; la combinazione viene rimossa dai precedenti proprietari. Ctrl+E e le altre hotkey host non sono sostituibili. Un errore di registrazione nativa per un'app abilitata ripristina le assegnazioni precedenti.

Installazione, aggiornamento e rollback non assegnano nuove hotkey al posto di quelle gia dichiarate dalle altre app: le nuove combinazioni in conflitto vengono disattivate con un avviso. L'utente puo poi assegnarle o sostituirle dalla pagina dell'app.

Esempio di streaming:

```js
const image = await Orbit.capture.select();
const stream = Orbit.ai.chat([
  { role: 'user', content: 'Cosa vedi?', image: image.dataUrl },
], event => {
  if (event.kind === 'delta') appendText(event.text);
  if (event.kind === 'error') showError(event.text);
  if (event.kind === 'cancelled') showStatus('Interrotto');
});
stopButton.onclick = () => stream.cancel().catch(showError);
await stream.done;
```

`appendText`, `showError` e `showStatus` sono funzioni della propria UI. Nei pacchetti pilota l'invio avviene soltanto premendo **Invia**; rispettare questa separazione anche nelle nuove app. La selezione annullata rifiuta la Promise. Gli eventi AI sono `delta`, `done`, `cancelled`, `error`; l'evento terminale va gestito anche quando `done` si risolve. V1 ammette una sola richiesta AI attiva nell'intero host e rifiuta le concorrenti. Il chiamante fornisce la cronologia; l'SDK non conserva una chat.

## Ciclo di vita

La **× standard** e `window.hide()` conservano pagina e operazioni, anche con pin attivo. `window.dismiss()` ed Esc nella UI standard rispettano il pin, come la hotkey di apertura; le hotkey di azione continuano a eseguire le funzioni. Il pin dura quanto la finestra, anche dopo hide/show e reload. Fissare un provider temporaneo lo mantiene aperto dopo la risposta; le catture nascondono temporaneamente anche i pannelli fissati.

**Termina** nel catalogo e `window.close()` eseguono gli hook, distruggono la WebView e annullano gli stream dell'app anche con pin attivo. Se un hook fallisce, la finestra resta aperta e viene emesso `orbit:error`. La chiusura nativa della finestra la nasconde soltanto. Registrare, per esempio, `Orbit.lifecycle.beforeClose(() => pendingSave)` come in Appunti. Uscita da Orbit o terminazione forzata non garantiscono l'esecuzione degli hook: salvare durante l'uso.

I timer restano nel core a finestra chiusa; disabilitare l'app ne sospende l'esecuzione, riabilitarla ripristina le scadenze. A Orbit spento nessuna notifica puo essere emessa: i timer scaduti vengono completati al riavvio. Avviare un ID esistente sostituisce quel timer. Rimuovere l'app cancella tutti i timer, anche conservando lo storage.

Aggiornamenti e rollback preservano lo storage, **non ne fanno una migrazione automatica o un backup**. Le app devono versionare il proprio schema e mantenere compatibilita con i dati della versione precedente. Per modificare un pacchetto aperto bisogna prima chiuderlo dal catalogo o dalla sua UI.

Anche le assegnazioni delle azioni e le preferenze persistono. Le nuove preferenze ricevono i default; i valori salvati incompatibili con un nuovo schema producono un errore esplicito, risolvibile con **Ripristina predefinite** nella pagina host. Le chiavi rimosse non sono esposte dall'SDK e vengono eliminate al successivo salvataggio delle preferenze. Le hotkey di azioni rimosse rimangono memorizzate ma non sono registrate, per poterle recuperare con un rollback. Disinstallando con conservazione dati restano storage e preferenze, non le assegnazioni delle hotkey.

## Confini e prossime estensioni

L'identita del chiamante deriva dalla finestra nativa, non da un ID passato in JavaScript. Il broker verifica installazione, stato e permessi a ogni richiesta. Origini separate, CSP, ACL Tauri e controllo navigazione negano accesso diretto ai comandi host, altre app e rete generica. L'hash SHA-256 lega l'approvazione al contenuto installato: **non e una firma dell'editore**.

Questo non garantisce contenimento di consumo CPU/RAM o affidabilita di pacchetti ostili. Installare solo da fonti attendibili. Chi possiede `ai-chat` puo inviare contenuti al provider configurato; chi possiede `screen-capture` puo chiedere la selezione interattiva. V1 non offre filesystem generale, clipboard, rete arbitraria, comandi shell, plugin nativi o task OpenCode.

Nuovi servizi richiedono API tipizzate nell'SDK, permessi espliciti e validazione nel broker Rust, mantenendo lo stesso contratto su Windows/macOS. Marketplace remoto, firme, verifica editori e aggiornamenti automatici sono fasi successive, non funzionalita gia presenti.
