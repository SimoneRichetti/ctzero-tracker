# CTZero Tracker — Storico prezzi — Design Spec

Data: 2026-10-16
Estende: `2026-10-02-ctzero-tracker-design.md` (di seguito "spec base") e `2026-10-07-sealed-products-design.md`.

## 1. Obiettivo

Rendere visibile lo storico dei prezzi già raccolto in `price_snapshots` e `sealed_price_snapshots`, oggi scritto a ogni sync ma mai esposto.

1. **Grafico per elemento** (priorità principale): per ogni carta e ogni sealed, un dialog con l'andamento del prezzo nel tempo, la soglia e i cambi di filtri.
2. **Colpo d'occhio in tabella**: nelle pagine Cards e Sealed una sparkline degli ultimi 30 giorni e la variazione % a 7 giorni.

Criteri di successo:
- da ogni riga di Cards e Sealed apro un dialog con il grafico del prezzo, scelgo il periodo (30 g / 90 g / Tutto) e vedo prezzo attuale, minimo e massimo;
- nel grafico vedo la soglia attuale, i punti "nessuna offerta" e dove ho cambiato i filtri (la linea si interrompe lì);
- in tabella vedo per ogni elemento la tendenza dell'ultimo mese e di quanto è sceso o salito il prezzo in 7 giorni, senza salti finti dovuti a cambi di filtri;
- lo storico raccolto prima di questa feature (dal 2026-10-02) è visibile subito.

### Decisioni
- **Nessuna migrazione**: gli snapshot hanno già `synced_at`, `price_cents` (nullable = nessuna offerta) e `config_version`.
- **Cambi di filtri**: il grafico mostra **tutto lo storico**, interrompe la linea dove cambia `config_version` e disegna un marcatore verticale "Filters changed". Sparkline, variazione % e statistiche del dialog usano **solo la configurazione attuale**.
- **Soglia**: nel grafico è una linea orizzontale con la soglia **attuale**. Gli snapshot non registrano la soglia del momento e non la aggiungiamo. Un cambio della sola soglia non incrementa `config_version`, quindi non produce marcatori.
- **Retention**: nessuna pulizia. Con un sync al giorno sono circa 365 righe all'anno per elemento.
- **Grafico**: Chart.js tramite `primevue/chart` (unica nuova dipendenza: `chart.js` in `web/package.json`). Soglia e marcatori sono disegnati da un plugin inline, senza `chartjs-plugin-annotation`. Asse X lineare su timestamp con formatter, senza date-adapter.
- **Sparkline**: componente SVG scritto a mano, senza libreria.
- **Lingua della UI**: inglese, come il resto dell'app. I testi in questa spec sono descrittivi; quelli effettivi sono in inglese ("Trend", "Price history", "Not enough data yet", "No offers", "Filters changed", "Threshold").

## 2. Trend (`server/src/pricing/trend.ts`, puro e testato)

```ts
export interface PriceTrend {
  /** Snapshot della configurazione attuale, prezzo non nullo, ultimi 30 giorni, in ordine cronologico. */
  sparkline: { t: string; priceCents: number }[];
  /** Variazione % (es. -12.3) tra l'ultimo snapshot e il riferimento a 7 giorni; null se non calcolabile. */
  change7dPct: number | null;
}

computeTrend(snapshots: Snapshot[], currentConfigVersion: number, now: Date): PriceTrend
```

Regole:
- si considerano solo gli snapshot con `configVersion === currentConfigVersion`;
- `sparkline`: quelli con `priceCents !== null` e `syncedAt >= now − 30 giorni`;
- `change7dPct`:
  - **ultimo** = lo snapshot più recente della configurazione attuale (nullo incluso); se ha `priceCents === null` → `null`;
  - **riferimento** = lo snapshot più recente con `priceCents !== null` e `syncedAt <= now − 7 giorni`, cercato negli ultimi 30 giorni; se non esiste (es. configurazione più giovane di 7 giorni) → `null`;
  - se anche l'**ultimo** ha `syncedAt <= now − 7 giorni` (dati vecchi: sync in errore o app spenta) → `null`;
  - altrimenti `(ultimo − riferimento) / riferimento × 100`, arrotondata a un decimale (mai `-0`).

