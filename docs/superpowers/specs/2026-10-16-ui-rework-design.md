# CTZero Tracker — Rework della UI — Design Spec

Data: 2026-10-16
Estende: `2026-10-02-ctzero-tracker-design.md`, `2026-10-07-sealed-products-design.md`, `2026-10-09-card-groups-and-import-design.md`, `2026-10-16-price-history-design.md`.
Mockup di riferimento: https://claude.ai/artifact/UnfC1osUmvTDrjGLy6otQi (privato).

## 1. Obiettivo

La UI è cresciuta per aggiunte (sealed, gruppi, import, storico prezzi) e oggi è disomogenea:
- i gruppi, ormai il modo principale di organizzare le carte, sono una select con un dialog "Manage groups";
- la tabella delle carte ha 10 colonne e 5 chip per riga; "Status" e "Δ threshold" dicono la stessa cosa;
- modifica e storico dello stesso elemento sono due dialog distinti;
- lo stato dell'aggiornamento (`SyncHeader`) è duplicato su ogni pagina, l'import è una route raggiungibile solo da un bottone, il riepilogo è una riga di testo.

Il rework ridisegna l'interfaccia attorno a tre domande, in quest'ordine di importanza:
1. **Sta aggiornando? Quando ha aggiornato l'ultima volta?** Sempre visibile, senza scroll.
2. **Cosa è sotto target?** A colpo d'occhio, per gruppo.
3. **Com'è andato il prezzo di questo elemento e cosa ne voglio fare?** In un unico posto.

Criteri di successo:
- aprendo l'app vedo subito, senza scroll, lo stato dell'ultimo aggiornamento (o il progresso di quello in corso) e quando ci sarà il prossimo;
- navigo tra "All cards", i singoli gruppi, "Ungrouped" e "Sealed products" da una sidebar; per ogni voce vedo quanti elementi contiene e quanti sono sotto target;
- per ogni vista vedo quattro indicatori (tracciati, sotto target, totale attuale vs totale target, da controllare) e posso filtrare per stato, cercare per nome e ordinare;
- da una riga apro un pannello laterale con prezzo, grafico dello storico, target, regole e gruppo, e da lì modifico o smetto di tracciare l'elemento;
- tema scuro di default, con toggle per il chiaro; la scelta è ricordata.

### Decisioni
- **Solo frontend**: nessuna modifica a schema, API o scheduler. L'unica eccezione sono i testi del report Telegram (§9).
- **"Threshold" diventa "Target"** in tutti i testi visibili all'utente: UI e report Telegram. Nel codice, nei tipi e nelle API resta `threshold` (`thresholdCents`, `BulkAction` `threshold`, ...), per non toccare il contratto.
- **Niente gruppi per i sealed**: restano una sezione a parte della sidebar, con lo stesso layout delle carte.
- **PrimeVue resta** la libreria di componenti, con Aura personalizzato tramite `definePreset` (palette, superfici, raggi). Niente Tailwind, niente nuova libreria UI.
- **Dark mode**: default scuro, toggle nella sidebar, preferenza in `localStorage` (`ctzero.theme` = `dark` | `light`). Classe `app-dark` su `<html>`, usata come `darkModeSelector` di PrimeVue. Un piccolo script inline in `index.html` applica la classe prima del mount, così non c'è il lampo del tema sbagliato.
- **Font**: IBM Plex Sans per il testo, IBM Plex Mono per prezzi e numeri, con le cifre allineate. Sono self-hosted tramite `@fontsource/ibm-plex-sans` e `@fontsource/ibm-plex-mono` (nuove dipendenze di `web`), perché l'app gira in Docker anche offline.
- **Stato condiviso senza Pinia**: moduli composable con stato reattivo a livello di modulo (`useCatalog`, `useSyncStatus`, §3). La sidebar e le pagine leggono gli stessi dati senza richiederli due volte.
- **Conteggi della sidebar calcolati dal client** a partire da `GET /api/cards` e `GET /api/sealed`, già caricati per le liste. Nessun nuovo endpoint.
- **Il pannello di dettaglio sostituisce** il dialog di modifica (`CardDialog` in modalità edit, `SealedDialog` in modalità edit) e `PriceHistoryDialog`. "Add card" e "Add sealed product" restano dialog modali.
- **Lingua della UI**: inglese, come oggi. I testi in questa spec sono descrittivi; quelli effettivi sono in inglese.

## 2. Design system

