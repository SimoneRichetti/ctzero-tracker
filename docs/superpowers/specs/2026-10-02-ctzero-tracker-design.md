# CTZero Tracker — Design Spec

Data: 2026-10-02
Origine: `DESIGN-DOC.md` + sessione di brainstorming.

## 1. Obiettivo

Tool personale (singolo utente) che traccia il prezzo di carte Magic: The Gathering su CardTrader, considerando **esclusivamente inserzioni vendibili tramite CardTrader Zero**, e notifica via Telegram quando il prezzo scende alla soglia scelta o sotto.

Criteri di successo:
- posso aggiungere/modificare/rimuovere carte tracciate con filtri (espansioni, lingue, condizione minima, foil) e soglia, aiutato da preset;
- vedo in una UI prezzo corrente, soglia, stato e data ultimo aggiornamento;
- ricevo su Telegram un report solo quando succede qualcosa di rilevante;
- posso lanciare manualmente un aggiornamento.

### Vincoli e decisioni
- Gira **in locale sul PC dell'utente** (WSL/Windows), acceso solo quando serve → recupero automatico all'avvio.
- Stack **TypeScript** ovunque. **Nessuna libreria aziendale** (niente FuturaUI).
- Notifiche via **Telegram** (bot proprio).
- Ricerca carte via **Scryfall**; prezzi via **API CardTrader v2**.
- Nessun preset "minimo ultimi N mesi" (CardTrader non fornisce storico).
- Prezzi sempre in **centesimi di euro (interi)**. Spedizione non considerata.

### Fatti sull'API CardTrader che condizionano il design
- Base URL `https://api.cardtrader.com/api/v2`, header `Authorization: Bearer <token>`.
- Rate limit: 200 req / 10 s globali; `/marketplace/products` 10 req/s.
- `GET /expansions` → `id, game_id, code, name`.
- `GET /blueprints/export?expansion_id=X` → blueprint con `id, name, expansion_id, image_url, scryfall_id, ...`.
- `GET /marketplace/products?blueprint_id=X[&foil=bool][&language=xx]` → oggetto indicizzato per blueprint id, con **al massimo le 25 inserzioni più economiche**. Campi usati: `id, blueprint_id, quantity, price.cents, price.currency, properties_hash.{condition, mtg_language, mtg_foil, signed, altered}, graded, on_vacation, user.can_sell_via_hub`.
- **CT Zero** ⇔ `user.can_sell_via_hub === true`.
- Non esiste ricerca per nome.

Limite accettato: se le 25 inserzioni più economiche di un blueprint sono tutte non-Zero o di condizione inferiore, la carta risulta "nessuna offerta" anche se esistono offerte valide più costose. La UI lo rende evidente con lo stato "nessuna offerta".

## 2. Architettura

Un unico processo Node (`npm start`) su `http://localhost:3000` che espone l'API REST, serve la UI buildata ed esegue lo scheduler. Persistenza su SQLite (`data/ctzero.db`) tramite il modulo built-in `node:sqlite`.

```
ctzero-tracker/            (npm workspaces)
├── shared/      tipi + schemi zod condivisi
├── server/
│   ├── clients/     cardtrader.ts, scryfall.ts, telegram.ts   (solo HTTP, nessuna logica)
│   ├── pricing/     filtro inserzioni + prezzo minimo CT Zero
│   ├── alerts/      regole di notifica (pure) + composizione report
│   ├── sync/        orchestrazione del giro di aggiornamento
│   ├── scheduler/   setTimeout + calcolo puro della prossima esecuzione, recupero all'avvio
│   ├── db/          schema SQL + migrazioni (PRAGMA user_version) + repository
│   └── api/         rotte Fastify
└── web/         Vue 3 + Vite + PrimeVue
```

Librerie: Fastify, `node:sqlite` (built-in, nessuna dipendenza nativa), zod, Vitest, tsx, Vue 3, Vite, PrimeVue 4. Telegram via `fetch` sulla Bot API. Niente ORM né croner: lo schema è piccolo e "ogni N ore" con N che non divide 24 non è esprimibile in cron.

