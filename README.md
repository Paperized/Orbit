# Orbit

Host overlay per Windows e macOS, con sotto-app installabili e SDK v1. `Ctrl+E` apre lo spazio generale; `Ctrl+1` apre **Screenshot**, la galleria delle catture salvate; `Ctrl+Shift+1` avvia una nuova cattura. **Chat** e un pacchetto separato. Le sotto-app possono essere anche semplici utility, senza AI.

## Avvio

Requisiti: Node.js 22.12+ o 24 LTS, Rust stable aggiornato, [prerequisiti Tauri](https://v2.tauri.app/start/prerequisites/) del sistema.

- **Windows:** toolchain Rust MSVC, Visual Studio Build Tools con sviluppo desktop C++, WebView2.
- **macOS:** Xcode Command Line Tools. Autorizzare l'app alla registrazione dello schermo in **Impostazioni di Sistema > Privacy e sicurezza**, poi riavviarla se richiesto.

```sh
npm ci
npm run desktop
```

L'app parte con la dashboard aperta e rimane nella tray/menu bar quando viene nascosta. Non richiede privilegi amministrativi, non e un servizio e non si avvia automaticamente con il sistema. `Esc` o la stessa hotkey nascondono lo strumento, tranne i pannelli fissati con il pin; durante una selezione la annullano. **Esci da Orbit** termina tutto l'host. Le scorciatoie usano Control anche su macOS, non Command. Le hotkey delle app si modificano nel catalogo; i conflitti vengono segnalati e le app restano apribili dalla dashboard.

Per esplorare solo l'interfaccia, anche su Linux:

```sh
npm run dev
# http://localhost:1420
```

La preview browser non cattura il desktop, non salva chiavi e non chiama provider. Permette di caricare un PNG/JPEG/WebP e provare selezione, anteprima e composizione della domanda. Le hotkey funzionano solo nella pagina.

### Demo Windows gia compilata

La consegna locale include `artifacts/Orbit-Windows-x64.zip`: estrarlo in una cartella Windows e avviare `orbit-overlay.exe`, lasciando `WebView2Loader.dll` accanto all'eseguibile. Le quattro app iniziali sono incorporate; `packages/` contiene anche i pacchetti importabili singolarmente. Serve il runtime WebView2, non servono Node, Rust o Visual Studio per usare questo pacchetto.

E una build **release x64 ottimizzata**, compilata da WSL; il runtime e stato provato su Windows con una build debug e configurazione isolata. Non e un installer e non e firmata. Gli artefatti sono esclusi dal controllo versione. Per sviluppare e per i pacchetti ufficiali Windows rimane consigliata la toolchain MSVC.

### Release Windows su richiesta

In GitHub apri **Actions > Windows release (manual) > Run workflow**, scegli il branch e conferma. Il workflow non parte con push, pull request o tag: compila Windows x64 con MSVC, esegue i controlli frontend e pubblica una **prerelease** con tag `windows-<numero run>.<tentativo>`.

In **Releases** trovi `Orbit-Windows-x64-setup.exe` e `SHA256SUMS.txt`. Il setup include l'app e installa WebView2 se necessario; non e firmato e Windows SmartScreen puo mostrare un avviso. Gli stessi file restano negli artifact del run per 30 giorni. Il workflow usa il `GITHUB_TOKEN` automatico: non servono token personali o certificati.

Il workflow **Desktop checks** resta separato: controlla Windows/macOS su push e pull request, ma non pubblica release.

## Funzioni della demo

| Strumento | Funzione |
|---|---|
| Il tuo spazio | Overlay leggero con dock app, ricerca di app/azioni, preferiti e widget |
| Screenshot | Galleria cronologica, cattura con salvataggio automatico, anteprima, eliminazione e Invia a... |
| Chat | App indipendente: conversazioni testuali/multimodali, streaming e cattura tramite un'altra app |
| Appunti al volo | Nota locale con salvataggio automatico |
| Timer | Timer locali con notifica, attivi anche chiudendo la sotto-app |
| App e catalogo | Griglia ricercabile, azioni a icona, installazione manuale dal menu, aggiornamento, rollback e rimozione |
| Menu di ogni app nelle impostazioni | Preferenze e hotkey delle singole funzioni, senza aprire la sotto-app |
| Impostazioni | Area di gestione dall'ingranaggio in alto a destra: catalogo, preferenze delle app, temi, provider AI e backend agent |

**Ctrl+E apre lo spazio overlay**, non l'area di gestione. Il dock in basso apre le app con un clic: non serve assegnare una hotkey. **App e azioni** mostra le aperture e tutte le azioni dichiarate nei manifest; la ricerca filtra nome dell'app, funzione e descrizione. La **stellina** aggiunge o rimuove un collegamento nel widget Preferiti, senza eseguire l'azione. App disabilitate o con dipendenze mancanti restano riconoscibili ma non avviabili. Le app nascoste non compaiono nel dock, ma si possono trovare con la ricerca e aggiungere ai preferiti.

L'ora corrente compare accanto al nome **Orbit** in alto a sinistra, senza un widget dedicato. Dal pulsante **Widget (+)** si mostra o nasconde **Preferiti** e si aggiungono i widget esposti dalle app abilitate, anche nascoste dal menu. La visibilita dei Preferiti viene salvata; nasconderli conserva stelle, posizione e dimensioni. Il widget Modello AI e stato rimosso: il provider resta configurabile nelle impostazioni. **Screenshot > Ultimi screenshot** parte da una griglia 2 x 2, senza pulsanti di azione: clic su un'immagine per aprire l'originale ingrandito, Esc o X per chiuderlo. I **tre puntini** aprono le impostazioni anche senza modificare il layout: righe e colonne da 1 a 6, ripristino dei valori dell'app e rimozione dalla home. Ogni istanza ricorda le proprie impostazioni; le immagini si adattano allo spazio senza ritagli. Il widget e l'anteprima non aprono la sotto-app.

### Hub e overlay persistenti

La barra degli spazi distingue **Hub**, temporaneo e aperto con Ctrl+E, dai **preset persistenti**. Il **+** accanto agli spazi crea un preset vuoto; puoi aggiungere componenti dal selettore Widget oppure copiare il layout dell'hub senza modificarlo. Ogni preset ha nome, componenti, geometrie, griglia, preferiti e impostazioni widget indipendenti. Le schede, **Alt+freccia sinistra/destra** e lo swipe orizzontale sulle zone libere cambiano spazio. Le pagine dei preset restano in modifica.

**APPLY** seleziona l'unico preset attivo, sostituendo quello precedente. Chiudendo l'hub compaiono i suoi componenti, sempre in primo piano. Riaprendo Orbit vengono nascosti durante la modifica; alla chiusura si vedono gli ultimi cambiamenti salvati. **HIDE** disattiva il preset senza cancellarlo. La rimozione richiede conferma e non elimina dati delle app. Dopo il riavvio tutti i preset sono ancora disponibili, ma nessuno viene riattivato automaticamente: serve APPLY.

Il pulsante con il puntatore sulla maniglia di ogni componente alterna **interattivo** e **clic passanti**. Ogni componente usa una finestra nativa distinta: lo spazio tra i widget non intercetta input; quelli con clic passanti non ricevono mouse/touch e si modificano tornando nell'hub. Le anteprime screenshot interattive aprono una finestra separata, non un'immagine ritagliata dentro il widget. La ricerca persistente apre la ricerca dell'hub. Le finestre delle sotto-app pinnate restano indipendenti dai preset e il loro pin rimane temporaneo.

Le definizioni si salvano in `host/presets.json` (versione 1, massimo 12 preset, ciascuno con 16 widget di app e 4 componenti incorporati); l'attivazione resta solo in RAM. Il monitor viene ricordato alla creazione. Alla visualizzazione, in assenza del monitor originario viene usato quello principale, adattando i rettangoli senza sovrascrivere le geometrie salvate. Durante le catture i componenti persistenti sono nascosti. Nella preview web si provano editor e salvataggi, ma le finestre sempre in primo piano richiedono la versione desktop.

`npm run test:windows:presets` usa CDP su `127.0.0.1:19329` per verificare finestre native, DPI, click-through, isolamento dei comandi, anteprima originale e sospensione/ripristino durante la cattura. Richiede la sotto-app Screenshot abilitata, almeno un'immagine esistente e due slot preset liberi. Ripristina le definizioni originali e non modifica il layout dell'hub; eseguirlo su una build di verifica, non durante una sessione di lavoro.

Il nuovo spazio usa superfici carbone/menta, una navigazione compatta e una barra di comandi separata dal contenuto dell'editor. Restano disponibili tema chiaro, focus da tastiera e movimento ridotto; le geometrie gia personalizzate dell'hub non vengono riposizionate dal redesign.

I risultati della ricerca seguono la posizione e la larghezza effettive della barra, anche durante spostamento e resize. Si aprono sotto, oppure sopra quando manca spazio in basso; con una barra molto stretta mantengono una larghezza leggibile entro lo schermo.

Con **Ctrl+E** la ricerca riceve il focus. Anche digitando dalla superficie della home, il testo va nella ricerca: campi di input, dialoghi, composizione IME e scorciatoie restano esclusi.

Aprendo le impostazioni da una vista gia visibile, **Esc** o la **X** tornano alla vista precedente senza nascondere l'overlay. Vale anche per le impostazioni delle sotto-app. Dalla home, un ulteriore Esc nasconde Orbit; le hotkey e il comando esplicito di nascondere l'overlay mantengono il loro comportamento.

Su Windows, chiudere Orbit restituisce il focus alla finestra precedente solo se l'overlay e ancora attivo. Se nel frattempo si cambia app con **Alt+Tab**, **Ctrl+E** nasconde l'overlay senza annullare il cambio di app.

Anche **Avvio rapido**, la barra delle app, si attiva e disattiva da **Widget (+)** conservando posizione e dimensioni. Usa un solo pannello, senza riquadro interno o testo informativo. Il layout predefinito e piu compatto; le geometrie gia personalizzate restano invariate.

I **tre puntini** di Avvio rapido aprono la lista delle app: togliere la spunta e salvare nasconde l'app solo dalla barra, senza disinstallarla o modificarne hotkey, preferiti e visibilita nel catalogo. Le nuove app sono incluse automaticamente; **Mostra tutte** azzera le esclusioni. Le app disabilitate o nascoste nel catalogo restano indisponibili nella barra finche non vengono riabilitate o rese visibili.
La checkbox di un'app disabilitata non e modificabile, nemmeno tramite **Mostra tutte**: conserva la scelta precedente e torna selezionabile quando l'app viene riabilitata.
Nella home **Tab / Maiusc+Tab** passano al widget successivo / precedente, senza attraversare ogni pulsante. Le **frecce** selezionano i controlli interni; nelle immagini sinistra/destra scorrono ciclicamente e su/giu seguono le colonne della griglia. **Invio** apre l'immagine selezionata, **Esc** chiude l'anteprima e restituisce il focus. Tornando a un widget si ritrova l'ultimo controllo selezionato. Alla fine dei widget il percorso include i comandi della home, che restano accessibili da tastiera. Nei dialoghi e in modifica layout rimane la navigazione standard; le frecce nei campi di testo continuano a spostare il cursore.

In **Impostazioni > Generali > Lingua** si sceglie italiano o inglese (italiano predefinito). La scelta persiste in `host/language.json` ed e notificata anche alle sotto-app gia aperte, comprese le funzioni interattive. Il supporto iniziale localizza i comandi principali della home e i controlli delle app incluse; testi avanzati, metadati dei pacchetti ed errori di origine conservano la propria lingua. Ogni app puo fornire ulteriori traduzioni con `Orbit.locale.get()` e `Orbit.locale.onChange()`: Orbit non traduce note, conversazioni o altri contenuti dell'utente.

L'interfaccia mantiene l'overlay compatto: colori semantici condivisi con le sotto-app in `shared/app-theme.css`, controlli e focus coerenti, tema chiaro/scuro e toolbar adattabili alle finestre strette. Le indicazioni delle skill locali `ui-styling` e `design-system` sono applicate senza migrare Svelte a React/shadcn o introdurre Tailwind. Le impostazioni widget usano un dialogo con focus confinato, Esc per annullare e ritorno al pulsante di apertura.

L'icona **Modifica layout**, sotto **Nascondi / Esc**, rende spostabili e ridimensionabili logo/orologio, ricerca, Preferiti, dock e widget. Diventa una **spunta** per terminare la modifica. Solo in modifica compare lo slider **Dimensione griglia**: tutto a sinistra, **0 / Libero**, disattiva l'aggancio; verso destra le celle diventano piu grandi (fino a 200 px, mantenendo eventuali valori precedenti superiori). La scelta viene ricordata. Trascina la maniglia **⠿** o uno degli otto lati/angoli; frecce sulla maniglia spostano, **Maiusc+frecce** ridimensiona. Le linee compaiono solo durante spostamento/resize con griglia attiva. Minimo tecnico: 1 px, oppure una cella con griglia. **Esc** o annullamento del puntatore ripristinano il rettangolo iniziale senza salvare. L'icona **+** aggiunge widget; l'icona di recupero, disponibile in modifica, contiene le geometrie numeriche e il ripristino.

L'area del layout copre tutto lo schermo, fino al bordo superiore: nessuna fascia e riservata alla barra. Impostazioni e Nascondi restano sovrapposti e accessibili anche quando un widget si trova sotto di essi.

**Elementi / recupero** resta accessibile anche con elementi di 1 px: seleziona un elemento, modifica X/Y/larghezza/altezza, recuperalo o ripristina tutte le geometrie. Impostazioni e chiusura restano fisse. La **×** rimuove solo il widget: non disinstalla l'app e non elimina immagini. Una istanza per dichiarazione, massimo 16. Preferiti, AI, identita, rettangoli in pixel logici e preferenze layout si salvano in `Documents/Orbit/host/home.json` (versione 3); v1/v2 migrano conservando contenuti e posizioni relative della vecchia griglia. Su monitor piu piccoli i rettangoli vengono adattati solo a video: la configurazione originale resta intatta fino a una modifica intenzionale. I salvataggi sono serializzati; gli errori vengono segnalati e lasciano valida l'ultima configurazione salvata. App disabilitate o rimosse lasciano un segnaposto recuperabile/rimovibile.

Le anteprime si aggiornano tornando alla home e ogni 10 secondi mentre il widget e visibile. Le immagini eliminate scompaiono al successivo aggiornamento. I widget sono dichiarativi: l'host rende contenuti validati, non HTML/JS delle app. Il primo handler disponibile e `recent-images`, per PNG nella cartella dell'app; non e un sistema di widget HTML arbitrari. **Esc** chiude prima la ricerca o il selettore widget, poi l'overlay. L'ingranaggio apre la gestione; **Torna allo spazio** riporta all'overlay.

Nella ricerca, **freccia giu** entra nei risultati; **su/giu** scorrono le voci disponibili e **Invio** avvia quella selezionata. Le voci disabilitate vengono saltate. Freccia su dal primo risultato torna al campo di ricerca; freccia giu dall'ultimo resta sull'ultimo. **Tab** permette di raggiungere anche le stelline.

La cattura congela lo schermo **prima** di mostrare la selezione. Il ritaglio e il ridimensionamento (lato massimo 1800 px, senza ingrandimento) avvengono localmente. Solo premendo **Invia** il ritaglio raggiunge il provider. Le domande successive mantengono il contesto dell'immagine.

Rilasciare il mouse conferma il ritaglio e il salvataggio automatico, senza una seconda conferma: Screenshot mostra l'anteprima oppure restituisce l'immagine all'app che l'ha richiesta. Un semplice clic o una selezione inferiore a 8 px per lato non confermano. La barra inferiore mantiene **Seleziona tutto** e **Annulla cattura**. **Invia a...** elenca le funzioni compatibili con nome, descrizione e app; Chat riceve una bozza, senza inviarla automaticamente all'AI.

Dashboard, impostazioni e selezione dello screenshot occupano il monitor e bloccano l'interazione sottostante. Le sotto-app usano **finestre native sempre in primo piano**, senza oscurare lo schermo: Screenshot ha una galleria ampia, Chat e le altre utility restano compatte.

I pannelli usano inizialmente le dimensioni del manifest (in assenza: 440 × 520 px logici), con minimo tecnico 1 × 1, senza soglie basate sul contenuto. Posizioni e dimensioni persistono in `host/windows.json` anche dopo **Termina** e riavvio del processo. Ogni app e ogni funzione interattiva ha una geometria distinta; istanze concorrenti della stessa funzione condividono l'ultima geometria effettivamente modificata, non l'ultima finestra chiusa. I servizi nascosti non scrivono geometrie. Il ripristino usa area di lavoro e DPI del monitor, rendendo raggiungibile la finestra se il monitor e scollegato. **Impostazioni dell'app > Recupera finestre** ripristina geometrie senza eliminare contenuti. La selezione screenshot e l'overlay restano a schermo intero, separati dalle geometrie dei pannelli. Il **pin** mantiene la finestra aperta con Esc/hotkey; la × nasconde comunque il pannello. Il pin non persiste alla terminazione. Durante una cattura i pannelli vengono temporaneamente nascosti e poi ripristinati.

Fuori dal pannello si puo cliccare e scrivere nelle altre app: **non esiste una finestra trasparente a tutto schermo**. Dentro il pannello, clic, trascinamenti e tastiera appartengono a Orbit e non vengono inoltrati sotto. Non abilitiamo il click-through sulla finestra; quando si torna al gioco il pannello resta visibile ma la chat non mantiene il focus.

Host e sotto-app non mostrano il menu contestuale del browser e hanno gli strumenti di sviluppo disabilitati, anche nelle build debug. Restano disponibili i menu personalizzati di Orbit e le scorciatoie di modifica come copia/incolla.

### Provider AI

In **Impostazioni > Provider AI**:

- **OpenAI:** API key e ID modello; protocollo Chat Completions.
- **Compatibile OpenAI:** Base URL, ID modello e chiave facoltativa per server senza autenticazione. Implementazione Chat Completions, non Responses.
- **Claude:** Anthropic API key e ID modello; protocollo Messages.

Usare un modello vision per le catture. L'inserimento del modello e manuale; nessuna lista statica destinata a diventare obsoleta. **Salva e verifica** invia un breve messaggio di testo, puo consumare credito e non certifica il supporto immagini. Gli abbonamenti ChatGPT/Claude non sostituiscono necessariamente l'accesso alle API.

Le chiavi sono nel Credential Manager di Windows/Keychain di macOS, distinte per provider e endpoint. Non sono salvate in JSON, localStorage o log. Un nuovo endpoint non eredita la chiave del precedente. Sono accettati HTTPS e HTTP solo su loopback; i redirect HTTP sono disabilitati per non inoltrare credenziali ad altri endpoint.

### Backend agent

La demo salva la scelta **OpenCode**, il percorso dell'eseguibile e verifica `opencode --version`. L'utente installa e configura OpenCode separatamente. **Non sono ancora presenti sotto-app agentiche o esecuzione di task OpenCode**; non avviamo server inutilizzati e non leggiamo/modifichiamo le sue credenziali. Il campo eseguibile accetta un programma attendibile, senza argomenti; su macOS puo servire il percorso assoluto.

### Dati e risorse

- **Impostazioni > Generali > Aspetto:** tema Chiaro, Scuro o Automatico (predefinito). La scelta si salva subito in `appearance.json`, separatamente dal provider AI; Automatico segue i cambiamenti del tema del computer senza riavvio. Host e sotto-app aperte o nascoste si aggiornano insieme. La preview browser conserva solo questa preferenza in localStorage.
- Una WebView per l'host, piu una per ciascuna sotto-app aperta, anche se nascosta. Nessuna WebView per le app soltanto installate; nessun server Node nel pacchetto desktop.
- Nessuna cattura periodica, polling dello schermo, modello locale o animazione continua.
- Nascondere una finestra con × conserva chat e streaming. **Termina** nel catalogo annulla le sue richieste AI e libera la WebView; Chat conserva fino a 20 conversazioni con circa 50 turni ciascuna, solo nella sessione della sua finestra.
- Appunti usa storage JSON separato per ID app (quota 1 MiB), con salvataggio automatico e attesa dei salvataggi prima della chiusura. Le note della vecchia demo in localStorage non vengono migrate o cancellate.
- I timer sono gestiti da Rust, non dalla pagina: continuano a finestra chiusa. Non possono notificare mentre Orbit e spento; vengono ripristinati al riavvio, completando anche quelli scaduti. Le notifiche dipendono dalle impostazioni del sistema.
- Dati gestiti da Orbit nella cartella **Documenti/Orbit**, risolta tramite il sistema (anche con Documenti reindirizzati a OneDrive). Il percorso effettivo e visibile in **Impostazioni > Generali**. Chiavi nel portachiavi, mai consegnate alle sotto-app.
- Nessun dato viene inviato all'AI in automatico. Dopo l'invio valgono anche le politiche di conservazione del provider.

## Catalogo e sotto-app

**Screenshot 3.4.0**, **Chat 1.4.0**, **Appunti 1.4.0** e **Timer 1.4.0** sono pacchetti HTML/JS/CSS indipendenti, installati al primo avvio del runtime. Disinstallarli non li fa ricomparire al riavvio: si possono ripristinare singolarmente dal catalogo. “Chiedi all'AI” apre una conversazione dedicata all'immagine, senza aprire o modificare la Chat completa; le richieste di cattura restano servizi nascosti con salvataggio automatico.

Verifico la separazione con `scripts/windows-features.cjs` e le sei condizioni di visibilita del servizio con `scripts/windows-service-visibility.cjs`, sull'identificatore isolato `dev.orbit.runtime-test`. La suite Windows usa `%LOCALAPPDATA%\Orbit-interop-test`, mai l'installazione utente.

**Installazioni esistenti:** aggiornare Cattura a Screenshot dall'icona nel catalogo e installare Chat da **Installa**, se assente. Il nuovo host non sostituisce silenziosamente pacchetti o permessi gia approvati. Dati e preferenze rimangono associati al rispettivo ID app; le conversazioni in memoria non vengono migrate.

**App e catalogo** mostra le app in una griglia, con ricerca e filtro per stato. Le icone permettono di aprire la finestra, entrare nelle impostazioni, disabilitare, chiudere, aggiornare le app incluse, fare rollback o disinstallare; ogni icona ha etichetta accessibile e tooltip.

L'importazione locale e in **Installa > Installazione manuale**: scegliere un file `.orbit`, controllare identita/versione/permessi e confermare. Il menu propone anche le app iniziali mancanti o le loro versioni aggiornate. Non serve ricompilare o riavviare Orbit. Gli aggiornamenti mantengono i dati e richiedono una nuova revisione; usare **Termina** (icona quadrata nel catalogo) prima di aggiornare, disabilitare, ripristinare o rimuovere una sotto-app. La × del pannello la nasconde soltanto.

Le app abilitate hanno una voce in **Le tue app** nella sidebar. **Tasto destro > Nascondi** sposta la voce nella sezione richiudibile **App nascoste**; **Mostra nel menu** la ripristina. La scelta persiste: non disabilita app, hotkey o funzioni pubbliche e non nasconde la finestra. Le disabilitate restano solo nel catalogo, configurabili dall'icona impostazioni. Le impostazioni aprono una pagina dell'host, **non avviano la sotto-app**: preferenze, hotkey, funzioni pubbliche e dipendenze disponibili. Le preferenze si salvano separatamente dai contenuti e aggiornano le finestre aperte.

Le app pilota espongono, per esempio, nuova cattura/nuova chat, focus dell'editor e avvio di un timer rapido. Gli aggiornamenti non sostituiscono automaticamente le versioni gia installate: usare l'icona nel catalogo, mantenendo note e dati.

Ogni sotto-app dichiara nel proprio manifest i default di hotkey e preferenze: l'host li applica all'installazione, senza assegnazioni speciali per ID app. Le app incluse forniscono:

| App | Apri/nascondi | Funzioni |
|---|---|---|
| Screenshot | Ctrl+1 | Ctrl+Shift+1: nuovo screenshot |
| Chat | Ctrl+2 | Ctrl+Shift+2: nuova chat; Ctrl+Alt+1: allega cattura |
| Appunti | Ctrl+3 | Ctrl+Shift+3: scrivi un appunto |
| Timer | Ctrl+4 | Ctrl+Shift+4: timer rapido; Ctrl+Alt+4: personalizza timer |

Aggiornando il pacchetto, i nuovi default valgono per i campi non personalizzati; hotkey modificate o esplicitamente svuotate e preferenze salvate restano invariate. I conflitti non sovrascrivono altre assegnazioni e vengono segnalati.

Il menu della tray viene ricostruito dal catalogo: mostra ogni app abilitata con apertura, funzioni e hotkey effettive. Installazione, aggiornamento, rollback, rimozione, abilitazione e cambio delle hotkey aggiornano subito le voci, senza riavviare Orbit. Le app con dipendenze obbligatorie mancanti sono non selezionabili; nascondere una voce nella sidebar non la rimuove dalla tray.

### App che collaborano

Ogni app dichiara le proprie funzioni pubbliche e dipendenze. L'host valida contratti versionati standard o personalizzati, avvia il destinatario e restituisce risultato o errore al chiamante. **Chat > Allega cattura** usa `image.capture@1`: Screenshot seleziona l'area, la salva e restituisce l'immagine, poi la finestra aperta per la richiesta viene chiusa. **Screenshot > Invia a > Chat** usa `image.receive@1`: Chat resta aperta con la bozza. Nessuna app deve reimplementare l'altra.

Una richiesta on demand non apre la galleria Screenshot: compare soltanto il selettore e poi si torna a Chat con l'allegato. Se il pannello Screenshot era nascosto resta nascosto; se era gia visibile viene ripristinato dopo la selezione.

Gli allegati passano tramite riferimenti temporanei con accessi controllati, non percorsi del filesystem. Chiusura, annullamento e timeout terminano le richieste. Le dipendenze obbligatorie mancanti impediscono l'avvio; Orbit blocca rimozione, disabilitazione o aggiornamento dell'ultimo provider necessario a un'app abilitata. Installare un'alternativa compatibile oppure disabilitare prima le app dipendenti. Le dipendenze opzionali rendono indisponibile soltanto la relativa funzione: Chat resta utilizzabile senza Cattura.

Prima di assegnare una hotkey, Orbit controlla le altre funzioni e app, comprese quelle disabilitate. La UI indica i proprietari e richiede conferma per sostituirli; le hotkey host come **Ctrl+E non sono sostituibili**. Una combinazione non registrabile nel sistema su un'app abilitata fa ripristinare le assegnazioni precedenti. Per un'app disabilitata il controllo del sistema avviene alla riabilitazione: eventuali errori sono segnalati. Le hotkey di funzione eseguono l'azione, anche avviando la finestra se chiusa; non hanno la semantica mostra/nascondi della hotkey di apertura.

Per scegliere una hotkey, cliccare il campo e **premere i tasti**, per esempio Ctrl+2, poi confermare con la spunta. Non occorre scrivere il nome della combinazione. **Esc** annulla la selezione; la **×** rimuove e salva subito l'assegnazione vuota. Durante la registrazione le hotkey globali di Orbit sono sospese, incluse quelle gia assegnate: non aprono sotto-app e non intercettano i tasti. Vengono ripristinate all'uscita dal campo, al cambio finestra o al ricaricamento dell'host. Le scorciatoie riservate dal sistema o da altre applicazioni non possono essere sospese da Orbit.

Le versioni sono immutabili; il rollback torna alla precedente senza ripristinare i dati. Se richiede permessi non piu concessi, occorre reinstallarla con revisione. Disinstallando si sceglie se conservare lo storage; i timer vengono sempre rimossi. Non sono previsti aggiornamenti automatici.

Ogni pacchetto ha origine web e storage separati, con accesso ai servizi nativi attraverso il broker Rust. Le app non ricevono le credenziali, non possono chiamare i comandi dell'host o navigare liberamente in rete. **Non e ancora un marketplace pubblico:** niente firme, identita verificata degli editori o contenimento garantito di CPU/RAM per codice ostile. Installare soltanto pacchetti attendibili.

Per creare una nuova app: [SDK v1 e formato pacchetti](sdk/README.md). Non occorre aggiungerla al registro Svelte o modificare Rust se usa i servizi gia disponibili. La consegna locale include `artifacts/orbit-sdk-1.9.0.tgz`, installabile con `npm install <percorso-del-file>`, con build JavaScript e dichiarazioni TypeScript. I pacchetti pilota gia installati ricevono temi e nuovi controlli ×/pin dall'host, senza aggiornamento dei loro file; le app con UI personalizzata possono usare le API dell'SDK.

### Cartella dati e file delle app

Le sotto-app possono usare `fetch` e WebSocket JavaScript standard dichiarando `network.connect` nel manifest, con origini HTTPS/WSS esatte approvate all'installazione. Nessun wrapper HTTP: CORS e TLS sono gestiti dalla WebView. Senza dichiarazione la rete esterna resta bloccata; codice remoto, processi e scritture fuori dalla propria cartella non vengono abilitati. Il catalogo espone le destinazioni e avvisa che l'app puo inviarvi dati. La lista limita le origini, non gli IP risolti dal DNS: dettagli ed esempio nel [SDK](sdk/README.md#rete-javascript-senza-wrapper).

```text
Documenti/Orbit/
  host/                         impostazioni, tema e home
  apps/index.json               catalogo e assegnazioni
  apps/packages/<id>/<version>  pacchetti installati
  apps/data/<id>/                storage JSON, preferenze e timer
  apps/data/<id>/files/          file generati dalla sotto-app
  runtime/webview/              profilo e cache WebView su Windows/Linux
```

Al primo avvio i dati delle precedenti directory Tauri vengono copiati prima di aprire le WebView; gli originali restano come backup e non vengono piu aggiornati. La migrazione non sovrascrive una cartella dati gia inizializzata. Se non riesce, l'avvio fallisce esplicitamente invece di partire con dati vuoti. Tenere chiusa la vecchia versione durante il passaggio; non eseguire versioni precedenti dopo la migrazione.

`files-read` autorizza lettura ed elenco di file anche **fuori da Orbit**, inclusi dati delle altre app leggibili dall'account: concederlo solo a pacchetti attendibili. `files-write` permette scrittura/eliminazione soltanto dentro `apps/data/<id>/files`. Il broker ricava l'ID dalla WebView, rifiuta percorsi assoluti, traversal, symlink/junction in scrittura e non espone comandi shell o Node. I file non sono cifrati; questa separazione non e una sandbox contro altri processi locali dello stesso account o amministratori.

**Screenshot 3.0** sostituisce Cattura mantenendo l'ID `orbit-capture`, le hotkey e i dati. Si apre su una galleria ampia e ridimensionabile (1180 × 800, adattata al monitor), ordinata per ultima modifica dal piu recente; le anteprime sono paginate, 24 per pagina. **Nuovo screenshot** salva automaticamente in `apps/data/orbit-capture/files/screenshots`, senza scelta del percorso. Anche le catture richieste da Chat vengono salvate. Seleziona una miniatura per l'anteprima e **Invia a...**; **Elimina** richiede conferma e cancella il file, **Aggiorna** rilegge la cartella. Il default di prima installazione apre la galleria; un'eventuale preferenza preesistente di cattura al primo avvio viene conservata. L'aggiornamento del pacchetto richiede l'approvazione dei nuovi permessi file nel catalogo.

Cache/diagnostica gestite dal sistema operativo e portachiavi sono eccezioni alla radice unica; su macOS WKWebView non consente di scegliere la cartella del profilo, mentre i dati gestiti dal nostro codice restano in Documenti/Orbit.

## Struttura

```text
shared/tools.json          strumenti interni e navigazione host
apps/                     sorgenti dei quattro pacchetti pilota e UI condivisa
sdk/src/index.ts           SDK framework-neutral, IIFE e modulo ES tipizzato
scripts/pack-apps.mjs      generazione dei pacchetti .orbit
src/App.svelte             host overlay e navigazione
src/tools/                 viste dei singoli strumenti
src/lib/registry.ts        associazione manifest/componenti
src/lib/bridge.ts          comandi IPC e confine desktop/browser
src/lib/state.ts           conversazioni e ciclo di vita dello streaming
src-tauri/src/overlay.rs   hotkey, monitor, show/hide
src-tauri/src/apps.rs      finestre app, protocollo asset, broker SDK e timer
src-tauri/src/packages.rs manifest, installazione, permessi e storage
src-tauri/src/contracts.rs schemi, funzioni pubbliche e dipendenze
src-tauri/src/interop.rs    chiamate asincrone e accesso agli allegati
src-tauri/src/capture.rs   screenshot, ritaglio e codifica
src-tauri/src/ai.rs        HTTP, SSE, timeout e annullamento
src-tauri/src/protocol.rs  adattatori OpenAI/Anthropic e validazione
src-tauri/src/settings.rs configurazione e portachiavi
src-tauri/src/platform.rs integrazioni native
src-tauri/src/presentation.rs geometria e modalita delle finestre
```

Per questa demo usiamo `reqwest` con due piccoli adattatori di protocollo, senza introdurre un framework agentico come Rig. Questo mantiene espliciti payload immagini, gestione dello stream e compatibilita degli endpoint.

## Verifica e build

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Pacchetti da generare **sul sistema corrispondente**:

```sh
# Windows
npm run desktop:build -- --bundles nsis
# macOS
npm run desktop:build -- --bundles app,dmg
```

La CI e configurata per eseguire controlli e build native su Windows/macOS; non e ancora stata eseguita in remoto. Firma Windows, Developer ID e notarizzazione macOS richiedono i certificati del distributore e non sono configurati nella demo. La trasparenza Tauri su macOS richiede inoltre una valutazione separata prima di distribuire sul Mac App Store.

La build desktop produce soltanto una libreria Rust interna e l'eseguibile, senza librerie condivise mobile inutilizzate. Il manifest Windows Common Controls v6 viene incluso anche negli eseguibili dei test: e necessario per caricare correttamente i controlli nativi.

### Verifiche eseguite

| Ambiente | Esito |
|---|---|
| Frontend in WSL | Check Svelte/TypeScript senza warning, 56 test unitari e 27 scenari browser, build SDK con dichiarazioni TypeScript |
| Rust in WSL e Windows | 56 test Linux e 54 Windows superati; formattazione e Clippy con warning trattati come errori |
| Runtime in WebView2 Windows | Quattro pacchetti, storage persistente e separato, importazione/rimozione dal catalogo, revisione permessi, hotkey configurabili, aggiornamento e rollback |
| Servizi SDK su Windows | Diniego comandi host e servizi non concessi, blocco rete/cross-app, timer a WebView chiusa, cattura e streaming AI con contesto immagine |
| Impostazioni app su Windows | Pagina host senza apertura app, preferenze applicate dal vivo, conflitti e sostituzione con conferma, hotkey globale reale e azioni a finestra chiusa/aperta |
| Registrazione hotkey su Windows | Input reale di una combinazione gia assegnata senza avviare l'app, selezione Ctrl+2, rimozione persistente con ×, ripristino delle hotkey al cambio focus e al ricaricamento dell'host |
| Controlli pannello su Windows | × conserva finestra e bozza Chat; pin blocca Esc e hotkey reale, sopravvive a hide/show e reload, si azzera dopo Termina; ripristino dopo cattura e conservazione di un provider temporaneo fissato |
| Home overlay su Windows | App e azioni avviate con clic senza hotkey; preferiti e widget conservati al reload; accesso alle impostazioni e ritorno allo spazio |
| Geometrie su Windows | Drag/resize e griglia del canvas, recupero elementi minuscoli, migrazione v1/v2; finestre app e funzioni interattive conservate dopo distruzione e riavvio del processo a DPI 150%; servizi nascosti separati |
| Default e tray su Windows | Default di tutti i manifest applicati all'installazione; menu nativo letto via Win32 e aggiornato dopo cambio hotkey, aggiornamento, rollback, disabilitazione e reinstallazione; apertura di un'app dal comando tray |
| Temi | Chiaro/Scuro/Automatico, scelta persistente e sincronizzazione host/sotto-app; cambiamenti della preferenza del sistema simulati nelle WebView senza modificare le impostazioni del PC |
| Composizione su Windows | Contratti custom, valori restituiti concorrenti, validazione input/output, dipendenze obbligatorie, provider nascosti, bozza Chat senza invio automatico, annullamento e chiusura delle finestre temporanee |
| Allegati su Windows | Isolamento e conservazione dei riferimenti, salvataggio nella cartella della sotto-app e corrispondenza esatta dei byte PNG salvati |
| Demo precedente su Windows | Hotkey globali, input nativo dentro/fuori pannello, drag e resize verificati contro una finestra sottostante controllata |

La prova del runtime Windows usa un server HTTP locale e un identificatore di test separato: nessuna cattura viene inviata fuori dal dispositivo, nessuna impostazione dell'installazione utente viene modificata. Restano da verificare provider reali con le proprie credenziali, giochi borderless, focus in gioco, scaling misto, consumi release e macOS.

### Passaggio da WSL a Windows

I processi Linux di WSL non equivalgono all'app Windows, anche quando la finestra appare tramite WSLg. I test browser e Rust eseguibili da WSL coprono logica, payload e UI; focus, hotkey globali, WebView2 e cattura Windows vanno provati con il binario Windows.

Per lavorare direttamente su Windows:

1. Installare Rust stable **MSVC** e Visual Studio Build Tools con **Desktop development with C++** e Windows SDK.
2. Copiare il progetto in una cartella Windows, **senza** `node_modules`, `dist` e `src-tauri/target`. Non riutilizzare dipendenze/binari Linux.
3. Da PowerShell, nella copia Windows:

```powershell
npm ci
npx playwright install chromium
npm run verify:desktop
npm run desktop
```

Per ripetere la prova del catalogo nella **WebView2 nativa**, usare una build debug con identificatore dedicato. Evitare altre istanze durante la prova per non creare conflitti di hotkey, salvando prima le proprie chat. Da una PowerShell:

```powershell
npm run desktop:build -- --debug --no-bundle --config '{"identifier":"dev.orbit.runtime-test"}'
$env:WEBVIEW2_USER_DATA_FOLDER=$null
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=19329 --remote-debugging-address=127.0.0.1"
try { & .\src-tauri\target\debug\orbit-overlay.exe }
finally { Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, Env:WEBVIEW2_USER_DATA_FOLDER }
```

Da una seconda PowerShell nella stessa cartella eseguire `npm run test:windows`. Lo script rifiuta l'identificatore di produzione; azzera i pacchetti noti e configura il provider loopback **solo** in `Documenti/Orbit-dev.orbit.runtime-test`. Prende temporaneamente il focus, cattura il monitor attuale, verifica i file salvati, scambia due messaggi locali e chiude Orbit. Per la suite completa usare l'eseguibile in `%LOCALAPPDATA%\Orbit-interop-test\orbit-overlay.exe` con binario, DLL e script copiati e le variabili di debug sopra. Evitare di interagire con il desktop durante la prova. La porta di debug serve solo per questo test: non abilitarla nell'uso normale. Per la distribuzione ricompilare senza l'override `--config`.

`scripts/windows-network.cjs` verifica fetch/WebSocket reali, CORS, origini e redirect negati, codice remoto bloccato e revoca dei permessi. Richiede `network-key.pem` e `network-cert.pem` effimeri accanto allo script, per un server TLS locale. Solo nell'avvio isolato di questo test aggiungere agli argomenti WebView `--host-resolver-rules="MAP api.orbit-network.test 127.0.0.1, MAP denied.orbit-network.test 127.0.0.1" --ignore-certificate-errors --no-proxy-server`. Non riutilizzare questi override fuori dalla prova; rimuovere chiave e certificato al termine. Il traffico della prova resta sul dispositivo.

La regressione mirata `node scripts/windows-service-visibility.cjs` usa lo stesso avvio isolato: verifica richieste da Chat con Screenshot nascosta, nuova, fissata o gia visibile, apertura esplicita durante il servizio e annullamento. Sostituisce soltanto i pacchetti Screenshot/Chat dell'installazione di test e controlla la visibilita anche durante il salvataggio, prima della risposta.

`npm run test:windows:widgets` verifica migrazione del layout, aggiunta da app nascosta, drag e tastiera nativi, cattura reale, anteprime limitate, cancellazione rilevata dal polling, isolamento SDK e segnaposti dopo aggiornamento/disinstallazione. Chiude l'host lasciando il layout di prova; riavviare la stessa build isolata e usare `npm run test:windows:widgets -- --verify-restart` per verificare identita e coordinate dopo il riavvio del processo. Non eseguirlo sull'installazione utente.

`node scripts/windows-layout.cjs <PID_TEST>` verifica geometrie native di app e funzioni interattive, servizi freddi nascosti, istanze concorrenti, dimensioni sotto le vecchie soglie e recupero dal minimo tecnico. Riavviare la stessa build isolata e ripetere con `<PID_TEST> --verify-restart`: verifica il ripristino dopo un nuovo processo. `scripts/windows-prepare.cjs` aggiorna solo i pacchetti pilota dell'installazione isolata, se serve prima delle suite. Cambio DPI e origini negative sono coperti anche da test matematici; il distacco fisico di monitor multipli resta una prova manuale.

Per la prova specifica dei pannelli, avviare invece la build con porta `19328` e un `WEBVIEW2_USER_DATA_FOLDER` temporaneo dedicato, quindi eseguire `npm run test:windows:panels -- <PID_ORBIT_TEST>`. Il test apre una finestra **Orbit input fixture**, verifica input reale, spostamento e ridimensionamento, poi chiude entrambe le finestre. Non chiama provider e non modifica impostazioni o chiavi. Un eventuale secondo argomento `<PID_ALTRA_ISTANZA_ORBIT>` nasconde temporaneamente quella specifica finestra e ne ripristina la visibilita alla fine, senza terminare il processo o cancellarne le chat. Anche questo test richiede un desktop libero da interazioni manuali.

Smoke test manuale prima dell'uso:

| Prova | Risultato atteso |
|---|---|
| Ctrl+E da desktop/app/gioco borderless | Dashboard sul monitor sotto il cursore |
| Ctrl+E di nuovo oppure Esc | Overlay nascosto; ritorno all'app precedente quando il sistema lo consente |
| Ctrl+Shift+1 con overlay aperto e chiuso | Cattura senza includere Orbit |
| Selezione invertita, ai bordi, monitor a 125/150/200% | Ritaglio corrispondente all'area scelta |
| Rilascio della selezione | PNG salvato, anteprima Screenshot o immagine restituita al chiamante, senza oscuramento del desktop |
| Trascinamento barra, lati e angoli del pannello | Posizione e dimensioni aggiornate; al minimo tecnico il contenuto puo essere tagliato, recuperabile dalle impostazioni dell'app |
| Clic e digitazione dentro/fuori il pannello | Dentro solo Orbit; fuori solo l'app sottostante, con Orbit sempre visibile |
| Domanda con un modello vision | Screenshot visibile nella chat e risposta reale in streaming |
| Domanda successiva | Mantiene il contesto dell'immagine |
| Interrompi, chiave errata, endpoint offline | Stop effettivo o errore esplicito, senza risposta simulata |
| Nascondi/riapri durante una risposta | Conversazione e risposta in corso conservate |
| Termina dal catalogo e riavvia la sotto-app | Impostazioni e appunti conservati; chat di sessione eliminate |

### Limiti da verificare sui dispositivi target

Il supporto iniziale e **desktop, app e giochi in finestra/borderless**. Non usiamo injection; fullscreen esclusivo, desktop sicuro, contenuti protetti e compatibilita con qualsiasi anti-cheat non sono garantiti.

La verifica browser non sostituisce le prove native: controllare hotkey a finestra nascosta, permessi macOS, focus al ritorno al gioco, display Retina/multi-monitor con scaling misto e catture ripetute. Un gioco puo mettersi in pausa quando la chat acquisisce il focus.

Per misurare i consumi usare build release e contare **tutti** i processi WebView. Confrontare inattivita nascosta, dashboard aperta, cattura e streaming; osservare memoria dopo cicli ripetuti e frame time del gioco. Non attribuiamo alla demo soglie di RAM/CPU non misurate sui sistemi target.
