# CTZero Tracker — Sealed products — Design Spec

Data: 2026-10-07
Estende: `2026-10-02-ctzero-tracker-design.md` (di seguito "spec base").

## 1. Obiettivo

Tracciare, oltre alle carte singole, il prezzo minimo **CardTrader Zero** di prodotti sealed Magic (booster, box, bundle, precon Commander, Secret Lair, collector box, ...), con la stessa dinamica di soglia e notifica Telegram delle carte.

Criteri di successo:
- posso aggiungere un prodotto sealed scegliendo espansione → prodotto, oppure incollando il link CardTrader;
- posso filtrare per lingua (o "qualsiasi") e impostare una soglia, aiutato dagli stessi preset delle carte;
- vedo i sealed in una pagina dedicata con prezzo, soglia, stato, ultimo aggiornamento;
- i sealed sono aggiornati nello stesso giro delle carte e notificati nello stesso report Telegram.

### Decisioni
- **Definizione di sealed (larga):** tutto ciò che si compra chiuso: booster, box, bundle, precon, starter, prerelease, Secret Lair, set completi. Esclusi singole, token, oversized e tutti gli accessori. Implementata come **whitelist di `category_id`** CardTrader (§2).
- **Unico filtro: lingua.** `[]` = qualsiasi. Nessun filtro su condizione né foil.
- **Selezione:** espansione → prodotto come flusso principale; link CardTrader (o ID blueprint) come alternativa.
- **UI:** pagina "Sealed" separata, nuova voce nella barra in alto.
- **Backend:** tabella e servizio separati dalle carte; funzioni pure condivise (regole di notifica, preset, report, filtro inserzioni). Le carte esistenti e i loro test restano invariati salvo il refactoring di `isValidListing` (§5).
- Nessun vincolo di unicità su `blueprint_id`: la lingua è una proprietà dell'inserzione, quindi lo stesso box può essere tracciato una volta in EN e una in JP.

## 2. Esito dello spike sull'API (2026-10-07)

Verificato con chiamate reali di sola lettura.

**Categorie Magic (`GET /categories?game_id=1`).** Ogni blueprint di `GET /blueprints/export` ha `category_id`, `image_url` (miniatura `preview_…`) e, per i sealed, `scryfall_id: null`. Categorie considerate sealed (whitelist, nomi mostrati in UI):

| id | nome CardTrader | nome mostrato |
|---|---|---|
| 4 | Magic Booster Boxes | Booster Box |
| 5 | Magic Boosters | Booster |
| 6 | Magic Complete Sets | Complete Set |
| 7 | Magic Starter Decks | Starter Deck |
| 10 | Magic Theme & Extra Box Sets | Box Set |
| 13 | Magic Boxed Set | Boxed Set |
| 17 | Magic Preconstructed Decks | Preconstructed Deck |
| 23 | Magic Bundles and Fat Packs | Bundle |
| 24 | Magic Tournament Prerelease Packs | Prerelease Pack |

Escluse: 1 singole, 2 token, 3 oversized, 8 packaging vuoto, 9 libri, 12 bustine protettive, 15 album, 16 deck box, 18 gadget, 19 playmat, 20 segnavita, 21 storage, 22 dadi, 25 divisori, 26 pagine raccoglitore, 43 uncut sheet, 164 poster, 271 tin, 317 espositori. Nessuna chiamata a `/categories` a runtime: la whitelist è una costante.

I nomi dei blueprint possono contenere entità HTML (`&amp;`): vanno decodificati (`&amp;`, `&quot;`, `&#39;`, `&lt;`, `&gt;`).

**Inserzioni sealed (`/marketplace/products`).**
- Nessuna `condition`; `properties_hash.mtg_language` presente; il parametro `language` filtra correttamente.
- I Secret Lair (cat. 13) hanno la proprietà `properties_hash.sealed` (`true`/`false`): si vendono anche aperti. **Le inserzioni con `sealed === false` sono scartate.**
- Ogni inserzione contiene `name_en` ed `expansion: { id, code, name_en }`.

**Link e risoluzione per ID.** I link del sito hanno la forma `https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit` → l'ID del blueprint è il numero dopo `/cards/`. Non esiste un endpoint per leggere un singolo blueprint: la risoluzione passa da `/marketplace/products?blueprint_id=X` (→ espansione dell'inserzione) e poi da `blueprints/export` di quell'espansione (→ nome, categoria, immagine). Se il prodotto non ha alcuna inserzione non è identificabile: 422 con invito a selezionarlo dall'espansione.

## 3. Modello dati (migrazione 2)

