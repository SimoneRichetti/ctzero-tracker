# CTZero Tracker — Gruppi di carte e import di liste — Design Spec

Data: 2026-10-09
Estende: `2026-10-02-ctzero-tracker-design.md` (di seguito "spec base").

## 1. Obiettivo

Due feature per le **carte singole** (i sealed restano invariati):

1. **Gruppi**: raccogliere carte tracciate in gruppi nominati, consultarli (filtro + riepilogo) e modificarne più carte insieme (bulk edit).
2. **Import**: incollare una decklist testuale e tracciarne tutte le carte in un colpo, dopo una revisione con prezzi e soglie, mettendole in un gruppo nuovo, in uno esistente o in nessun gruppo.

Criteri di successo:
- posso creare, rinominare ed eliminare gruppi; ogni carta sta in al più un gruppo;
- nella pagina Cards filtro per gruppo (o "Tutte" / "Senza gruppo") e vedo un riepilogo: numero carte, quante sotto soglia, quante senza offerte o in errore, totale ai prezzi attuali e totale alle soglie;
- seleziono più carte e ne cambio in blocco soglia (fissa o % sotto il prezzo attuale), filtri (lingue, condizione minima, foil), gruppo, oppure le elimino;
- incollo una decklist (formato Moxfield/Archidekt/MTGA), vedo per ogni carta prezzo e soglia proposta, correggo, confermo, e le carte vengono create nel gruppo scelto.

### Decisioni
- **Gruppo = cartella (uno-a-molti)**: `tracked_cards.group_id` nullable. Eliminare un gruppo non elimina le carte: diventano "Senza gruppo".
- **Solo carte**, niente gruppi per i sealed.
- **Operazioni lente orchestrate dal client** (approccio A): bulk edit dei filtri, risoluzione e creazione dell'import sono sequenze di chiamate per-carta eseguite dal browser con barra di progresso e interruzione. Nessun job lato server: la scheda deve restare aperta durante l'operazione. Le operazioni veloci (soglia, gruppo, eliminazione) passano da un unico endpoint bulk transazionale.
- **Formato import: decklist testuale** incollata. Quantità e numero di collezione sono letti e ignorati (si traccia la carta, non le copie). Niente CSV.
- **Soglia all'import**: scelta tra "% sotto il prezzo attuale" e "€ fisso" come default, modificabile riga per riga in revisione.
- **Set indicato nella lista**: ignorato di default (si traccia qualsiasi espansione, coerente con "prezzo minimo"); opzione "Rispetta il set indicato".
- **Lingua della UI**: inglese, come il resto dell'app. Le etichette in questa spec sono descrittive; i testi effettivi sono in inglese ("All cards", "No group", "Import list", ...).
- **Carte già tracciate** nella lista: segnalate ed escluse di default; se incluse vengono create come **nuove** voci nel gruppo scelto, le voci esistenti non vengono spostate.

## 2. Modello dati

Migrazione 3 (`server/src/db/db.ts`):

```sql
CREATE TABLE card_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);
ALTER TABLE tracked_cards ADD COLUMN group_id INTEGER REFERENCES card_groups(id) ON DELETE SET NULL;
CREATE INDEX tracked_cards_group ON tracked_cards(group_id);
```

Tipi (`shared/src/types.ts`):
- `TrackedCard.groupId: number | null`.
- `CardGroup { id: number; name: string; cardCount: number; createdAt: string }`.

Schemi (`shared/src/schemas.ts`):
- `cardInputSchema` e `cardUpdateSchema` acquistano `groupId: z.number().int().positive().nullable().optional()`. Su `update`, `undefined` = non toccare; `null` = togli dal gruppo. Cambiare gruppo **non** incrementa `configVersion` né azzera prezzo/stato.
- `groupInputSchema = z.object({ name: z.string().trim().min(1).max(80) })`.
- `bulkCardsSchema` (§3).
- `importResolveSchema` (§5).

`cards-repo`: `group_id` in `CardRecord`, `COLUMNS`, `NewCard`, `insertCard`. Nuovo `groups-repo.ts`: `listGroups` (con `cardCount` via `LEFT JOIN … GROUP BY`), `getGroup`, `insertGroup`, `renameGroup`, `deleteGroup`. Nome duplicato → `ValidationError` (422).

## 3. API

### Gruppi
| Metodo | Path | Body | Risposta |
|---|---|---|---|
| GET | `/api/groups` | — | `CardGroup[]` ordinati per nome |
| POST | `/api/groups` | `{ name }` | 201 `CardGroup` |
| PUT | `/api/groups/:id` | `{ name }` | `CardGroup` |
| DELETE | `/api/groups/:id` | — | 204 (le carte passano a `group_id = NULL`) |