### Token (`web/src/theme.ts` + `web/src/style.css`)
Un preset Aura (`definePreset`) definisce primary e superfici per i due schemi. Le variabili CSS applicative (`--ct-*`) coprono ciò che PrimeVue non copre (sidebar, chip, barra bulk).

| Token | Scuro | Chiaro | Uso |
|---|---|---|---|
| `bg` | `#0F1114` | `#F4F3EF` | sfondo pagina |
| `side` | `#0B0C0F` | `#ECEAE4` | sidebar |
| `panel` | `#16191D` | `#FFFFFF` | pannelli, tabella, drawer |
| `chip` | `#1F2328` | `#EFEDE7` | segmented control, chip, track delle barre |
| `ink` | `#ECEEF1` | `#17191E` | testo |
| `muted` | `#A0A6B0` | `#5A5F69` | testo secondario (≥ 4.5:1 su `panel`) |
| `line` / `lineStrong` | `#262A31` / `#363C45` | `#E3E0D8` / `#CDC9BF` | bordi |
| `accent` | `#3FD0A6` | `#0B7A62` | primary, "sotto target", prezzo in calo |
| `accentSoft` / `accentText` | `#123A30` / `#6BE3BF` | `#DDEFE8` / `#07624E` | badge e testo "Below target" |
| `warn` / `warnSoft` | `#F2A646` / `#3A2A12` | `#9A5300` / `#FAEBD6` | "No offers", avvisi di configurazione |
| `danger` / `dangerSoft` | `#FF8A7A` / `#3B1A17` | `#B42318` / `#FCE6E2` | errori, prezzo in aumento, eliminazione |

Regole:
- l'accento ha **un solo significato**: "sotto target / buona notizia". Non si usa per decorare;
- i prezzi e i numeri usano sempre IBM Plex Mono;
- raggi: 8–10 px per i controlli, 12–14 px per i pannelli;
- l'aumento e il calo di prezzo hanno anche una freccia (`↑` / `↓`), non solo il colore.

### Componenti di base
Nessun componente "di design system" separato: si stilano i componenti PrimeVue tramite preset e CSS globale (`DataTable`, `Button`, `SelectButton`, `Drawer`, `Dialog`, `Tag`, `InputNumber`, `Select`, `MultiSelect`). I due elementi ricorrenti nuovi sono:
- `StatusPill.vue`: badge "Below target" / "No offers" / "Update failed" con i colori della tabella sopra;
- `TargetGap.vue`: barretta di 64 px più testo ("9.1% under" / "22.7% to go"). Piena e color accento se il prezzo è sotto il target, altrimenti riempita al rapporto `target / prezzo`.

## 3. Shell dell'applicazione

### Layout (`App.vue`)
- Griglia a due colonne `264px 1fr` alta `100vh`; **scrolla solo il pannello principale** (`overflow-y: auto`). La sidebar ha altezza fissa.
- Sotto i 900 px la sidebar diventa una barra in alto con logo, stato aggiornamento compatto (pallino e orario, o `34/57` durante un update) e un bottone menu. Il menu apre la navigazione in un `Drawer` a sinistra.

### Sidebar (`components/AppSidebar.vue`), dall'alto in basso
1. **Logo e toggle tema** (icona sole/luna, `aria-label` "Switch to light/dark theme").
2. **Stato aggiornamento** (`components/SyncStatus.vue`), fisso, mai coperto dallo scroll:
   - a riposo: pallino colorato secondo l'esito dell'ultimo run (`ok` accento, `partial` warn, `failed` danger), poi "Updated at HH:MM" e sotto "Today, all OK · next at HH:MM". La data compare se non è oggi. Con esito `partial`/`failed` il testo diventa "With errors"/"Failed", con l'errore in tooltip. Se il report non è stato inviato, compare "report not sent" con il motivo in tooltip;
   - durante un run: "Updating prices…", `cardsDone / cardsTotal`, ultimo run, barra di progresso;
   - bottone icona "Update now", disabilitato durante un run. Un 409 viene ignorato, come oggi;
   - se `GET /api/health` segnala CardTrader o Telegram non configurati, un avviso compatto ("Telegram not configured: alerts are not sent", oppure il token CardTrader mancante in stile danger) che porta a Settings.
3. **Area navigazione scrollabile** (`flex: 1; overflow-y: auto`): è l'unica parte della sidebar che scrolla quando i gruppi sono tanti.
   - sezione **Cards**: "All cards", un elemento per gruppo (ordine alfabetico), "Ungrouped", bottone "New group" (inline: input con nome, Invio crea, Esc annulla);
   - sezione **Sealed**: "Sealed products";
   - ogni voce mostra a destra il numero di elementi e, se > 0, un badge con quanti sono sotto target.