Configurazione:
- `.env` (ignorato da git): `CARDTRADER_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, opzionale `PORT` (default 3000).
- Pianificazione e parametri modificabili da UI, salvati nella tabella `settings`.

Principio: i client HTTP sono "stupidi"; filtri, prezzi e regole di notifica sono funzioni pure, testabili senza rete.

## 3. Modello dati

### `tracked_cards`
| campo | tipo | note |
|---|---|---|
| `id` | int PK | |
| `name` | text | nome Oracle (Scryfall) |
| `scryfall_oracle_id` | text | |
| `image_url` | text | miniatura |
| `expansion_ids` | JSON int[] | id espansioni CardTrader; `[]` = qualsiasi |
| `languages` | JSON text[] | codici lingua CardTrader (`en`, `it`, `fr`, `de`, `es`, `pt`, `jp`, `ko`, `ru`, `zh-CN`, `zh-TW`); `[]` = qualsiasi |
| `min_condition` | text | uno di: `Mint`, `Near Mint`, `Slightly Played`, `Moderately Played`, `Played`, `Heavily Played`, `Poor` (ordine decrescente di qualità) |
| `foil` | bool | |
| `threshold_cents` | int | soglia |
| `config_version` | int | +1 a ogni cambio filtri |
| `last_price_cents` | int nullable | prezzo minimo CT Zero valido; `null` se nessuna offerta / mai aggiornato |
| `last_listing` | JSON nullable | `{productId, blueprintId, expansionName, condition, language, foil, url}` |
| `last_synced_at` | datetime nullable | |
| `last_sync_status` | text nullable | `ok` / `no_offers` / `error` |
| `last_error` | text nullable | |
| `alert_state` | text nullable | `above` / `below`; `null` = non ancora valutato |
| `last_notified_price_cents` | int nullable | prezzo di riferimento per "ulteriore calo" |
| `blueprints_resolved_at` | datetime | |

Il DTO `TrackedCard` espone anche `expansionNames` (nomi distinti da `card_blueprints`, vuoto se "qualsiasi").
| `created_at`, `updated_at` | datetime | |

### `card_blueprints`
`tracked_card_id` (FK, cascade), `blueprint_id`, `expansion_id`, `expansion_name`. Stampe CardTrader corrispondenti ai filtri della carta.

### `price_snapshots`
`tracked_card_id` (FK, cascade), `config_version`, `synced_at`, `price_cents` (nullable). Una riga per carta per giro. Nessuna UI per ora; conservato perché non ricostruibile a posteriori.

### `sync_runs`
`id`, `trigger` (`manual` / `scheduled` / `catchup`), `started_at`, `finished_at` (nullable), `status` (`running` / `ok` / `partial` / `failed`), `cards_total`, `cards_done`, `cards_error`, `error` (nullable), `report_sent` (bool), `report_error` (nullable).

### `settings` (chiave/valore)
- `schedule_mode`: `interval` | `daily` (default `interval`)
- `interval_hours`: int (default 6)
- `daily_time`: `HH:MM` (default `09:00`)
- `further_drop_percent`: number (default 5)

## 4. Risoluzione dei blueprint

Input: nome carta (oracle id) + `expansion_ids` scelti.
1. Scryfall `GET /cards/search?q=oracleid:<id>&unique=prints` → stampe con `id` (scryfall_id) e `set` (codice).
2. Mappatura set Scryfall → espansione CardTrader per `code` (case-insensitive) usando `GET /expansions` (cache in memoria, rinfrescata una volta al giorno), filtrando `game_id` di Magic.
3. Per ogni espansione coinvolta (tutte se "qualsiasi", altrimenti quelle scelte): `GET /blueprints/export?expansion_id=X`, tenendo i blueprint con `scryfall_id` presente tra le stampe della carta. Cache in memoria per espansione durante la richiesta.
4. Se nessun blueprint trovato → errore di validazione al salvataggio.

Quando: al salvataggio di una carta, a ogni cambio filtri, e — per carte con espansione "qualsiasi" — all'inizio di un giro se `blueprints_resolved_at` è più vecchio di 7 giorni.

`GET /api/printings?name=` usa gli stessi passi 1–2 per mostrare nella UI le espansioni CardTrader disponibili per la carta.

## 5. Calcolo del prezzo (`pricing/`)

Per ogni blueprint della carta:
- `foil` sempre passato come parametro;
- lingue: una lingua → `language=xx`; più lingue → una chiamata per lingua; qualsiasi → nessun parametro.

Un'inserzione è **valida** se:
- `user.can_sell_via_hub === true` (CT Zero — regola assoluta);
- condizione ≥ `min_condition`;
- `properties_hash.mtg_foil === foil`;
- lingua in `languages` (o `languages` vuoto);
- `quantity > 0`, `on_vacation` falso;
- non `altered`, non `signed`, non `graded`;
- `price.currency === "EUR"`.

Prezzo della carta = minimo `price.cents` tra le inserzioni valide di tutti i blueprint. Esito: `ok` con prezzo + inserzione, oppure `no_offers`. URL inserzione: `https://www.cardtrader.com/cards/<blueprint_id>`.