`PriceTrend` va in `shared/src/types.ts`.

## 3. Repository

In `cards-repo.ts` e `sealed-repo.ts`, una query per lista, senza N+1:

- `listRecentSnapshotsByCard(db, sinceIso): Map<number, Snapshot[]>`: gli snapshot con `synced_at >= sinceIso` e `config_version` uguale a quella attuale della carta (JOIN con `tracked_cards`), ordinati per `id`;
- `listRecentSealedSnapshots(db, sinceIso): Map<number, Snapshot[]>`: lo stesso per `tracked_sealed`.

Le funzioni esistenti `listSnapshots` e `listSealedSnapshots` (tutto lo storico di un elemento) servono all'endpoint history.

## 4. API

### Liste arricchite
- `GET /api/cards` → `(TrackedCard & { trend: PriceTrend })[]`
- `GET /api/sealed` → `(TrackedSealed & { trend: PriceTrend })[]`

I tipi `TrackedCard` e `TrackedSealed` restano invariati. In `shared/src/types.ts` si aggiungono `TrackedCardRow = TrackedCard & { trend: PriceTrend }` e `TrackedSealedRow` (analogo). `list()` nei rispettivi service calcola il trend con `computeTrend(..., now)`, dove `now` arriva dal clock già iniettato nei service.

### Storico di un elemento
- `GET /api/cards/:id/history`
- `GET /api/sealed/:id/history`

Risposta:

```ts
export interface PriceHistoryDto {
  thresholdCents: number;
  configVersion: number;
  points: { syncedAt: string; priceCents: number | null; configVersion: number }[]; // ordine cronologico, tutto lo storico
}
```

Se l'elemento non esiste → 404, come gli altri endpoint `:id`. Il filtro per periodo lo applica il client.

## 5. UI

### Logica pura (`web/src/price-history.ts`, testata)
- `filterRange(points, range: '30d' | '90d' | 'all', now)`: i punti nel periodo.
- `buildSeries(points)` → `{ line: { x: number; y: number | null }[]; filterChanges: number[]; noOffers: number[] }`:
  - `line` contiene i punti con prezzo; un `null` dove cambia `configVersion` e al posto di ogni punto senza offerte, così la linea si interrompe;
  - `filterChanges` contiene i timestamp dei punti la cui `configVersion` differisce da quella del punto precedente **nel periodo** (se il periodo inizia a metà di una configurazione, il suo primo punto non è un cambio);
  - `noOffers` contiene i timestamp dei punti con `priceCents === null`.
- `axisBounds(points, thresholdCents)` → `{ min, max }` dell'asse Y (vedi sotto).
- `sparklinePoints(points, width, height)` → attributo `points` della polyline della sparkline (x proporzionale al tempo).
- `formatChange(pct)` → `{ text, cls }` per la colonna Trend.
- `summarize(points, currentConfigVersion)` → `{ current, min, max }` (centesimi o `null`): solo punti della configurazione attuale con prezzo non nullo; `current` è l'ultimo punto della configurazione attuale, `null` se senza offerte.

### `PriceSparkline.vue`
- Props: `points: PriceTrend['sparkline']`.
- SVG 80×24, polyline normalizzata tra min e max (linea piatta al centro se min = max).
- Con meno di 2 punti mostra "—".
- Emette `click`, che la pagina usa per aprire il dialog.

### Colonna "Trend" (`CardsPage.vue`, `SealedPage.vue`)
- Dopo "CT Zero price": sparkline con accanto `change7dPct` formattata con una cifra decimale e segno, in formato inglese come il resto della UI (`-12.3%`, `+5.0%`); il server la arrotonda già a un decimale.
- Colore: verde se < 0 (prezzo sceso, buona notizia per chi compra), rosso se > 0, neutro se 0; "—" se `null`.
- Nella colonna azioni, nuovo bottone icona `pi pi-chart-line` (tooltip "Price history") che apre il dialog, come il click sulla sparkline.