4. **Strumenti**, fissi in fondo con separatore: "Import list", "Settings".

### Stato condiviso
- `useSyncStatus()` (`web/src/sync-status.ts`): contiene il polling oggi in `SyncHeader` (2 s durante un run, 30 s altrimenti), un'unica istanza per tutta l'app. Espone `status`, `running`, `progress`, `syncNow()` e `onRunFinished(cb)`; le pagine si registrano per ricaricare i dati quando un run termina.
- `useCatalog()` (`web/src/catalog.ts`): `cards`, `sealed`, `groups`, `health` con `reload()` / `reloadCards()` / `reloadSealed()` / `reloadGroups()`. Gli errori di un caricamento non svuotano gli altri, come oggi in `CardsPage.load()`. Si ricarica dopo ogni mutazione e a ogni `onRunFinished`.
- Logica pura testata in `web/src/nav-summary.ts`: `navCounts(cards, sealed, groups)` → per ogni voce `{ count, below }`.

### Route (`router.ts`)
| Route | Vista |
|---|---|
| `/` | redirect a `/cards` |
| `/cards` | All cards |
| `/cards/ungrouped` | carte senza gruppo |
| `/groups/:id` | un gruppo (id sconosciuto → redirect a `/cards`) |
| `/sealed` | sealed |
| `/import` (`?group=:id` opzionale) | import |
| `/settings` | impostazioni |

Il pannello di dettaglio è nella query (`?item=:id`), così sopravvive al refresh e si può linkare. `parseGroupFilter` / `groupFilterQuery` di `group-summary.ts` passano dalla query `?group=` ai parametri di route. La vecchia `/?group=:id` fa redirect a `/groups/:id`.

## 4. Vista lista (carte e sealed)

Un unico componente `components/TrackedList.vue`, usato da `CardsPage.vue` (all, ungrouped, gruppo) e `SealedPage.vue`. Le differenze passano da prop e slot (riga meta, colonne della barra bulk, azione "Add").

### Intestazione
- Eyebrow ("Cards", "Group", "Sealed") e titolo ("All cards", nome del gruppo, "Ungrouped cards", "Sealed products").
- Su un gruppo: menu "…" con "Rename" (inline sul titolo) e "Delete group" (conferma: "Its N cards stay tracked, without a group."). Sostituisce `GroupsDialog`, che viene rimosso.
- A destra: "Import list" (dentro un gruppo diventa "Import into group" e apre `/import?group=:id`) e "Add card" (primario; dentro un gruppo, il gruppo è preselezionato come oggi con `defaultGroupId`). Su Sealed: "Add product".

### Indicatori
Quattro riquadri calcolati sulla vista corrente (filtro di stato e ricerca esclusi), estendendo `summarize()` di `group-summary.ts`:
- **Tracked**: numero di elementi;
- **Below target**: numero, in colore accento;
- **Current total**: somma dei prezzi attuali, con sotto "target total €X" e "· N without price" se ci sono elementi senza prezzo;
- **Needs attention**: no offers + errore, in warn se > 0.

### Barra strumenti
- Segmented control per stato con conteggi: All / Below target / Watching / Needs attention. La mappatura con `cardStatus()`: `below` → Below target, `above` → Watching, `no_offers` + `error` → Needs attention, `pending` → solo in All.
- Ricerca per nome, client-side, case e accent insensitive.
- Ordinamento: Status (default, `sortForDisplay` attuale), Closest to target, Biggest 7-day drop, Price, Name.
- Filtro, ricerca e ordinamento sono in query (`?status=`, `?q=`, `?sort=`). Quando cambiano, la selezione viene svuotata, come oggi al cambio di gruppo.

### Tabella (`DataTable`, 6 colonne)
| Colonna | Contenuto |
|---|---|
| selezione | checkbox; quella nell'intestazione seleziona le righe visibili |
| Card / Product | miniatura (anteprima grande al passaggio del mouse, come oggi), nome come bottone che apre il dettaglio, riga meta sotto |
| CT Zero price | prezzo in mono; sotto `StatusPill` se lo stato non è "above"/"pending", poi il listing (espansione · condizione · lingua) |
| Target | target in mono e `TargetGap` |
| 7 days | sparkline (cliccabile, apre il dettaglio) e `change7dPct` con freccia; colore accento se in calo, danger se in aumento, neutro se 0. Senza dati: "No data yet"; in errore: il messaggio breve dell'errore |
| azioni | link CardTrader (icona) e bottone "Open details" (chevron) |