## 6. Regole di notifica (`alerts/`)

Funzione pura: `(stato precedente della carta, esito del giro, soglia, further_drop_percent) → {nuovo stato, evento?}`.

| Evento | Condizione | Effetto |
|---|---|---|
| 🟢 Sotto soglia | prezzo ≤ soglia e `alert_state` ≠ `below` | notifica; `alert_state=below`; `last_notified_price_cents=prezzo` |
| 📉 Ulteriore calo | `alert_state=below`, prezzo ≤ soglia, prezzo ≤ `last_notified_price_cents × (1 − further_drop_percent/100)` | notifica; `last_notified_price_cents=prezzo` |
| 🔁 Tornato sopra | `alert_state=below` e (prezzo > soglia oppure `no_offers`) | notifica informativa; `alert_state=above`; `last_notified_price_cents=null` |
| ⚪ Invariato | `below` senza calo sufficiente, oppure `above` e prezzo > soglia | nessuna notifica |
| ⚠️ Nessuna offerta | `no_offers` e `alert_state` ≠ `below` | nessuna notifica; `alert_state=above` |
| ❌ Errore carta | errore API sulla carta | nessuna transizione di stato; elencato nel report in una sezione "Errori" |

Il confronto per "ulteriore calo" è rispetto all'**ultimo prezzo notificato**, così cali piccoli e ripetuti si accumulano fino a superare la percentuale.

**Valutazione silenziosa** (nessun messaggio Telegram), stesse transizioni ma senza evento inviato:
- alla creazione di una carta (dopo il primo aggiornamento immediato);
- al cambio filtri: reset di `last_price_cents`, `last_listing`, `alert_state`, `last_notified_price_cents`; `config_version += 1`; nuova risoluzione blueprint; aggiornamento immediato della sola carta;
- al cambio della sola soglia: nessuna chiamata a CardTrader; ricalcolo dello stato con `last_price_cents` (se `null` → `above`).

In valutazione silenziosa: prezzo ≤ soglia → `below` con `last_notified_price_cents=prezzo`; altrimenti `above`.

### Report Telegram
Inviato a fine giro solo se c'è almeno un evento o un errore. Testo in Markdown/HTML Telegram, sezioni nell'ordine: Sotto soglia, Ulteriore calo, Tornato sopra soglia, Errori. Esempio:

```
🃏 CTZero Tracker — 02/10 18:00

🟢 Sotto soglia
• Ragavan, Nimble Pilferer (MH2, NM, EN) — 38,50 € (soglia 40,00 €, 1,50 € sotto) → link

📉 Ulteriore calo
• Sheoldred, the Apocalypse — 52,00 € (era 58,00 €) → link

🔁 Tornato sopra soglia
• The One Ring — 71,00 € (soglia 65,00 €)

❌ Errori
• Black Lotus — timeout CardTrader
```

Errore globale del giro (es. 401) → un unico messaggio di avviso con la causa.

## 7. Giro di aggiornamento (`sync/`)