### `PriceHistoryDialog.vue`
- Props: `kind: 'card' | 'sealed'`, `id: number | null`, `name: string`, `v-model:visible`.
- All'apertura chiama l'endpoint history tramite il pattern di `latest-request.ts`, così una risposta vecchia non sovrascrive quella nuova.
- Intestazione: `SelectButton` 30 g / 90 g / Tutto (default 90 g) e tre valori: attuale, minimo, massimo (da `summarize` sui punti del periodo; "—" se `null`).
- Grafico (`primevue/chart`, tipo `line`):
  - asse X `linear` su timestamp ms, tick formattati `MM/DD` in ora locale (come `formatDateTime` e il resto della UI); asse Y in euro;
  - dataset prezzo da `buildSeries().line`, `spanGaps: false`, tooltip con data e ora locale e prezzo;
  - dataset scatter per `noOffers`, croci appoggiate al minimo dell'asse Y, tooltip "No offers";
  - plugin inline: linea orizzontale tratteggiata alla soglia con etichetta "Threshold", linee verticali tratteggiate a ogni `filterChanges` con etichetta "Filters changed". L'asse Y ha `min`/`max` espliciti (`axisBounds`: prezzi del periodo e soglia, con un margine del 10%), così la soglia e le croci "nessuna offerta" restano sempre visibili;
  - colori dalle variabili CSS di PrimeVue (es. `--p-primary-color`, `--p-text-muted-color`), letti all'apertura del dialog.
- Stati:
  - caricamento: spinner;
  - errore (incluso 404): messaggio inline;
  - niente da disegnare (meno di 2 punti con prezzo e nessun punto "nessuna offerta" nel periodo): "Not enough data yet", con l'eventuale unico prezzo nelle statistiche. Un periodo con soli "nessuna offerta" mostra il grafico con croci e soglia (§6).

## 6. Casi limite
- **Elemento appena aggiunto (1 snapshot)**: sparkline "—", variazione "—", dialog "Not enough data yet".
- **Intervalli irregolari** (app spenta, sync manuali ravvicinati): l'asse X è temporale, quindi le distanze restano corrette; per la variazione a 7 giorni vale la regola del §2.
- **Periodo con solo "nessuna offerta"**: nel grafico ci sono solo le croci e la soglia; le statistiche mostrano "—".
- **Ultimo snapshot senza offerte**: `change7dPct = null`, `current = null`.
- **Cambio filtri recente**: sparkline e variazione ripartono dalla nuova configurazione; il grafico mostra anche la configurazione precedente, separata dal marcatore.
- **Elemento cancellato con il dialog aperto**: 404, errore inline.
- **Fusi orari**: `synced_at` è in UTC ISO e la formattazione avviene nel browser.

## 7. Test
- `server/src/pricing/trend.test.ts`:
  - finestra di 30 giorni;
  - esclusione delle altre `config_version` e dei prezzi nulli dalla sparkline;
  - variazione a 7 giorni: scelta del riferimento con intervalli irregolari, `null` con storia più corta di 7 giorni, `null` con ultimo snapshot senza offerte.
- Repository (`repos.test.ts`, `sealed-repo.test.ts`): la query degli snapshot recenti esclude le versioni non attuali e quelli più vecchi di 30 giorni, raggruppando per elemento.
- `server/src/api/app.test.ts`:
  - `GET /api/cards` e `GET /api/sealed` includono `trend`;
  - `/history` restituisce tutti i punti in ordine, con 404 sugli id inesistenti.
- `web/src/price-history.test.ts`:
  - `filterRange`;
  - `buildSeries`: interruzioni ai cambi di versione e ai punti senza offerte, `filterChanges`, `noOffers`;
  - `summarize`: solo configurazione attuale, `current` nullo.
- Componenti Vue: nessun test automatico, come per quelli esistenti. Verifica manuale avviando l'app sui dati reali.

## 8. Fuori scope
- Preset di soglia basati sullo storico (es. "minimo ultimi 30/90 giorni").
- Storico delle soglie.
- Alert basati sul trend.
- Confronto di più elementi nello stesso grafico.
- Export dello storico.
- Pulizia o aggregazione degli snapshot vecchi.