Riga meta:
- carte: `espansioni · lingue · ≥ condizione · finitura` in testo, ad es. "Any expansion · EN, IT · ≥ NM · Non-foil". In "All cards" è preceduta da un chip con il nome del gruppo;
- sealed: `espansione · categoria · lingue`.

Formattazione pura e testata in `web/src/row-format.ts`: `metaLine(card)`, `targetGap(item)`, `formatChange()` (spostata da `price-history.ts`).

Colonne rimosse: Status (diventa `StatusPill`), Δ threshold (diventa `TargetGap`), Updated (va nel dettaglio), Edit/Delete/History (vanno nel dettaglio).

Riga selezionata: sfondo tenue d'accento. Riga con il dettaglio aperto: sfondo `chip`.

### Azioni bulk
Barra flottante `position: sticky` in fondo al pannello principale, visibile solo con selezione: "N selected", "Set target…", "Edit rules…" (solo carte), "Move to group…" (solo carte), "Stop tracking", "Clear selection".
- Riusano `BulkThresholdDialog`, `BulkFiltersDialog` e `BulkGroupDialog`, ristilati e con i testi aggiornati. Le titolazioni diventano "Set target", "Edit rules", "Move to group"; la logica (`bulk-cards.ts`, `batch-runner.ts`) resta invariata, toast e stop parziali compresi.
- Novità: "Set target…" e "Stop tracking" anche per i sealed, eseguiti come chiamate per elemento con `runBatch` (PUT / DELETE `/api/sealed/:id`), visto che il bulk server-side esiste solo per le carte.

## 5. Pannello di dettaglio (`components/ItemDrawer.vue`)

`Drawer` PrimeVue a destra, largo 500 px (a tutta larghezza sotto i 600 px), con la maschera sopra la lista. Si apre da nome, sparkline o chevron della riga e imposta `?item=:id`. Si chiude con la X, con Esc o cliccando la maschera.