### `tracked_sealed`
| campo | tipo | note |
|---|---|---|
| `id` | int PK | |
| `name` | text | nome del blueprint su CardTrader |
| `blueprint_id` | int | blueprint CardTrader (fisso, scelto dall'utente) |
| `expansion_id` | int | |
| `expansion_name` | text | |
| `category_name` | text | nome mostrato da `SEALED_CATEGORIES` (es. "Booster Box", "Preconstructed Deck") |
| `image_url` | text nullable | dal blueprint CardTrader |
| `languages` | JSON text[] | codici lingua CardTrader; `[]` = qualsiasi |
| `threshold_cents` | int | |
| `config_version` | int | +1 a ogni cambio lingue |
| `last_price_cents` | int nullable | |
| `last_listing` | JSON nullable | stesso formato `Listing` delle carte |
| `last_synced_at` | datetime nullable | |
| `last_sync_status` | text nullable | `ok` / `no_offers` / `error` |
| `last_error` | text nullable | |
| `alert_state` | text nullable | `above` / `below` |
| `last_notified_price_cents` | int nullable | |
| `created_at`, `updated_at` | datetime | |

Nessuna risoluzione periodica dei blueprint: il blueprint è fisso.

### `sealed_price_snapshots`
`tracked_sealed_id` (FK, cascade), `config_version`, `synced_at`, `price_cents` (nullable). Come `price_snapshots`.

### `sync_runs`
Invariata. `cards_total` / `cards_done` / `cards_error` contano tutti gli elementi del giro (carte + sealed); la UI di avanzamento non cambia.

### Tipi condivisi (`shared/`)
- `TrackedSealed`: DTO con i campi sopra in camelCase.
- `SealedProduct`: `{ blueprintId, name, expansionId, expansionName, categoryName, imageUrl }` (voce del catalogo / risultato di risoluzione).
- `Expansion`: `{ id, code, name }`.
- `Listing.condition` e `Listing.foil` restano; per i sealed `condition` è la stringa ricevuta (eventualmente vuota) e `foil` è `false`.

## 4. Catalogo sealed (`catalog/`)

Nuovo `SealedCatalog` (`catalog/sealed-catalog.ts`) che riusa `Catalog.mtgExpansions()`:
- `SEALED_CATEGORIES`: costante `category_id → nome mostrato` (§2).
- `sealedProducts(expansionId)`: `GET /blueprints/export?expansion_id=X` filtrato sulla whitelist, nomi decodificati, ordinato per nome → `SealedProduct[]`.
- `sealedProduct(blueprintId)`: risoluzione per ID come in §2; `ValidationError` se senza inserzioni o non sealed.
- `parseBlueprintRef(input)`: funzione pura; accetta un ID numerico o un link CardTrader (`/cards/<id>-…`) e restituisce l'ID del blueprint, oppure `ValidationError`.

Client CardTrader: `CtBlueprint` esteso con `category_id` e `image_url`; `CtProduct` con `expansion` e `properties_hash.sealed`; `products()` con `foil` opzionale.

## 5. Calcolo del prezzo (`pricing/`)

`isValidListing` è diviso in:
- `isValidBaseListing(p, languages)`: CT Zero (`user.can_sell_via_hub === true`), `quantity > 0`, non `on_vacation`, non `altered` / `signed` / `graded`, `currency === "EUR"`, lingua in `languages` (o `languages` vuoto);
- `isValidListing(p, filter)` (carte) = base + condizione minima + foil.
- `isValidSealedListing(p, languages)` = base + `properties_hash.sealed !== false`. Comportamento delle carte invariato (i test esistenti devono continuare a passare senza modifiche).

`priceSealed(ct, product, languages)`: una chiamata `/marketplace/products?blueprint_id=X` per lingua scelta (nessun parametro `language` se qualsiasi), senza parametro `foil`; prezzo = minimo `price.cents` tra le inserzioni che passano `isValidSealedListing`. Esito `ok` con prezzo + `Listing` (URL `https://www.cardtrader.com/cards/<blueprint_id>`, `expansionName` del prodotto) oppure `no_offers`.

Preset soglia: `thresholdPresets` invariato.

## 6. Servizio sealed (`sealed/sealed-service.ts`)

Speculare a `CardService`:
- `list()`.
- `preview({ blueprintId, languages })` → `PreviewResult` (prezzo, inserzione, preset; `blueprintCount = 1`).
- `create({ blueprintId, languages, thresholdCents })`: il server risolve i dati del prodotto con `sealedProduct(blueprintId)` (non si fida di nome/espansione dal client), inserisce la riga, aggiorna subito il prezzo con **valutazione silenziosa**.
- `update(id, { languages, thresholdCents })`:
  - lingue cambiate → `config_version += 1`, reset di `last_price_cents`, `last_listing`, `last_synced_at`, `last_sync_status`, `last_error`, `alert_state`, `last_notified_price_cents`; aggiornamento immediato silenzioso;
  - solo soglia → nessuna chiamata a CardTrader; `evaluateSilently(last_price_cents, soglia)`.
- `delete(id)`.
- Errore CardTrader durante l'aggiornamento immediato → `last_sync_status=error`, `last_error`, come per le carte.

## 7. Giro di aggiornamento e notifiche

`SyncService`:
- `start()`: totale = numero carte + numero sealed; elenca gli ID di entrambi all'avvio.
- Elabora prima le carte (invariato), poi i sealed, in sequenza e con lo stesso throttling.
- Per ogni sealed: `priceSealed` → `evaluateAlert` (invariata, stesse regole della spec base §6) → in transazione, solo se il prodotto esiste ancora con stessi `config_version` e `threshold_cents`: snapshot + aggiornamento riga. Altrimenti il risultato è scartato e non notificato.
- Errore su un singolo sealed → `last_sync_status=error`, voce nella sezione "Errori" del report, giro `partial`. Errore globale (401/403) → giro interrotto come oggi.
- `cards_done` incrementato anche per i sealed.

Report (`alerts/report.ts`):
- `ReportItem` e `ReportError` passano da `cardName` a `name` e acquisiscono `kind: 'card' | 'sealed'`.
- Stesse sezioni e stesso ordine; all'interno di ogni sezione prima le carte poi i sealed.
- Riga sealed: prefisso 📦; dettagli tra parentesi = `expansionName` e lingua dell'inserzione (niente condizione né foil). Esempio:

```
🟢 Below threshold
• Ragavan, Nimble Pilferer (MH2, NM, EN) — 38,50 € (threshold 40,00 €, 1,50 € below) → link
• 📦 Modern Horizons 3 Play Booster Box (Modern Horizons 3, EN) — 189,00 € (threshold 200,00 €, 11,00 € below) → link
```

Le regole di notifica (`alerts/rules.ts`) restano invariate.

## 8. API REST

| Metodo | Rotta | Descrizione |
|---|---|---|
| GET | `/api/sealed` | lista sealed tracciati |
| POST | `/api/sealed` | crea `{blueprintId, languages, thresholdCents}` → 201 |
| PUT | `/api/sealed/:id` | modifica `{languages, thresholdCents}` |
| DELETE | `/api/sealed/:id` | elimina → 204 |
| POST | `/api/sealed/preview` | `{blueprintId, languages}` → `PreviewResult` |
| GET | `/api/expansions` | espansioni Magic CardTrader (`Expansion[]`) |
| GET | `/api/sealed/catalog?expansionId=` | `SealedProduct[]` dell'espansione |
| GET | `/api/sealed/resolve?ref=` | link o ID → `SealedProduct` |

Schemi zod in `shared/` (`sealedInputSchema`, `sealedUpdateSchema`, `sealedPreviewSchema`). Errori: 400 input non valido, 404 sealed non trovato, 422 blueprint inesistente / non sealed / link non riconosciuto, 502 errore CardTrader.

## 9. UI

- Barra in alto: **Cards · Sealed · Settings**; rotta `/sealed`.
- **Pagina "Sealed"**: `SyncHeader` e `HealthBanner` condivisi. Tabella: miniatura (con anteprima ingrandita al passaggio del mouse, come per le carte), nome, espansione, categoria, chip lingue, prezzo attuale, soglia, delta %, stato, ultimo aggiornamento, azioni (modifica, elimina con conferma, apri su CardTrader). Ordinamento di default: sotto soglia in cima.
- `card-status.ts` reso generico sui campi comuni (`lastSyncStatus`, `alertState`, `lastPriceCents`, `thresholdCents`, `name`) così da servire entrambe le pagine.
- **Dialog "Aggiungi / Modifica sealed"**:
  1. Selettore **Da espansione / Da link** (solo in creazione; in modifica il prodotto è fisso e mostrato in sola lettura).
     - Da espansione: autocompletamento sulle espansioni (filtro lato client su `/api/expansions`), poi select del prodotto da `/api/sealed/catalog` con miniatura e categoria.
     - Da link: campo di testo; alla conferma chiama `/api/sealed/resolve` e mostra il prodotto trovato.
  2. Lingue: multiselect + "qualsiasi".
  3. "Calcola prezzo" → anteprima prezzo + inserzione; preset + campo libero in euro → Salva.

## 10. Gestione errori

- Espansione senza sealed → select vuoto con messaggio "Nessun prodotto sealed per questa espansione".
- Link non riconosciuto o blueprint non sealed → 422 con messaggio esplicito nel dialog.
- Errori CardTrader in catalogo/anteprima → messaggio nel dialog; i sealed già tracciati non sono impattati.

## 11. Test

- Unit su funzioni pure: `isValidSealedListing` (nessun controllo condizione/foil, scarto di `sealed === false`), `parseBlueprintRef`, righe 📦 e ordinamento nel report, `card-status` generico.
- `priceSealed` con client finto (una chiamata per lingua, nessun `foil`).
- `SealedCatalog`: fixture ricavate dalle risposte reali dello spike (blueprint sealed e non, inserzioni con `expansion`).
- `SealedService`: creazione con valutazione silenziosa, cambio lingue vs solo soglia, errore in aggiornamento immediato.
- `SyncService`: giro misto carte + sealed (totali, report unico), sealed eliminato o modificato durante il giro, errore su un sealed → `partial`.
- API: `fastify.inject` sulle nuove rotte, SQLite in memoria.
- Migrazione: un DB alla versione 1 con carte esistenti migra alla 2 senza perdita di dati.
- Smoke test manuale finale con token reali (un box, un precon Commander).

## 12. Fuori scope

- Storico prezzi e grafici.
- Giochi diversi da Magic.
- Tracciamento "per categoria/espansione" (es. "qualsiasi box di MH3").
- Filtro per condizione sui sealed.
- Spese di spedizione.