`POST/PUT /api/cards` accettano `groupId`; un `groupId` inesistente → 422.

### Bulk veloce
`POST /api/cards/bulk`, eseguito in **una transazione**:

```ts
{
  ids: number[];            // 1..500, deduplicati
  action:
    | { type: 'threshold'; mode: 'fixed'; cents: number }        // intero > 0
    | { type: 'threshold'; mode: 'percent'; percent: number }    // 1..90
    | { type: 'group'; groupId: number | null }
    | { type: 'delete' };
}
→ { updated: number[]; skipped: { id: number; reason: string }[] }
```

- `threshold` fixed: `thresholdCents = cents` per ogni carta, con `evaluateSilently(lastPriceCents, cents)` come nell'`update` singolo (nessuna notifica).
- `threshold` percent: `thresholdCents = round(lastPriceCents × (1 − percent/100))`, minimo 1. Carte con `lastPriceCents === null` → `skipped` con motivo "no current price".
- `group`: `groupId` inesistente → 422 per l'intera richiesta.
- `delete`: elimina.
- Id inesistenti → `skipped` con motivo "not found" (non fallisce l'intera richiesta).

Implementazione: metodo `CardService.bulk(input)` (DB-only, nessuna chiamata esterna).

### Bulk dei filtri
Nessun endpoint nuovo: il client chiama `PUT /api/cards/:id` per ogni carta (§4). Per ogni carta invia l'`update` completo con i campi scelti sostituiti e gli altri (incluse `expansionIds` e soglia) presi dalla carta stessa.

## 4. UI gruppi (pagina Cards, `/`)

**Selettore gruppo** sopra la tabella: `Select` con "Tutte", "Senza gruppo", poi i gruppi con il numero di carte. Il valore è nella query (`/?group=3`, `/?group=none`), così sopravvive al refresh. Accanto, pulsante "Gestisci gruppi" → dialog con elenco, crea, rinomina inline, elimina (con conferma che spiega che le carte restano tracciate).

**Riepilogo** (calcolato client-side sulle righe filtrate, funzione pura in `web/src/group-summary.ts`): numero carte, sotto soglia, senza offerte/in errore, totale prezzi attuali, totale soglie; se alcune carte non hanno prezzo, "(N senza prezzo)" accanto al totale attuale.

**Selezione**: `DataTable` con `selectionMode="multiple"` e colonna checkbox; la checkbox nell'header seleziona tutte le righe filtrate. La selezione si azzera al cambio gruppo e dopo ogni operazione bulk (che ricarica lista e gruppi).

**Toolbar bulk** (visibile con ≥1 selezionata): "N selezionate · Soglia… · Filtri… · Sposta in gruppo… · Elimina".
- **Soglia…**: dialog con toggle "€ fisso" / "% sotto il prezzo attuale" → una chiamata `bulk`; toast con quante aggiornate e quante saltate.
- **Sposta in gruppo…**: select gruppo (incluso "Nessun gruppo") con possibilità di crearne uno nuovo nel dialog → `bulk`.
- **Elimina**: conferma con il numero di carte → `bulk`.
- **Filtri…**: dialog con lingue, condizione minima, foil; ogni campo ha una checkbox "modifica" (i campi non spuntati restano quelli di ciascuna carta). Alla conferma, `PUT` sequenziali tramite il batch runner, con `ProgressBar` ("12/40") e "Interrompi"; al termine elenco errori per carta.

**CardDialog**: campo opzionale "Gruppo".

**Batch runner** (`web/src/batch-runner.ts`, puro e testato): esegue un task asincrono per elemento in sequenza; espone progresso (`done/total`), raccoglie errori per elemento senza fermarsi, si ferma su `abort()` dopo la richiesta in corso, e si ferma subito su un errore fatale (risposta API 503, vedi §6).

## 5. Import

### Parser (`shared/src/decklist.ts`, puro e testato)
`parseDecklist(text) → { lines: { name: string; setCode: string | null; foil: boolean; lineNo: number }[]; errors: { lineNo: number; text: string }[] }`

Riconosce, una carta per riga:
- `Sol Ring`
- `1 Sol Ring`, `4x Lightning Bolt`, `4 x Lightning Bolt`
- `1 Sol Ring (C21) 263`, `1 Sol Ring (C21)`, `1 Sol Ring [C21]`
- marcatori foil `*F*` / `*E*` (etched trattato come foil) in coda

Ignora righe vuote, commenti (`//…`, `#…`) e intestazioni di sezione (`Deck`, `Sideboard`, `Commander`, `Companion`, `Maybeboard`, con o senza `:`). Doppioni per nome (case-insensitive) uniti: vince la prima occorrenza, `foil` = OR. Righe non interpretabili → `errors`. Più di 250 carte → errore bloccante in UI.

### Risoluzione di una riga
`POST /api/import/resolve`:

```ts
// input (importResolveSchema)
{ name: string; setCode: string | null; respectSet: boolean;
  languages: Language[]; minCondition: Condition; foil: boolean }
// output
{ name: string; imageUrl: string | null; expansionIds: number[];
  priceCents: number | null; listing: Listing | null; alreadyTracked: boolean }
```

`ImportService.resolve` (`server/src/import/import-service.ts`):
1. `catalog.lookup(name)` (una sola volta) → 404 se non trovata.
2. Se `respectSet && setCode`: `expansionIds = [printing con code uguale (case-insensitive)]`; se il set non esiste tra le printings → 422 "Set XYZ not found for <name>". Altrimenti `expansionIds = []`.
3. `catalog.resolveBlueprints` + `priceCard` come `CardService.preview`.
4. `alreadyTracked` = esiste una `tracked_card` con lo stesso `scryfall_oracle_id`.

### Cache dei blueprint
`Catalog` mette in cache in memoria `ct.blueprints(expansionId)` per 1 ora (stesso schema di `expansionsCache`, `Map<expansionId, {fetchedAt, list}>`), così il `create` dopo la revisione e il sync non ripetono le chiamate.

### UI (`/import`, pulsante "Importa lista" nella pagina Cards)
1. **Incolla e opzioni**
   - textarea; sotto, anteprima del parse ("42 carte, 2 righe non riconosciute" con elenco);
   - lingue, condizione minima, foil di default (il `*F*` di riga vince);
   - "Rispetta il set indicato" (default off);
   - soglia di default: "% sotto il prezzo attuale" (default 10) oppure "€ fisso";
   - **Gruppo**: "Nuovo gruppo" (nome obbligatorio, non deve esistere già), "Gruppo esistente" (select), "Nessun gruppo". Il nuovo gruppo **non** viene creato finché non si conferma al passo 3.
2. **Risoluzione**: batch runner su `resolve`, progresso e "Interrompi" (le righe già risolte restano utilizzabili).
3. **Revisione**: tabella con checkbox "includi", miniatura, nome, prezzo attuale, soglia (`InputNumber` in €), stato.
   - *OK*: inclusa, soglia proposta secondo il default.
   - *Già tracciata*: esclusa di default, includibile.
   - *Nessuna offerta*: in modalità % nessuna soglia proposta → esclusa finché non si inserisce una soglia a mano; in modalità fissa, inclusa con la soglia fissa.
   - *Non trovata* / *Errore*: non includibile, mostra il messaggio.
   - "Conferma": se "Nuovo gruppo", `POST /api/groups` (se fallisce, ci si ferma qui); poi batch runner su `POST /api/cards` con `{ name, expansionIds, languages, minCondition, foil, thresholdCents, groupId }`. Riepilogo finale "38 create, 2 errori" con elenco errori e link a `/?group=<id>`.

## 6. Errori

- Errori per riga/carta nei batch: raccolti, il batch prosegue, elenco mostrato alla fine.
- Errori fatali di CardTrader (token mancante o invalido): oggi il server li restituisce come 502 (`HttpError`). Per permettere al client di fermarsi, l'error handler mappa gli `HttpError` con `isFatalHttpError` su **503** con messaggio esplicito; il batch runner tratta 503 come fatale e si ferma.
- "Interrompi": la richiesta in corso termina, poi il batch si ferma; quanto fatto resta fatto.
- Bulk veloce: transazionale, o tutto o niente (salvo gli `skipped`, che sono esiti normali).

## 7. Test

- `shared/src/decklist.test.ts`: tutti i formati di §5, intestazioni, commenti, foil, doppioni, righe invalide.
- `server/src/db/groups-repo.test.ts`: CRUD, nome duplicato case-insensitive, `cardCount`, `ON DELETE SET NULL`.
- `server/src/cards/card-service.test.ts`: `bulk` per ogni azione, percent senza prezzo, id inesistenti, `groupId` inesistente, cambio gruppo che non tocca `configVersion`.
- `server/src/import/import-service.test.ts`: set rispettato/ignorato, set inesistente, carta non trovata, `alreadyTracked`.
- `server/src/catalog/catalog.test.ts`: cache blueprint (hit entro TTL, refetch dopo).
- `server/src/api/app.test.ts`: route gruppi, bulk, import/resolve, mapping 503.
- `web/src/batch-runner.test.ts`: progresso, raccolta errori, abort, stop su fatale.
- `web/src/group-summary.test.ts`: totali con prezzi mancanti.

## 8. Fuori scope

Gruppi per i sealed; carte in più gruppi; quantità/copie; import CSV o da URL di Moxfield/Archidekt; job di import lato server; notifiche Telegram raggruppate per gruppo.