Sezioni, dall'alto:
1. **Intestazione**: immagine (carta Scryfall `normal`, sealed CardTrader `show_`), contesto ("Card · <gruppo>" / "Card · no group" / "Sealed product"), nome, `StatusPill`, link "Open on CardTrader".
2. **Prezzo e target**, affiancati:
   - a sinistra: prezzo CT Zero, con sotto il listing;
   - a destra: target, con sotto la distanza ("9.1% under your target — alert sent" / "€3.40 to go (22.7%)" / "alert fires as soon as an offer is at or under it" se non c'è prezzo).
3. **Price history** (`components/PriceHistoryChart.vue`): contenuto di `PriceHistoryDialog` estratto in un componente senza dialog. Stessi dati, stessa logica di `price-history.ts` e range 30 d / 90 d / All. Cambiano tre cose:
   - zona sotto il target campita in `accentSoft`;
   - linea del target in `accentText` con etichetta "Target €X";
   - marcatore "Filters changed" rinominato "Rules changed".

   Sotto il grafico: Low / High e la legenda "no offers" se presente. "Current" non si ripete, perché è già nella sezione 2.
4. **Alert me at or under**: `InputNumber` in euro con i preset come chip ("-10% · €28.62", "-20%", "-30%", "€1"). I preset si calcolano client-side da `lastPriceCents`: `thresholdPresets` si sposta da `server/src/pricing/presets.ts` a `shared/src/presets.ts` e lo usano sia il server sia il client, quindi non serve chiamare `/preview`. Senza prezzo attuale resta solo "€1", come oggi.
5. **Which offers count** (regole):
   - carte: Expansions (`MultiSelect` sulle printings caricate da `/api/printings` all'apertura, come oggi in edit), Languages, Minimum condition, Finish, più Group;
   - sealed: Category (solo lettura) e Languages.

   Nota: "changing these re-prices the item".
6. **Piede**: "Stop tracking" (danger, con conferma), "Checked <data>" o "Failed <data>" con l'errore in tooltip, "Save changes" (primario, abilitato solo con modifiche valide).

Salvataggio:
- `PUT /api/cards/:id` (filtri, target, gruppo) / `PUT /api/sealed/:id`, come oggi. Dopo il salvataggio il drawer resta aperto con i dati aggiornati, compreso il grafico (nuovo `configVersion` → marcatore) e la lista si ricarica.
- Chiudere con modifiche non salvate chiede conferma ("Discard changes?").

## 6. Dialog di creazione
`CardDialog.vue` e `SealedDialog.vue` restano solo per la creazione: la modalità edit si rimuove. Si ristilano (layout, `StatusPill`, preset come chip) e "Notification threshold" diventa "Alert me at or under". Il flusso resta lo stesso, compreso "Calculate price".

## 7. Import (`pages/ImportPage.vue`)
- Indicatore di step in alto: 1 Paste the list → 2 Review prices and targets → 3 Done. Lo step corrente è evidenziato.
- Step 1 su due colonne (una sola sotto i 900 px):
  - a sinistra la decklist in mono con il conteggio delle righe riconosciute e scartate;
  - a destra tre blocchi: "Add to group" (New / Existing / No group; con `?group=:id` parte su Existing con quel gruppo), "Rules for every card", "Target for every card".
- Il bottone primario diventa "Check prices for N cards".
- Step 2, revisione: stessa tabella con lo stile della lista e target modificabile per riga. Step 3: link al gruppo (`/groups/:id`) o a `/cards`.
- Logica invariata (`import-review.ts`, `batch-runner.ts`).

## 8. Settings (`pages/SettingsPage.vue`)
Due pannelli:
- **Price checks**: schedule e "further drop", come oggi;
- **Connections**: CardTrader e Telegram con badge "Connected" / "Not configured" e l'istruzione `.env` quando manca qualcosa; il bottone "Send test message" vive qui.

`HealthBanner.vue` viene rimosso: il suo contenuto va nell'avviso della sidebar e in questo pannello.

## 9. Testi
- UI: "Threshold" → "Target" ovunque ("Below threshold" → "Below target", "Change threshold" → "Set target", "Notification threshold" → "Alert me at or under", "Threshold total" → "target total", ...). "Filters" → "Rules" dove indica le regole di matching di un elemento.
- Report Telegram (`server/src/alerts/report.ts`): "threshold" → "target" nelle righe e nei titoli ("Below target", "Back above target"); si aggiornano anche i test di `report.test.ts`.
- `STATUS_META` (`card-status.ts`): "Below target", "Watching", "No offers", "Update failed", "Pending".

## 10. Rimozioni
`SyncHeader.vue`, `HealthBanner.vue`, `GroupsDialog.vue`, `PriceHistoryDialog.vue` (contenuto spostato in `PriceHistoryChart.vue`), modalità edit di `CardDialog` / `SealedDialog`, colonne Status / Δ threshold / Updated, select dei gruppi.

## 11. Casi limite
- **Molti gruppi**: scrolla solo l'area di navigazione della sidebar; stato aggiornamento e strumenti restano visibili.
- **Nomi di gruppo lunghi**: troncati con ellissi, nome completo in tooltip.
- **Gruppo eliminato mentre lo si guarda** (anche da un'altra scheda): al prossimo reload la route fa redirect a `/cards`.
- **`?item=` di un elemento inesistente o cancellato**: il drawer non si apre e il parametro viene rimosso.
- **Run che finisce con il drawer aperto**: i dati si aggiornano, ma le modifiche non salvate nel drawer restano.
- **Selezione e cambio vista**: la selezione si svuota, come oggi.
- **`localStorage` non disponibile**: tema scuro, nessun errore.
- **Health non raggiungibile**: nessun avviso, come oggi.

## 12. Test
- Nuovi test puri:
  - `nav-summary.test.ts`: conteggi e "below" per voce, carte senza gruppo, gruppi vuoti;
  - `row-format.test.ts`: riga meta, `targetGap` (sotto, sopra, senza prezzo), `formatChange`;
  - test per la mappatura stato → tab e per ricerca e ordinamenti, in `list-filters.ts`;
  - `shared/src/presets.test.ts`, spostato da `server/src/pricing/presets.test.ts`.
- Aggiornati: `group-summary.test.ts` (route params), `card-status.test.ts` (etichette), `report.test.ts` (testi Telegram).
- Componenti Vue: nessun test automatico, come oggi. Verifica manuale avviando l'app sui dati reali, in entrambi i temi, a 1440 px e a 390 px.

## 13. Fuori scope
- Gruppi per i sealed.
- Vista a griglia/galleria delle carte.
- Riordino manuale dei gruppi nella sidebar.
- Scorciatoie da tastiera.
- Modifiche alle API o allo schema.