- Lock: un solo giro alla volta (riga `sync_runs` con `status=running`; all'avvio del processo eventuali `running` orfani vengono marcati `failed` con `finished_at = started_at`). Trigger durante un giro attivo → risposta "già in esecuzione" con lo stato corrente.
- Carte processate in sequenza; throttling globale ~5 req/s verso CardTrader.
- Retry: fino a 2 tentativi con backoff esponenziale su 429/5xx/errori di rete.
- Errore su singola carta → `last_sync_status=error`, `last_error`, il giro continua (`status=partial`).
- Errore globale (401/403) → giro interrotto, `status=failed`, avviso Telegram.
- Per ogni carta: risoluzione blueprint se scaduta → prezzo → snapshot → regole → aggiornamento riga.
- Fine giro: composizione e invio report; esito invio salvato in `sync_runs`.
- `cards_done` aggiornato progressivamente per l'avanzamento in UI.

## 8. Scheduler (`scheduler/`)

- `setTimeout` sulla prossima esecuzione calcolata da `nextRunAt(lastFinishedAt, settings, now)`. `interval`: `interval_hours` ore dopo l'ultimo giro terminato; `daily`: ogni giorno a `daily_time` (ora locale).
- "Ultimo giro terminato" = qualunque esito (anche `failed`), così un token errato non provoca giri a ripetizione. Anche i giri manuali spostano la prossima esecuzione.
- Modifica delle impostazioni → job ripianificato subito.
- Recupero all'avvio: se `nextRunAt(...) ≤ now` (giro saltato o mai eseguito), parte un giro `catchup` ~30 s dopo l'avvio.
- Prossima esecuzione esposta all'API per la UI.

## 9. Preset soglia

`POST /api/cards/preview` (filtri in input, nessun salvataggio) → risolve blueprint e calcola prezzo, restituisce prezzo, inserzione e preset.

Preset (funzione pura, arrotondati al centesimo):
- con prezzo `p`: `-10%`, `-20%`, `-30%` di `p`; `1 €` solo se `p > 100` centesimi;
- senza offerte: solo `1 €`.
Più sempre il campo libero nella UI.

## 10. API REST

| Metodo | Rotta | Descrizione |
|---|---|---|
| GET | `/api/cards` | lista carte tracciate |
| POST | `/api/cards` | crea (risolve blueprint, aggiorna subito, valutazione silenziosa) |
| PUT | `/api/cards/:id` | modifica (cambio filtri vs sola soglia, vedi §6) |
| DELETE | `/api/cards/:id` | elimina |
| POST | `/api/cards/preview` | anteprima prezzo + preset |
| GET | `/api/autocomplete?q=` | proxy autocompletamento Scryfall |
| GET | `/api/printings?name=` | espansioni CardTrader disponibili per la carta |
| POST | `/api/sync` | avvia giro manuale (409 se già in corso) |
| GET | `/api/sync/status` | ultimo giro / giro in corso + prossima esecuzione |
| GET/PUT | `/api/settings` | impostazioni |
| GET | `/api/health` | presenza dei token configurati |
| POST | `/api/telegram/test` | invia messaggio di test |

Validazione input con zod (schemi in `shared/`). Errori come `{ error: string }` con status HTTP appropriato.

## 11. UI (Vue 3 + PrimeVue)

**Pagina "Carte tracciate"**
- Header: ultimo aggiornamento (data + esito), prossimo previsto, pulsante "Aggiorna ora" con avanzamento (`cards_done/cards_total`, polling di `/api/sync/status` ogni 2 s durante il giro).
- Banner se token mancanti (`/api/health`).
- Tabella: miniatura, nome, chip filtri (espansioni / lingue / condizione min / foil), prezzo attuale, soglia, delta % rispetto alla soglia, stato (🟢 sotto soglia / sopra / ⚠️ nessuna offerta / ❌ errore con tooltip), ultimo aggiornamento, azioni (modifica, elimina con conferma, apri su CardTrader). Ordinamento di default: sotto soglia in cima.

**Dialog "Aggiungi / Modifica carta"**
1. Nome con autocompletamento (disabilitato in modifica).
2. Filtri: espansioni (multiselect da `/api/printings` + "qualsiasi"), lingue (multiselect + "qualsiasi"), condizione minima (select, default Near Mint), foil (toggle).
3. "Calcola prezzo" → anteprima: prezzo + inserzione; pulsanti preset + campo libero in euro → Salva.

**Pagina "Impostazioni"**
Modalità pianificazione (intervallo ore / orario giornaliero), percentuale ulteriore calo, stato token, pulsante "Invia messaggio di test".

## 12. Gestione errori

- Token mancanti/non validi: il server parte comunque; `/api/health` lo segnala; i giri falliscono con errore chiaro.
- Scryfall irraggiungibile: errore nell'autocompletamento/anteprima; carte già tracciate non impattate (lo scheduler non usa Scryfall salvo ri-risoluzione blueprint, che in caso di errore mantiene i blueprint esistenti).
- Nessun blueprint abbinato: 422 al salvataggio con messaggio esplicito.
- Telegram irraggiungibile: errore salvato in `sync_runs.report_error` e mostrato in UI.

## 13. Test

- Vitest, unit su funzioni pure: filtro inserzioni e prezzo; regole di notifica (tutte le transizioni di §6, incluse valutazioni silenziose); composizione report; preset; `nextRunAt`; mappatura set Scryfall ↔ CardTrader.
- Client HTTP: fixture JSON realistiche + `fetch` mockato (incluso retry su 429).
- API: `fastify.inject` con SQLite in memoria e client mockati.
- Smoke test manuale finale con token CardTrader e bot Telegram reali.

## 14. Fuori scope

- Più utenti / autenticazione.
- Acquisto automatico o aggiunta al carrello.
- Grafici dello storico prezzi.
- Spese di spedizione.
- Giochi diversi da Magic.
- Deployment su server / avvio automatico al login.
