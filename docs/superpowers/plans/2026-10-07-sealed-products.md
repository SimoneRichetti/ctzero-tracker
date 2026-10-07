# Sealed Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tracciare il prezzo minimo CardTrader Zero di prodotti sealed Magic (box, booster, bundle, precon, Secret Lair, ...) con la stessa dinamica soglia/notifica delle carte.

**Architecture:** Nuova tabella `tracked_sealed` con repository e `SealedService` propri, speculari a quelli delle carte. Funzioni pure condivise: regole di notifica (invariate), preset, report (esteso con `kind`), filtro inserzioni (diviso in parte comune + parte carte + parte sealed). Un nuovo `SealedCatalog` trova i sealed di un'espansione via `blueprints/export` filtrando una whitelist di `category_id`. `SyncService` elabora carte poi sealed nello stesso giro e manda un unico report. UI: pagina `/sealed` con tabella e dialog.

**Tech Stack:** TypeScript, Node 24 (`node:sqlite`), Fastify 5, zod 4, Vitest, Vue 3 + PrimeVue 4.

**Spec:** `docs/superpowers/specs/2026-10-07-sealed-products-design.md` (estende `docs/superpowers/specs/2026-10-02-ctzero-tracker-design.md`).

## Global Constraints

- **Niente `git commit`**: l'utente committa solo su richiesta esplicita. Nessuno step di commit in questo piano; a fine task riportare solo che le modifiche sono pronte.
- Nessuna libreria aziendale (niente FuturaUI); UI solo con PrimeVue già presente.
- Prezzi sempre in centesimi di euro interi; solo inserzioni con `currency === "EUR"`.
- CT Zero ⇔ `user.can_sell_via_hub === true` — regola assoluta.
- Codice, commenti, messaggi d'errore e testi UI in **inglese** (come il resto del repo).
- Comportamento delle carte invariato: i test esistenti delle carte devono passare (gli unici test esistenti modificati sono quelli del report, per il rename `cardName` → `name` + `kind`).
- Whitelist categorie sealed (`category_id → nome mostrato`): 4 Booster Box, 5 Booster, 6 Complete Set, 7 Starter Deck, 10 Box Set, 13 Boxed Set, 17 Preconstructed Deck, 23 Bundle, 24 Prerelease Pack.
- Inserzioni sealed con `properties_hash.sealed === false` sono scartate.
- Link CardTrader: `https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit` → blueprint `389300`.
- Comandi: `npm test` (Vitest, tutti i workspace), `npm run typecheck`, `npm run build`. Un singolo file: `npx vitest run <path>`.

## Review Focus

1. **Secret Lair aperto più economico del sigillato** → deve vincere l'inserzione sigillata (Task 3, test `isValidSealedListing` + `priceSealed`).
2. **Nomi CardTrader con entità HTML** (`Beadle &amp; Grimm's`) → mostrati e salvati decodificati, e nel report Telegram ri-escapati una sola volta (Task 4 test `decodeEntities`/`sealedProducts`, Task 6 test escape).
3. **Link incollato con spazi, query string o solo slug senza ID** → spazi e query tollerati; slug senza ID → 422 chiaro, non 500 (Task 4 test `parseBlueprintRef`, Task 7 test API).
4. **Prodotto senza inserzioni risolto via link, o ID di una carta singola** → 422 con messaggio che rimanda alla selezione per espansione / "not a sealed product" (Task 4).
5. **Errore 401 durante le carte** → il giro si ferma e i sealed non vengono toccati; **sealed eliminato o con soglia cambiata durante il giro** → nessuna scrittura né notifica (Task 6).

---

## File Structure

**Create**
- `server/src/db/sealed-repo.ts` — CRUD `tracked_sealed` + snapshot.
- `server/src/db/sealed-repo.test.ts`
- `server/src/pricing/sealed-pricer.ts` — `priceSealed`.
- `server/src/pricing/sealed-pricer.test.ts`
- `server/src/catalog/sealed-catalog.ts` — whitelist categorie, `decodeEntities`, `parseBlueprintRef`, `SealedCatalog`.
- `server/src/catalog/sealed-catalog.test.ts`
- `server/src/sealed/sealed-service.ts` — `SealedService`.
- `server/src/sealed/sealed-service.test.ts`
- `web/src/components/SealedDialog.vue`
- `web/src/pages/SealedPage.vue`

**Modify**
- `shared/src/types.ts`, `shared/src/schemas.ts`, `shared/src/schemas.test.ts`
- `server/src/db/db.ts` (migrazione 2)
- `server/src/clients/cardtrader-types.ts`, `server/src/clients/cardtrader.ts`
- `server/src/pricing/listings.ts`, `server/src/pricing/listings.test.ts`
- `server/src/alerts/report.ts`, `server/src/alerts/report.test.ts`
- `server/src/sync/sync-service.ts`, `server/src/sync/sync-service.test.ts`
- `server/src/api/app.ts`, `server/src/api/app.test.ts`, `server/src/main.ts`
- `web/src/card-status.ts`, `web/src/card-status.test.ts`, `web/src/router.ts`, `web/src/App.vue`, `web/src/components/SyncHeader.vue`
- `README.md`

---

### Task 1: Tipi e schemi condivisi

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/schemas.ts`
- Test: `shared/src/schemas.test.ts`

**Interfaces:**
- Produces (da `@ctzero/shared`):
  - `interface Expansion { id: number; code: string; name: string }`
  - `interface SealedProduct { blueprintId: number; name: string; expansionId: number; expansionName: string; categoryName: string; imageUrl: string | null }`
  - `interface TrackedSealed` (campi sotto)
  - `sealedPreviewSchema` / `type SealedPreview = { blueprintId: number; languages: Language[] }`
  - `sealedInputSchema` / `type SealedInput = SealedPreview & { thresholdCents: number }`
  - `sealedUpdateSchema` / `type SealedUpdate = { languages: Language[]; thresholdCents: number }`

- [ ] **Step 1: Write the failing test** — aggiungere in fondo a `shared/src/schemas.test.ts` (e aggiungere `sealedInputSchema, sealedPreviewSchema, sealedUpdateSchema` all'import esistente da `./schemas`):

```ts
describe('sealed schemas', () => {
  const sealed = { blueprintId: 279368, languages: ['en', 'jp'], thresholdCents: 20000 };

  it('accepts valid input', () => {
    expect(sealedInputSchema.safeParse(sealed).success).toBe(true);
    expect(sealedPreviewSchema.safeParse({ blueprintId: 1, languages: [] }).success).toBe(true);
  });

  it('rejects invalid blueprint ids, thresholds and languages', () => {
    expect(sealedInputSchema.safeParse({ ...sealed, blueprintId: 0 }).success).toBe(false);
    expect(sealedInputSchema.safeParse({ ...sealed, blueprintId: 1.5 }).success).toBe(false);
    expect(sealedInputSchema.safeParse({ ...sealed, thresholdCents: 0 }).success).toBe(false);
    expect(sealedInputSchema.safeParse({ ...sealed, languages: ['xx'] }).success).toBe(false);
  });

  it('update ignores the blueprint', () => {
    expect(sealedUpdateSchema.parse(sealed)).toEqual({ languages: ['en', 'jp'], thresholdCents: 20000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/src/schemas.test.ts`
Expected: FAIL — `sealedInputSchema` non esportato (undefined).

- [ ] **Step 3: Implement** — in fondo a `shared/src/schemas.ts`, prima di `settingsSchema`:

```ts
export const sealedPreviewSchema = z.object({
  blueprintId: z.number().int().positive(),
  languages: z.array(z.enum(LANGUAGES)),
});
export type SealedPreview = z.infer<typeof sealedPreviewSchema>;

export const sealedInputSchema = sealedPreviewSchema.extend({
  thresholdCents: z.number().int().positive(),
});
export type SealedInput = z.infer<typeof sealedInputSchema>;

export const sealedUpdateSchema = sealedInputSchema.omit({ blueprintId: true });
export type SealedUpdate = z.infer<typeof sealedUpdateSchema>;
```

In `shared/src/types.ts`, dopo `CardLookupDto`:

```ts
export interface Expansion {
  id: number;
  code: string;
  name: string;
}

/** A sealed product on CardTrader (one blueprint). */
export interface SealedProduct {
  blueprintId: number;
  name: string;
  expansionId: number;
  expansionName: string;
  /** Display name from the sealed category whitelist (e.g. "Booster Box"). */
  categoryName: string;
  imageUrl: string | null;
}

export interface TrackedSealed {
  id: number;
  name: string;
  blueprintId: number;
  expansionId: number;
  expansionName: string;
  categoryName: string;
  imageUrl: string | null;
  /** [] = any language. */
  languages: Language[];
  thresholdCents: number;
  configVersion: number;
  lastPriceCents: number | null;
  lastListing: Listing | null;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus | null;
  lastError: string | null;
  alertState: AlertState | null;
  lastNotifiedPriceCents: number | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/src/schemas.test.ts`
Expected: PASS.

---

### Task 2: Migrazione 2 e repository sealed

**Files:**
- Modify: `server/src/db/db.ts` (array `MIGRATIONS`)
- Create: `server/src/db/sealed-repo.ts`
- Test: `server/src/db/sealed-repo.test.ts`

**Interfaces:**
- Consumes: `TrackedSealed`, `Listing` (Task 1); `Snapshot` da `./cards-repo` (`{ configVersion: number; syncedAt: string; priceCents: number | null }`).
- Produces (da `server/src/db/sealed-repo.ts`):
  - `type NewSealed = { name; blueprintId; expansionId; expansionName; categoryName; imageUrl: string | null; languages: Language[]; thresholdCents: number }`
  - `type SealedPatch = Partial<Omit<TrackedSealed, 'id' | 'createdAt' | 'updatedAt'>>`
  - `listSealed(db): TrackedSealed[]`, `getSealed(db, id): TrackedSealed | null`
  - `insertSealed(db, s: NewSealed, now?: Date): TrackedSealed`
  - `updateSealed(db, id, patch: SealedPatch, now?: Date): TrackedSealed` (lancia `NotFoundError('Sealed product not found')`)
  - `deleteSealed(db, id): boolean`
  - `insertSealedSnapshot(db, s: Snapshot & { sealedId: number }): void`, `listSealedSnapshots(db, sealedId): Snapshot[]`

- [ ] **Step 1: Write the failing test** — `server/src/db/sealed-repo.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Listing } from '@ctzero/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors';
import { insertCard, listCards } from './cards-repo';
import { MIGRATIONS, openDb, type Db } from './db';
import {
  deleteSealed,
  getSealed,
  insertSealed,
  insertSealedSnapshot,
  listSealed,
  listSealedSnapshots,
  updateSealed,
  type NewSealed,
} from './sealed-repo';

const t0 = new Date('2026-10-07T10:00:00.000Z');
const t1 = new Date('2026-10-07T11:00:00.000Z');
const box: NewSealed = {
  name: 'Modern Horizons 3: Play Booster Box',
  blueprintId: 279368,
  expansionId: 3627,
  expansionName: 'Modern Horizons 3',
  categoryName: 'Booster Box',
  imageUrl: 'https://cardtrader.com/uploads/blueprints/image/279368/preview_x.jpg',
  languages: ['en'],
  thresholdCents: 20000,
};
const listing: Listing = {
  productId: 9,
  blueprintId: 279368,
  expansionName: 'Modern Horizons 3',
  condition: '',
  language: 'en',
  foil: false,
  priceCents: 19000,
  url: 'https://www.cardtrader.com/cards/279368',
};

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('sealed-repo', () => {
  it('inserts with defaults and reads back', () => {
    const s = insertSealed(db, box, t0);
    expect(s).toEqual({
      id: s.id,
      ...box,
      configVersion: 1,
      lastPriceCents: null,
      lastListing: null,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastError: null,
      alertState: null,
      lastNotifiedPriceCents: null,
      createdAt: t0.toISOString(),
      updatedAt: t0.toISOString(),
    });
    expect(getSealed(db, s.id)).toEqual(s);
    expect(getSealed(db, 999)).toBeNull();
  });

  it('lists by name and allows the same blueprint twice', () => {
    insertSealed(db, { ...box, name: 'Zeta Box' }, t0);
    insertSealed(db, { ...box, name: 'alpha box' }, t0);
    insertSealed(db, { ...box, name: 'alpha box', languages: ['jp'] }, t0);
    expect(listSealed(db).map((s) => s.name)).toEqual(['alpha box', 'alpha box', 'Zeta Box']);
  });

  it('updates JSON, nullable fields and updated_at', () => {
    const s = insertSealed(db, box, t0);
    const u = updateSealed(
      db,
      s.id,
      { languages: ['en', 'jp'], lastListing: listing, lastPriceCents: 19000, alertState: 'below' },
      t1,
    );
    expect(u).toMatchObject({ languages: ['en', 'jp'], lastListing: listing, lastPriceCents: 19000, alertState: 'below' });
    expect(u.updatedAt).toBe(t1.toISOString());
    expect(updateSealed(db, s.id, { lastListing: null }, t1).lastListing).toBeNull();
  });

  it('update and delete of a missing row', () => {
    expect(() => updateSealed(db, 42, { thresholdCents: 1 })).toThrow(NotFoundError);
    expect(deleteSealed(db, 42)).toBe(false);
  });

  it('snapshots are cascaded on delete', () => {
    const s = insertSealed(db, box, t0);
    insertSealedSnapshot(db, { sealedId: s.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 19000 });
    insertSealedSnapshot(db, { sealedId: s.id, configVersion: 1, syncedAt: t1.toISOString(), priceCents: null });
    expect(listSealedSnapshots(db, s.id)).toEqual([
      { configVersion: 1, syncedAt: t0.toISOString(), priceCents: 19000 },
      { configVersion: 1, syncedAt: t1.toISOString(), priceCents: null },
    ]);
    expect(deleteSealed(db, s.id)).toBe(true);
    expect(listSealedSnapshots(db, s.id)).toEqual([]);
  });
});

describe('migration 2', () => {
  it('upgrades a version-1 database keeping existing cards', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ctzero-')), 'v1.db');
    const v1 = new DatabaseSync(path);
    v1.exec(MIGRATIONS[0]!);
    v1.exec('PRAGMA user_version = 1');
    insertCard(v1, {
      name: 'Lightning Bolt',
      scryfallOracleId: 'o',
      imageUrl: null,
      expansionIds: [],
      languages: [],
      minCondition: 'Near Mint',
      foil: false,
      thresholdCents: 100,
    });
    v1.close();

    const db2 = openDb(path);
    const { user_version } = db2.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(user_version).toBe(2);
    expect(listCards(db2).map((c) => c.name)).toEqual(['Lightning Bolt']);
    expect(listSealed(db2)).toEqual([]);
    db2.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/db/sealed-repo.test.ts`
Expected: FAIL — modulo `./sealed-repo` non trovato.

- [ ] **Step 3: Implement**

In `server/src/db/db.ts`, aggiungere un secondo elemento all'array `MIGRATIONS` (dopo la stringa esistente):

```ts
  `
  CREATE TABLE tracked_sealed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    blueprint_id INTEGER NOT NULL,
    expansion_id INTEGER NOT NULL,
    expansion_name TEXT NOT NULL,
    category_name TEXT NOT NULL,
    image_url TEXT,
    languages TEXT NOT NULL DEFAULT '[]',
    threshold_cents INTEGER NOT NULL,
    config_version INTEGER NOT NULL DEFAULT 1,
    last_price_cents INTEGER,
    last_listing TEXT,
    last_synced_at TEXT,
    last_sync_status TEXT,
    last_error TEXT,
    alert_state TEXT,
    last_notified_price_cents INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE sealed_price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracked_sealed_id INTEGER NOT NULL REFERENCES tracked_sealed(id) ON DELETE CASCADE,
    config_version INTEGER NOT NULL,
    synced_at TEXT NOT NULL,
    price_cents INTEGER
  );
  CREATE INDEX sealed_price_snapshots_sealed ON sealed_price_snapshots(tracked_sealed_id);
  `,
```

Creare `server/src/db/sealed-repo.ts`:

```ts
import type { AlertState, Language, Listing, SyncStatus, TrackedSealed } from '@ctzero/shared';
import { NotFoundError } from '../errors';
import type { Snapshot } from './cards-repo';
import type { Db } from './db';

type SqlValue = string | number | null;

interface SealedRecord {
  id: number;
  name: string;
  blueprint_id: number;
  expansion_id: number;
  expansion_name: string;
  category_name: string;
  image_url: string | null;
  languages: string;
  threshold_cents: number;
  config_version: number;
  last_price_cents: number | null;
  last_listing: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
  alert_state: string | null;
  last_notified_price_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface NewSealed {
  name: string;
  blueprintId: number;
  expansionId: number;
  expansionName: string;
  categoryName: string;
  imageUrl: string | null;
  languages: Language[];
  thresholdCents: number;
}

export type SealedPatch = Partial<Omit<TrackedSealed, 'id' | 'createdAt' | 'updatedAt'>>;

const COLUMNS: Record<keyof SealedPatch, string> = {
  name: 'name',
  blueprintId: 'blueprint_id',
  expansionId: 'expansion_id',
  expansionName: 'expansion_name',
  categoryName: 'category_name',
  imageUrl: 'image_url',
  languages: 'languages',
  thresholdCents: 'threshold_cents',
  configVersion: 'config_version',
  lastPriceCents: 'last_price_cents',
  lastListing: 'last_listing',
  lastSyncedAt: 'last_synced_at',
  lastSyncStatus: 'last_sync_status',
  lastError: 'last_error',
  alertState: 'alert_state',
  lastNotifiedPriceCents: 'last_notified_price_cents',
};

function encode(key: keyof SealedPatch, value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (key === 'languages' || key === 'lastListing') return JSON.stringify(value);
  return value as SqlValue;
}

function toSealed(r: SealedRecord): TrackedSealed {
  return {
    id: r.id,
    name: r.name,
    blueprintId: r.blueprint_id,
    expansionId: r.expansion_id,
    expansionName: r.expansion_name,
    categoryName: r.category_name,
    imageUrl: r.image_url,
    languages: JSON.parse(r.languages) as Language[],
    thresholdCents: r.threshold_cents,
    configVersion: r.config_version,
    lastPriceCents: r.last_price_cents,
    lastListing: r.last_listing ? (JSON.parse(r.last_listing) as Listing) : null,
    lastSyncedAt: r.last_synced_at,
    lastSyncStatus: r.last_sync_status as SyncStatus | null,
    lastError: r.last_error,
    alertState: r.alert_state as AlertState | null,
    lastNotifiedPriceCents: r.last_notified_price_cents,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listSealed(db: Db): TrackedSealed[] {
  const rows = db.prepare('SELECT * FROM tracked_sealed ORDER BY name COLLATE NOCASE, id').all() as unknown as SealedRecord[];
  return rows.map(toSealed);
}

export function getSealed(db: Db, id: number): TrackedSealed | null {
  const row = db.prepare('SELECT * FROM tracked_sealed WHERE id = ?').get(id) as unknown as SealedRecord | undefined;
  return row ? toSealed(row) : null;
}

export function insertSealed(db: Db, s: NewSealed, now: Date = new Date()): TrackedSealed {
  const iso = now.toISOString();
  const res = db
    .prepare(
      `INSERT INTO tracked_sealed
        (name, blueprint_id, expansion_id, expansion_name, category_name, image_url, languages, threshold_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.name,
      s.blueprintId,
      s.expansionId,
      s.expansionName,
      s.categoryName,
      s.imageUrl,
      JSON.stringify(s.languages),
      s.thresholdCents,
      iso,
      iso,
    );
  return getSealed(db, Number(res.lastInsertRowid))!;
}

export function updateSealed(db: Db, id: number, patch: SealedPatch, now: Date = new Date()): TrackedSealed {
  const keys = (Object.keys(patch) as (keyof SealedPatch)[]).filter((k) => patch[k] !== undefined);
  const sets = [...keys.map((k) => `${COLUMNS[k]} = ?`), 'updated_at = ?'];
  const values: SqlValue[] = [...keys.map((k) => encode(k, patch[k])), now.toISOString()];
  const res = db.prepare(`UPDATE tracked_sealed SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  if (Number(res.changes) === 0) throw new NotFoundError('Sealed product not found');
  return getSealed(db, id)!;
}

export function deleteSealed(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM tracked_sealed WHERE id = ?').run(id).changes) > 0;
}

export function insertSealedSnapshot(db: Db, s: Snapshot & { sealedId: number }): void {
  db.prepare(
    'INSERT INTO sealed_price_snapshots (tracked_sealed_id, config_version, synced_at, price_cents) VALUES (?, ?, ?, ?)',
  ).run(s.sealedId, s.configVersion, s.syncedAt, s.priceCents);
}

export function listSealedSnapshots(db: Db, sealedId: number): Snapshot[] {
  return db
    .prepare(
      `SELECT config_version AS configVersion, synced_at AS syncedAt, price_cents AS priceCents
       FROM sealed_price_snapshots WHERE tracked_sealed_id = ? ORDER BY id`,
    )
    .all(sealedId) as unknown as Snapshot[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/db/`
Expected: PASS (inclusi `repos.test.ts`, il cui test `openDb` usa `MIGRATIONS.length` e ora si aspetta 2).

---

### Task 3: Filtro inserzioni e prezzo dei sealed

**Files:**
- Modify: `server/src/clients/cardtrader-types.ts`
- Modify: `server/src/clients/cardtrader.ts` (firma `products`, `CtBlueprint`)
- Modify: `server/src/pricing/listings.ts`
- Test: `server/src/pricing/listings.test.ts`
- Create: `server/src/pricing/sealed-pricer.ts`
- Test: `server/src/pricing/sealed-pricer.test.ts`

**Interfaces:**
- Consumes: `SealedProduct` (Task 1); `PriceResult` da `./card-pricer`; `listingUrl` da `./listings`.
- Produces:
  - `CtProduct` con `name_en?: string`, `expansion?: { id: number; code: string; name_en: string }`, `properties_hash.sealed?: boolean`
  - `CtBlueprint` con `category_id?: number`, `image_url?: string | null`
  - `CardTraderClient.products(blueprintId: number, q: { foil?: boolean; language?: string }): Promise<CtProduct[]>`
  - `isValidBaseListing(p: CtProduct, languages: Language[]): boolean`
  - `isValidSealedListing(p: CtProduct, languages: Language[]): boolean`
  - `priceSealed(ct: Pick<CardTraderClient, 'products'>, product: Pick<SealedProduct, 'blueprintId' | 'expansionName'>, languages: Language[]): Promise<PriceResult>`

- [ ] **Step 1: Write the failing tests**

In `server/src/pricing/listings.test.ts`, aggiornare l'import a `import { cheapestListing, isValidListing, isValidSealedListing, type ListingFilter } from './listings';` e aggiungere:

```ts
describe('isValidSealedListing', () => {
  const sealed = (props: Parameters<typeof makeProduct>[0] = {}) =>
    makeProduct({ ...props, props: { condition: undefined, mtg_foil: undefined, ...props.props } });

  it('accepts a CT Zero listing without condition or foil', () => {
    expect(isValidSealedListing(sealed(), [])).toBe(true);
    expect(isValidSealedListing(sealed({ props: { sealed: true } }), [])).toBe(true);
  });

  it('rejects opened products (sealed: false)', () => {
    expect(isValidSealedListing(sealed({ props: { sealed: false } }), [])).toBe(false);
  });

  it('applies the common rules', () => {
    expect(isValidSealedListing(sealed({ hub: false }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ quantity: 0 }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ on_vacation: true }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ graded: true }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ price: { cents: 100, currency: 'USD' } }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ props: { mtg_language: 'jp' } }), ['en'])).toBe(false);
    expect(isValidSealedListing(sealed({ props: { mtg_language: 'jp' } }), ['en', 'jp'])).toBe(true);
  });
});
```

Creare `server/src/pricing/sealed-pricer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CtProduct } from '../clients/cardtrader-types';
import { makeProduct } from '../test-utils';
import { priceSealed } from './sealed-pricer';

const box = { blueprintId: 279368, expansionName: 'Modern Horizons 3' };

function offer(id: number, cents: number, props: Partial<CtProduct['properties_hash']> = {}, hub = true): CtProduct {
  return makeProduct({
    id,
    blueprint_id: 279368,
    hub,
    price: { cents, currency: 'EUR' },
    props: { condition: undefined, mtg_foil: undefined, ...props },
  });
}

describe('priceSealed', () => {
  it('takes the cheapest valid CT Zero listing, without the foil parameter', async () => {
    const ct = {
      products: vi.fn(async (_id: number, _q: { language?: string }) => [
        offer(1, 18000, {}, false),
        offer(2, 21000),
        offer(3, 19500, { mtg_language: 'jp' }),
      ]),
    };
    const result = await priceSealed(ct, box, []);
    expect(result).toEqual({
      status: 'ok',
      priceCents: 19500,
      listing: {
        productId: 3,
        blueprintId: 279368,
        expansionName: 'Modern Horizons 3',
        condition: '',
        language: 'jp',
        foil: false,
        priceCents: 19500,
        url: 'https://www.cardtrader.com/cards/279368',
      },
    });
    expect(ct.products).toHaveBeenCalledTimes(1);
    expect(ct.products.mock.calls[0]).toEqual([279368, { language: undefined }]);
    expect(ct.products.mock.calls[0]![1]).not.toHaveProperty('foil');
  });

  it('a cheaper opened Secret Lair does not win', async () => {
    const ct = {
      products: vi.fn(async (_id: number, _q: { language?: string }) => [
        offer(1, 9000, { sealed: false }),
        offer(2, 12000, { sealed: true }),
      ]),
    };
    await expect(priceSealed(ct, box, [])).resolves.toMatchObject({ status: 'ok', priceCents: 12000 });
  });

  it('one call per selected language', async () => {
    const ct = { products: vi.fn(async (_id: number, _q: { language?: string }): Promise<CtProduct[]> => []) };
    await expect(priceSealed(ct, box, ['en', 'it'])).resolves.toEqual({ status: 'no_offers' });
    expect(ct.products.mock.calls).toEqual([
      [279368, { language: 'en' }],
      [279368, { language: 'it' }],
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/pricing/`
Expected: FAIL — `isValidSealedListing` non esportato, modulo `./sealed-pricer` non trovato.

- [ ] **Step 3: Implement**

`server/src/clients/cardtrader-types.ts` — sostituire l'interfaccia con:

```ts
/** Listing returned by GET /marketplace/products (only the fields we use). */
export interface CtProduct {
  id: number;
  blueprint_id: number;
  name_en?: string;
  expansion?: { id: number; code: string; name_en: string };
  quantity: number;
  price: { cents: number; currency: string };
  properties_hash: {
    condition?: string;
    mtg_language?: string;
    mtg_foil?: boolean;
    signed?: boolean;
    altered?: boolean;
    /** Only on products that can be sold opened (e.g. Secret Lair). */
    sealed?: boolean;
  };
  graded?: boolean;
  on_vacation?: boolean;
  user?: { id?: number; username?: string; can_sell_via_hub?: boolean };
}
```

`server/src/clients/cardtrader.ts` — estendere `CtBlueprint` e la firma di `products`:

```ts
export interface CtBlueprint {
  id: number;
  name: string;
  expansion_id: number;
  category_id?: number;
  scryfall_id?: string | null;
  image_url?: string | null;
}
```

```ts
  /** At most the 25 cheapest listings for the blueprint. */
  async products(blueprintId: number, q: { foil?: boolean; language?: string }): Promise<CtProduct[]> {
```

(il corpo resta identico: `foil: q.foil` con valore `undefined` non viene aggiunto all'URL da `get`.)

`server/src/pricing/listings.ts` — sostituire `isValidListing` con:

```ts
/** Rules shared by cards and sealed products. */
export function isValidBaseListing(p: CtProduct, languages: Language[]): boolean {
  // Hard rule: only listings purchasable via CardTrader Zero.
  if (p.user?.can_sell_via_hub !== true) return false;
  if (languages.length > 0 && !languages.includes(p.properties_hash.mtg_language as Language)) return false;
  if (!(p.quantity > 0)) return false;
  if (p.on_vacation) return false;
  if (p.properties_hash.altered || p.properties_hash.signed || p.graded) return false;
  if (p.price.currency !== 'EUR') return false;
  return true;
}

export function isValidListing(p: CtProduct, f: ListingFilter): boolean {
  if (!isValidBaseListing(p, f.languages)) return false;
  const rank = conditionRank(p.properties_hash.condition);
  if (rank < 0 || rank > conditionRank(f.minCondition)) return false;
  if (Boolean(p.properties_hash.mtg_foil) !== f.foil) return false;
  return true;
}

/** Sealed products have no condition or foil; opened ones (sealed: false) are excluded. */
export function isValidSealedListing(p: CtProduct, languages: Language[]): boolean {
  return isValidBaseListing(p, languages) && p.properties_hash.sealed !== false;
}
```

Creare `server/src/pricing/sealed-pricer.ts`:

```ts
import type { Language, SealedProduct } from '@ctzero/shared';
import type { CardTraderClient } from '../clients/cardtrader';
import type { CtProduct } from '../clients/cardtrader-types';
import type { PriceResult } from './card-pricer';
import { isValidSealedListing, listingUrl } from './listings';

export async function priceSealed(
  ct: Pick<CardTraderClient, 'products'>,
  product: Pick<SealedProduct, 'blueprintId' | 'expansionName'>,
  languages: Language[],
): Promise<PriceResult> {
  // One call per language: the marketplace returns only the 25 cheapest listings.
  const queries: (Language | undefined)[] = languages.length > 0 ? languages : [undefined];
  let best: CtProduct | null = null;
  for (const language of queries) {
    for (const p of await ct.products(product.blueprintId, { language })) {
      if (!isValidSealedListing(p, languages)) continue;
      if (!best || p.price.cents < best.price.cents) best = p;
    }
  }
  if (!best) return { status: 'no_offers' };
  return {
    status: 'ok',
    priceCents: best.price.cents,
    listing: {
      productId: best.id,
      blueprintId: best.blueprint_id,
      expansionName: product.expansionName,
      condition: '',
      language: best.properties_hash.mtg_language ?? '',
      foil: false,
      priceCents: best.price.cents,
      url: listingUrl(best.blueprint_id),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/pricing/ server/src/clients/`
Expected: PASS (inclusi i test esistenti di `isValidListing`, `cheapestListing`, `priceCard`, `cardtrader`).

---

### Task 4: Catalogo sealed

**Files:**
- Create: `server/src/catalog/sealed-catalog.ts`
- Test: `server/src/catalog/sealed-catalog.test.ts`

**Interfaces:**
- Consumes: `CtBlueprint`, `CtExpansion`, `CardTraderClient` (`blueprints`, `products` con `q.foil` opzionale — Task 3); `Expansion`, `SealedProduct` (Task 1); `ValidationError`.
- Produces (da `server/src/catalog/sealed-catalog.ts`):
  - `SEALED_CATEGORIES: Readonly<Record<number, string>>`
  - `decodeEntities(text: string): string`
  - `parseBlueprintRef(input: string): number` (lancia `ValidationError`)
  - `class SealedCatalog { constructor(ct: Pick<CardTraderClient, 'blueprints' | 'products'>, expansions: () => Promise<CtExpansion[]>); listExpansions(): Promise<Expansion[]>; sealedProducts(expansionId: number): Promise<SealedProduct[]>; sealedProduct(blueprintId: number): Promise<SealedProduct> }`

- [ ] **Step 1: Write the failing test** — `server/src/catalog/sealed-catalog.test.ts` (fixture ricavate dalle risposte reali dello spike):

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CtBlueprint, CtExpansion } from '../clients/cardtrader';
import type { CtProduct } from '../clients/cardtrader-types';
import { ValidationError } from '../errors';
import { makeProduct } from '../test-utils';
import { SealedCatalog, decodeEntities, parseBlueprintRef } from './sealed-catalog';

const expansions: CtExpansion[] = [
  { id: 3627, game_id: 1, code: 'mh3', name: 'Modern Horizons 3' },
  { id: 990, game_id: 1, code: 'sld', name: 'Secret Lair Drop Series' },
];

const img = (id: number) => `https://cardtrader.com/uploads/blueprints/image/${id}/preview_x.jpg`;
const blueprintsByExpansion: Record<number, CtBlueprint[]> = {
  3627: [
    { id: 279368, name: 'Modern Horizons 3: Play Booster Box', expansion_id: 3627, category_id: 4, scryfall_id: null, image_url: img(279368) },
    { id: 279369, name: 'Modern Horizons 3: Collector Booster Box', expansion_id: 3627, category_id: 4, scryfall_id: null, image_url: img(279369) },
    { id: 279300, name: 'Emrakul, the World Anew', expansion_id: 3627, category_id: 1, scryfall_id: 's1', image_url: img(279300) },
    { id: 279400, name: 'Modern Horizons 3 D20 Die', expansion_id: 3627, category_id: 22, scryfall_id: null, image_url: img(279400) },
    { id: 279401, name: 'Modern Horizons 3: Fat Pack Bundle', expansion_id: 3627, category_id: 23, scryfall_id: null, image_url: null },
  ],
  990: [
    { id: 62421, name: 'Secret Lair x Beadle &amp; Grimm&#39;s', expansion_id: 990, category_id: 13, scryfall_id: null, image_url: img(62421) },
  ],
};

function setup(listings: Record<number, CtProduct[]> = {}) {
  const ct = {
    blueprints: vi.fn(async (expansionId: number) => blueprintsByExpansion[expansionId] ?? []),
    products: vi.fn(async (blueprintId: number) => listings[blueprintId] ?? []),
  };
  return { ct, catalog: new SealedCatalog(ct, async () => expansions) };
}

describe('decodeEntities', () => {
  it('decodes the entities CardTrader uses', () => {
    expect(decodeEntities('A &amp; B &quot;C&quot; D&#39;s &lt;x&gt;')).toBe(`A & B "C" D's <x>`);
    expect(decodeEntities('plain')).toBe('plain');
  });
});

describe('parseBlueprintRef', () => {
  it('extracts the id from CardTrader links', () => {
    expect(parseBlueprintRef('https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit')).toBe(389300);
    expect(parseBlueprintRef('  https://www.cardtrader.com/cards/279368?share=1  ')).toBe(279368);
    expect(parseBlueprintRef('https://www.cardtrader.com/it/cards/279368')).toBe(279368);
  });

  it('accepts a bare numeric id', () => {
    expect(parseBlueprintRef(' 279368 ')).toBe(279368);
  });

  it('rejects anything else', () => {
    expect(() => parseBlueprintRef('https://www.cardtrader.com/en/cards/the-hobbit-play-booster-box')).toThrow(ValidationError);
    expect(() => parseBlueprintRef('hello')).toThrow(ValidationError);
    expect(() => parseBlueprintRef('0')).toThrow(ValidationError);
    expect(() => parseBlueprintRef('')).toThrow(ValidationError);
  });
});

describe('SealedCatalog', () => {
  it('lists expansions sorted by name', async () => {
    const { catalog } = setup();
    expect(await catalog.listExpansions()).toEqual([
      { id: 3627, code: 'mh3', name: 'Modern Horizons 3' },
      { id: 990, code: 'sld', name: 'Secret Lair Drop Series' },
    ]);
  });

  it('keeps only whitelisted sealed categories, sorted by name', async () => {
    const { catalog } = setup();
    expect(await catalog.sealedProducts(3627)).toEqual([
      {
        blueprintId: 279369,
        name: 'Modern Horizons 3: Collector Booster Box',
        expansionId: 3627,
        expansionName: 'Modern Horizons 3',
        categoryName: 'Booster Box',
        imageUrl: img(279369),
      },
      {
        blueprintId: 279401,
        name: 'Modern Horizons 3: Fat Pack Bundle',
        expansionId: 3627,
        expansionName: 'Modern Horizons 3',
        categoryName: 'Bundle',
        imageUrl: null,
      },
      {
        blueprintId: 279368,
        name: 'Modern Horizons 3: Play Booster Box',
        expansionId: 3627,
        expansionName: 'Modern Horizons 3',
        categoryName: 'Booster Box',
        imageUrl: img(279368),
      },
    ]);
  });

  it('decodes HTML entities in names', async () => {
    const { catalog } = setup();
    expect((await catalog.sealedProducts(990))[0]).toMatchObject({ name: "Secret Lair x Beadle & Grimm's", categoryName: 'Boxed Set' });
  });

  it('unknown expansion → ValidationError', async () => {
    const { catalog } = setup();
    await expect(catalog.sealedProducts(42)).rejects.toThrow(ValidationError);
  });

  it('resolves a blueprint id through its listings', async () => {
    const listing = makeProduct({ blueprint_id: 279368, expansion: { id: 3627, code: 'mh3', name_en: 'Modern Horizons 3' } });
    const { catalog, ct } = setup({ 279368: [listing] });
    await expect(catalog.sealedProduct(279368)).resolves.toMatchObject({ blueprintId: 279368, categoryName: 'Booster Box' });
    expect(ct.products).toHaveBeenCalledWith(279368, {});
  });

  it('a product without listings cannot be identified', async () => {
    const { catalog } = setup();
    await expect(catalog.sealedProduct(279368)).rejects.toThrow(/select it from its expansion/);
  });

  it('a single card is not a sealed product', async () => {
    const listing = makeProduct({ blueprint_id: 279300, expansion: { id: 3627, code: 'mh3', name_en: 'Modern Horizons 3' } });
    const { catalog } = setup({ 279300: [listing] });
    await expect(catalog.sealedProduct(279300)).rejects.toThrow(/not a sealed product/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/catalog/sealed-catalog.test.ts`
Expected: FAIL — modulo `./sealed-catalog` non trovato.

- [ ] **Step 3: Implement** — `server/src/catalog/sealed-catalog.ts`:

```ts
import type { Expansion, SealedProduct } from '@ctzero/shared';
import type { CardTraderClient, CtExpansion } from '../clients/cardtrader';
import { ValidationError } from '../errors';

/** CardTrader Magic categories that count as sealed products → display name. */
export const SEALED_CATEGORIES: Readonly<Record<number, string>> = {
  4: 'Booster Box',
  5: 'Booster',
  6: 'Complete Set',
  7: 'Starter Deck',
  10: 'Box Set',
  13: 'Boxed Set',
  17: 'Preconstructed Deck',
  23: 'Bundle',
  24: 'Prerelease Pack',
};

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

/** CardTrader returns some names HTML-escaped (e.g. "Beadle &amp; Grimm's"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|quot|#39|lt|gt);/g, (entity) => ENTITIES[entity]!);
}

/** Blueprint id from a numeric id or a product link (".../cards/389300-the-hobbit-..."). */
export function parseBlueprintRef(input: string): number {
  const text = input.trim();
  const match = /^\d+$/.test(text) ? text : /\/cards\/(\d+)(?:[-/?#]|$)/.exec(text)?.[1];
  const id = match ? Number(match) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ValidationError('Unrecognized CardTrader link: paste a product page link (…/cards/<id>-…) or its numeric id');
  }
  return id;
}

export class SealedCatalog {
  constructor(
    private readonly ct: Pick<CardTraderClient, 'blueprints' | 'products'>,
    private readonly expansions: () => Promise<CtExpansion[]>,
  ) {}

  async listExpansions(): Promise<Expansion[]> {
    return (await this.expansions())
      .map((e) => ({ id: e.id, code: e.code, name: decodeEntities(e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  async sealedProducts(expansionId: number): Promise<SealedProduct[]> {
    const expansion = (await this.expansions()).find((e) => e.id === expansionId);
    if (!expansion) throw new ValidationError(`Expansion ${expansionId} is not a Magic expansion on CardTrader`);
    const out: SealedProduct[] = [];
    for (const bp of await this.ct.blueprints(expansionId)) {
      const categoryName = bp.category_id !== undefined ? SEALED_CATEGORIES[bp.category_id] : undefined;
      if (!categoryName || bp.scryfall_id) continue;
      out.push({
        blueprintId: bp.id,
        name: decodeEntities(bp.name),
        expansionId,
        expansionName: decodeEntities(expansion.name),
        categoryName,
        imageUrl: bp.image_url ?? null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  /** There is no single-blueprint endpoint: the expansion comes from the product's listings. */
  async sealedProduct(blueprintId: number): Promise<SealedProduct> {
    const listings = await this.ct.products(blueprintId, {});
    const expansionId = listings.find((p) => p.expansion)?.expansion?.id;
    if (expansionId === undefined) {
      throw new ValidationError(
        `Product ${blueprintId} has no listings on CardTrader and cannot be identified: select it from its expansion`,
      );
    }
    const product = (await this.sealedProducts(expansionId)).find((p) => p.blueprintId === blueprintId);
    if (!product) throw new ValidationError(`CardTrader item ${blueprintId} is not a sealed product`);
    return product;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/catalog/`
Expected: PASS.

---

### Task 5: SealedService

**Files:**
- Create: `server/src/sealed/sealed-service.ts`
- Test: `server/src/sealed/sealed-service.test.ts`

**Interfaces:**
- Consumes: `SealedCatalog.sealedProduct` (Task 4); `priceSealed` (Task 3); repo sealed (Task 2); `evaluateSilently(priceCents, thresholdCents)` da `../alerts/rules`; `thresholdPresets` da `../pricing/presets`; `transaction` da `../db/db`.
- Produces: `class SealedService { constructor(deps: SealedServiceDeps); list(): TrackedSealed[]; preview(input: SealedPreview): Promise<PreviewResult>; create(input: SealedInput): Promise<TrackedSealed>; update(id: number, input: SealedUpdate): Promise<TrackedSealed>; delete(id: number): void }` con `SealedServiceDeps = { db: Db; catalog: Pick<SealedCatalog, 'sealedProduct'>; ct: Pick<CardTraderClient, 'products'>; now?: () => Date }`.

- [ ] **Step 1: Write the failing test** — `server/src/sealed/sealed-service.test.ts`:

```ts
import type { SealedInput, SealedProduct } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HttpError } from '../clients/http';
import { openDb, type Db } from '../db/db';
import { getSealed, listSealedSnapshots } from '../db/sealed-repo';
import { NotFoundError, ValidationError } from '../errors';
import { makeProduct } from '../test-utils';
import { SealedService } from './sealed-service';

const t0 = new Date('2026-10-07T10:00:00.000Z');
const product: SealedProduct = {
  blueprintId: 279368,
  name: 'Modern Horizons 3: Play Booster Box',
  expansionId: 3627,
  expansionName: 'Modern Horizons 3',
  categoryName: 'Booster Box',
  imageUrl: 'img',
};
const input: SealedInput = { blueprintId: 279368, languages: ['en'], thresholdCents: 20000 };

type Fn = Mock<(...args: any[]) => any>;

let db: Db;
let price: number | Error;
let catalog: { sealedProduct: Fn };
let ct: { products: Fn };
let service: SealedService;

beforeEach(() => {
  db = openDb(':memory:');
  price = 19000;
  catalog = { sealedProduct: vi.fn(async () => product) };
  ct = {
    products: vi.fn(async () => {
      if (price instanceof Error) throw price;
      return [makeProduct({ blueprint_id: 279368, price: { cents: price, currency: 'EUR' } })];
    }),
  };
  service = new SealedService({ db, catalog, ct, now: () => t0 });
});

describe('create', () => {
  it('stores catalog data, refreshes immediately and evaluates silently', async () => {
    const s = await service.create(input);
    expect(catalog.sealedProduct).toHaveBeenCalledWith(279368);
    expect(s).toMatchObject({
      ...product,
      languages: ['en'],
      thresholdCents: 20000,
      lastPriceCents: 19000,
      lastSyncStatus: 'ok',
      alertState: 'below',
      lastNotifiedPriceCents: 19000,
      lastSyncedAt: t0.toISOString(),
    });
    expect(listSealedSnapshots(db, s.id)).toHaveLength(1);
  });

  it('above threshold → above', async () => {
    price = 25000;
    expect(await service.create(input)).toMatchObject({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('a CardTrader error saves the product in error state', async () => {
    price = new HttpError(500, 'HTTP 500 from api.cardtrader.com');
    expect(await service.create(input)).toMatchObject({ lastSyncStatus: 'error', lastError: 'HTTP 500 from api.cardtrader.com' });
  });

  it('a catalog error saves nothing', async () => {
    catalog.sealedProduct.mockRejectedValueOnce(new ValidationError('not a sealed product'));
    await expect(service.create(input)).rejects.toThrow(ValidationError);
    expect(service.list()).toEqual([]);
  });
});

describe('update', () => {
  it('threshold only: no CardTrader call, silent re-evaluation', async () => {
    const s = await service.create(input);
    ct.products.mockClear();
    const u = await service.update(s.id, { languages: ['en'], thresholdCents: 18000 });
    expect(ct.products).not.toHaveBeenCalled();
    expect(u).toMatchObject({ thresholdCents: 18000, alertState: 'above', configVersion: 1, lastPriceCents: 19000 });
  });

  it('languages changed: bumps config version, resets and refreshes', async () => {
    const s = await service.create(input);
    price = 17000;
    const u = await service.update(s.id, { languages: ['jp'], thresholdCents: 20000 });
    expect(u).toMatchObject({ languages: ['jp'], configVersion: 2, lastPriceCents: 17000, alertState: 'below', lastNotifiedPriceCents: 17000 });
    expect(ct.products).toHaveBeenLastCalledWith(279368, { language: 'jp' });
  });

  it('missing product → NotFoundError', async () => {
    await expect(service.update(99, { languages: [], thresholdCents: 1 })).rejects.toThrow(NotFoundError);
  });
});

describe('preview and delete', () => {
  it('preview returns price, listing and presets without saving', async () => {
    const p = await service.preview({ blueprintId: 279368, languages: [] });
    expect(p).toMatchObject({ priceCents: 19000, blueprintCount: 1, listing: { productId: 1 } });
    expect(p.presets.map((x) => x.label)).toEqual(['-10%', '-20%', '-30%', '€1']);
    expect(service.list()).toEqual([]);
  });

  it('delete', async () => {
    const s = await service.create(input);
    service.delete(s.id);
    expect(getSealed(db, s.id)).toBeNull();
    expect(() => service.delete(s.id)).toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/sealed/`
Expected: FAIL — modulo `./sealed-service` non trovato.

- [ ] **Step 3: Implement** — `server/src/sealed/sealed-service.ts`:

```ts
import type { PreviewResult, SealedInput, SealedPreview, SealedUpdate, TrackedSealed } from '@ctzero/shared';
import { evaluateSilently } from '../alerts/rules';
import type { SealedCatalog } from '../catalog/sealed-catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { transaction, type Db } from '../db/db';
import {
  deleteSealed,
  getSealed,
  insertSealed,
  insertSealedSnapshot,
  listSealed,
  updateSealed,
} from '../db/sealed-repo';
import { NotFoundError, errorMessage } from '../errors';
import { thresholdPresets } from '../pricing/presets';
import { priceSealed } from '../pricing/sealed-pricer';

export interface SealedServiceDeps {
  db: Db;
  catalog: Pick<SealedCatalog, 'sealedProduct'>;
  ct: Pick<CardTraderClient, 'products'>;
  now?: () => Date;
}

function sameSet<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export class SealedService {
  constructor(private readonly deps: SealedServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  list(): TrackedSealed[] {
    return listSealed(this.deps.db);
  }

  async preview(input: SealedPreview): Promise<PreviewResult> {
    const product = await this.deps.catalog.sealedProduct(input.blueprintId);
    const result = await priceSealed(this.deps.ct, product, input.languages);
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    return {
      priceCents,
      listing: result.status === 'ok' ? result.listing : null,
      presets: thresholdPresets(priceCents),
      blueprintCount: 1,
    };
  }

  async create(input: SealedInput): Promise<TrackedSealed> {
    // Product data comes from CardTrader, not from the client.
    const product = await this.deps.catalog.sealedProduct(input.blueprintId);
    const created = insertSealed(
      this.deps.db,
      { ...product, languages: input.languages, thresholdCents: input.thresholdCents },
      this.now(),
    );
    return this.refreshSilently(created);
  }

  async update(id: number, input: SealedUpdate): Promise<TrackedSealed> {
    const { db } = this.deps;
    const item = getSealed(db, id);
    if (!item) throw new NotFoundError('Sealed product not found');
    const now = this.now();

    if (sameSet(item.languages, input.languages)) {
      return updateSealed(
        db,
        id,
        { thresholdCents: input.thresholdCents, ...evaluateSilently(item.lastPriceCents, input.thresholdCents) },
        now,
      );
    }

    const updated = updateSealed(
      db,
      id,
      {
        languages: input.languages,
        thresholdCents: input.thresholdCents,
        configVersion: item.configVersion + 1,
        lastPriceCents: null,
        lastListing: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
        lastError: null,
        alertState: null,
        lastNotifiedPriceCents: null,
      },
      now,
    );
    return this.refreshSilently(updated);
  }

  delete(id: number): void {
    if (!deleteSealed(this.deps.db, id)) throw new NotFoundError('Sealed product not found');
  }

  /** Refreshes the price of a single product without sending notifications. */
  private async refreshSilently(item: TrackedSealed): Promise<TrackedSealed> {
    const { db, ct } = this.deps;
    const now = this.now();
    const iso = now.toISOString();
    try {
      const result = await priceSealed(ct, item, item.languages);
      const priceCents = result.status === 'ok' ? result.priceCents : null;
      return transaction(db, () => {
        insertSealedSnapshot(db, { sealedId: item.id, configVersion: item.configVersion, syncedAt: iso, priceCents });
        return updateSealed(
          db,
          item.id,
          {
            lastPriceCents: priceCents,
            lastListing: result.status === 'ok' ? result.listing : null,
            lastSyncedAt: iso,
            lastSyncStatus: result.status,
            lastError: null,
            ...evaluateSilently(priceCents, item.thresholdCents),
          },
          now,
        );
      });
    } catch (e) {
      return updateSealed(db, item.id, { lastSyncedAt: iso, lastSyncStatus: 'error', lastError: errorMessage(e) }, now);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/sealed/`
Expected: PASS.

---

### Task 6: Report con `kind` e giro di aggiornamento misto

**Files:**
- Modify: `server/src/alerts/report.ts`
- Test: `server/src/alerts/report.test.ts`
- Modify: `server/src/sync/sync-service.ts`
- Test: `server/src/sync/sync-service.test.ts`

**Interfaces:**
- Consumes: `priceSealed` (Task 3), repo sealed (Task 2), `PriceResult` da `../pricing/card-pricer`.
- Produces:
  - `type ItemKind = 'card' | 'sealed'`
  - `interface ReportItem { kind: ItemKind; name: string; listing: Listing | null; event: AlertEvent }`
  - `interface ReportError { kind: ItemKind; name: string; message: string }`
  - `SyncService.start()` conta carte + sealed in `cardsTotal`; firma e deps invariate.

- [ ] **Step 1: Update the existing report tests and add the new ones**

In `server/src/alerts/report.test.ts`, sostituire ovunque `{ cardName: ` con `{ kind: 'card', name: ` e `cardName: 'Sheoldred, the Apocalypse',` con `kind: 'card',\n          name: 'Sheoldred, the Apocalypse',` (nelle chiamate a `buildReport`, sia negli item sia negli errori). Le stringhe attese restano identiche. Poi aggiungere dentro `describe('buildReport', ...)`:

```ts
  it('formats sealed products with 📦, expansion and language, after cards', () => {
    const sealedListing: Listing = {
      ...listing,
      blueprintId: 279368,
      expansionName: 'Modern Horizons 3',
      condition: '',
      language: 'jp',
      priceCents: 18900,
      url: 'https://www.cardtrader.com/cards/279368',
    };
    const text = buildReport(
      [
        { kind: 'sealed', name: 'Modern Horizons 3: Play Booster Box', listing: sealedListing, event: { kind: 'below', priceCents: 18900, thresholdCents: 20000 } },
        { kind: 'card', name: 'Ragavan, Nimble Pilferer', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } },
        { kind: 'sealed', name: 'Bloomburrow: Play Booster Box', listing: null, event: { kind: 'back_above', priceCents: null, thresholdCents: 15000 } },
      ],
      [{ kind: 'sealed', name: 'Secret Lair x Beadle & Grimm\'s', message: 'boom' }],
      at,
    );
    expect(text).toBe(
      [
        '🃏 <b>CTZero Tracker</b> — 10/02 06:00 PM',
        '',
        '🟢 <b>Below threshold</b>',
        '• Ragavan, Nimble Pilferer (Modern Horizons 2, NM, EN) — €38.50 (threshold €40.00, €1.50 below) → <a href="https://www.cardtrader.com/cards/123">link</a>',
        '• 📦 Modern Horizons 3: Play Booster Box (Modern Horizons 3, JP) — €189.00 (threshold €200.00, €11.00 below) → <a href="https://www.cardtrader.com/cards/279368">link</a>',
        '',
        '🔁 <b>Back above threshold</b>',
        '• 📦 Bloomburrow: Play Booster Box — no valid CT Zero offers (threshold €150.00)',
        '',
        '❌ <b>Errors</b>',
        '• 📦 Secret Lair x Beadle &amp; Grimm\'s — boom',
      ].join('\n'),
    );
  });
```

- [ ] **Step 2: Run report tests to verify they fail**

Run: `npx vitest run server/src/alerts/report.test.ts`
Expected: FAIL — errori di tipo/valori (`name` undefined: righe con "undefined") e il nuovo test fallisce.

- [ ] **Step 3: Implement the report changes** — in `server/src/alerts/report.ts` sostituire le interfacce e le funzioni coinvolte:

```ts
export type ItemKind = 'card' | 'sealed';

export interface ReportItem {
  kind: ItemKind;
  name: string;
  listing: Listing | null;
  event: AlertEvent;
}

export interface ReportError {
  kind: ItemKind;
  name: string;
  message: string;
}
```

```ts
function describeListing(kind: ItemKind, l: Listing | null): string {
  if (!l) return '';
  const parts =
    kind === 'sealed'
      ? [l.expansionName, l.language.toUpperCase()]
      : [l.expansionName, CONDITION_ABBR[l.condition as Condition] ?? l.condition, l.language.toUpperCase()];
  if (kind === 'card' && l.foil) parts.push('foil');
  return ` (${escapeHtml(parts.join(', '))})`;
}

function displayName(kind: ItemKind, name: string): string {
  return (kind === 'sealed' ? '📦 ' : '') + escapeHtml(name);
}
```

In `itemLine`: `const name = displayName(item.kind, item.name);` e `describeListing(item.kind, item.listing)` al posto di `describeListing(item.listing)` (due occorrenze). In `buildReport`, all'interno di ogni sezione le carte vanno prima dei sealed:

```ts
  for (const section of SECTIONS) {
    const inSection = items.filter((i) => i.event.kind === section.kind);
    const ordered = [...inSection.filter((i) => i.kind === 'card'), ...inSection.filter((i) => i.kind === 'sealed')];
    const lines = ordered.map(itemLine);
    if (lines.length > 0) blocks.push([section.title, ...lines].join('\n'));
  }
  if (errors.length > 0) {
    const lines = errors.map((e) => `• ${displayName(e.kind, e.name)} — ${escapeHtml(e.message)}`);
    blocks.push(['❌ <b>Errors</b>', ...lines].join('\n'));
  }
```

- [ ] **Step 4: Run report tests to verify they pass**

Run: `npx vitest run server/src/alerts/`
Expected: PASS.

- [ ] **Step 5: Write the failing sync tests** — in `server/src/sync/sync-service.test.ts` aggiungere l'import `import { deleteSealed, getSealed, insertSealed, listSealedSnapshots, updateSealed } from '../db/sealed-repo';` e `import type { TrackedSealed } from '@ctzero/shared';` (unire all'import esistente da `@ctzero/shared`), l'helper dopo `addCard`:

```ts
function addSealed(name: string, blueprintId: number, thresholdCents: number): TrackedSealed {
  const s = insertSealed(
    db,
    {
      name,
      blueprintId,
      expansionId: 3627,
      expansionName: 'Modern Horizons 3',
      categoryName: 'Booster Box',
      imageUrl: null,
      languages: [],
      thresholdCents,
    },
    t0,
  );
  return updateSealed(db, s.id, { alertState: 'above' }, t0);
}
```

e un nuovo blocco in fondo al file:

```ts
describe('SyncService with sealed products', () => {
  it('prices cards and sealed in one run with a single report', async () => {
    addCard('Ragavan', 100, 4000);
    const box = addSealed('MH3 Play Booster Box', 500, 20000);
    prices.set(100, 3800).set(500, 19000);
    const result = await run();
    expect(result).toMatchObject({ status: 'ok', cardsTotal: 2, cardsDone: 2, cardsError: 0, reportSent: true });
    expect(getSealed(db, box.id)).toMatchObject({
      lastPriceCents: 19000,
      lastSyncStatus: 'ok',
      alertState: 'below',
      lastNotifiedPriceCents: 19000,
      lastSyncedAt: t0.toISOString(),
    });
    expect(listSealedSnapshots(db, box.id)).toHaveLength(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const text = telegram.sendMessage.mock.calls[0]![0] as string;
    expect(text.indexOf('Ragavan')).toBeGreaterThan(-1);
    expect(text.indexOf('📦 MH3 Play Booster Box')).toBeGreaterThan(text.indexOf('Ragavan'));
  });

  it('error on a sealed product → partial, listed in Errors with 📦', async () => {
    const box = addSealed('MH3 Play Booster Box', 500, 20000);
    prices.set(500, new HttpError(500, 'HTTP 500 from api.cardtrader.com'));
    expect(await run()).toMatchObject({ status: 'partial', cardsDone: 1, cardsError: 1 });
    expect(getSealed(db, box.id)).toMatchObject({ lastSyncStatus: 'error', lastError: 'HTTP 500 from api.cardtrader.com' });
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('📦 MH3 Play Booster Box — HTTP 500');
  });

  it('401 on a card stops the run before sealed products', async () => {
    addCard('A', 100, 4000);
    const box = addSealed('MH3 Play Booster Box', 500, 20000);
    prices.set(100, new HttpError(401, 'HTTP 401 from api.cardtrader.com')).set(500, 19000);
    expect((await run()).status).toBe('failed');
    expect(getSealed(db, box.id)!.lastSyncedAt).toBeNull();
  });

  it('a sealed product deleted while being priced is skipped silently', async () => {
    const box = addSealed('MH3 Play Booster Box', 500, 20000);
    ct.products.mockImplementationOnce(async () => {
      deleteSealed(db, box.id);
      return [makeProduct({ blueprint_id: 500, price: { cents: 19000, currency: 'EUR' } })];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsError: 0 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('a threshold change during pricing is not overwritten nor notified', async () => {
    const box = addSealed('MH3 Play Booster Box', 500, 20000);
    ct.products.mockImplementationOnce(async () => {
      updateSealed(db, box.id, { thresholdCents: 10000 });
      return [makeProduct({ blueprint_id: 500, price: { cents: 19000, currency: 'EUR' } })];
    });
    await run();
    expect(getSealed(db, box.id)).toMatchObject({ thresholdCents: 10000, lastPriceCents: null });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run sync tests to verify they fail**

Run: `npx vitest run server/src/sync/`
Expected: i nuovi test FAIL (`cardsTotal: 1`, sealed mai aggiornati, nessuna riga 📦).

- [ ] **Step 7: Implement the sync changes** — in `server/src/sync/sync-service.ts`:

Import aggiuntivi/modificati:

```ts
import type { CardBlueprint, SyncRun, SyncTrigger, TrackedCard, TrackedSealed } from '@ctzero/shared';
import { buildFatalMessage, buildReport, type ItemKind, type ReportError, type ReportItem } from '../alerts/report';
import { evaluateAlert, type AlertEvaluation } from '../alerts/rules';
import { getSealed, insertSealedSnapshot, listSealed, updateSealed } from '../db/sealed-repo';
import { priceCard, type PriceResult } from '../pricing/card-pricer';
import { priceSealed } from '../pricing/sealed-pricer';
```

Sostituire `isUnchanged` e aggiungere `evaluate`:

```ts
type Versioned = { configVersion: number; thresholdCents: number };

/** True if the item has not been deleted nor had its filters or threshold changed. */
function isUnchanged(latest: Versioned | null, seen: Versioned): boolean {
  return latest !== null && latest.configVersion === seen.configVersion && latest.thresholdCents === seen.thresholdCents;
}

function evaluate(
  item: Pick<TrackedCard, 'alertState' | 'lastNotifiedPriceCents' | 'thresholdCents'>,
  result: PriceResult,
  furtherDropPercent: number,
): AlertEvaluation {
  return evaluateAlert(
    { alertState: item.alertState, lastNotifiedPriceCents: item.lastNotifiedPriceCents },
    result.status === 'ok' ? { status: 'ok', priceCents: result.priceCents } : { status: 'no_offers' },
    item.thresholdCents,
    furtherDropPercent,
  );
}
```

`start`:

```ts
  start(trigger: SyncTrigger): StartResult {
    const { db } = this.deps;
    const running = getRunningRun(db);
    if (running) return { started: false, run: running };
    const cardIds = listCards(db).map((c) => c.id);
    const sealedIds = listSealed(db).map((s) => s.id);
    const run = startRun(db, trigger, cardIds.length + sealedIds.length, this.now());
    this.active = this.execute(run.id, cardIds, sealedIds).finally(() => {
      this.active = null;
      const finished = getRun(db, run.id);
      if (finished) for (const listener of this.listeners) listener(finished);
    });
    return { started: true, run };
  }
```

`execute` (sostituisce il metodo intero):

```ts
  /** Never rejects: every error ends up in the run outcome. */
  private async execute(runId: number, cardIds: number[], sealedIds: number[]): Promise<void> {
    const { db, telegram } = this.deps;
    try {
      const { furtherDropPercent } = getSettings(db);
      const items: ReportItem[] = [];
      const errors: ReportError[] = [];
      let done = 0;
      const errorPatch = (message: string) => ({
        lastSyncedAt: this.now().toISOString(),
        lastSyncStatus: 'error' as const,
        lastError: message,
      });

      for (const id of cardIds) {
        const card = getCard(db, id); // null if deleted during the run
        if (card) {
          const fatal = await this.runItem('card', card.name, () => this.processCard(card, furtherDropPercent), (message) => {
            if (!getCard(db, id)) return false;
            updateCard(db, id, errorPatch(message), this.now());
            return true;
          }, items, errors);
          if (fatal) return await this.failRun(runId, fatal);
        }
        updateRunProgress(db, runId, ++done, errors.length);
      }

      for (const id of sealedIds) {
        const item = getSealed(db, id);
        if (item) {
          const fatal = await this.runItem('sealed', item.name, () => this.processSealed(item, furtherDropPercent), (message) => {
            if (!getSealed(db, id)) return false;
            updateSealed(db, id, errorPatch(message), this.now());
            return true;
          }, items, errors);
          if (fatal) return await this.failRun(runId, fatal);
        }
        updateRunProgress(db, runId, ++done, errors.length);
      }

      const report = buildReport(items, errors, this.now());
      let reportSent = false;
      let reportError: string | null = null;
      if (report) {
        try {
          await telegram.sendMessage(report);
          reportSent = true;
        } catch (e) {
          reportError = errorMessage(e);
        }
      }
      finishRun(db, runId, { status: errors.length > 0 ? 'partial' : 'ok', reportSent, reportError }, this.now());
    } catch (e) {
      finishRun(db, runId, { status: 'failed', error: errorMessage(e) }, this.now());
    }
  }

  /**
   * Prices one item, collecting its report entry or error.
   * `markError` saves the error on the item and returns false if the item no longer exists.
   * Returns the message of a fatal error (401/403), which must stop the run.
   */
  private async runItem(
    kind: ItemKind,
    name: string,
    process: () => Promise<ReportItem | null>,
    markError: (message: string) => boolean,
    items: ReportItem[],
    errors: ReportError[],
  ): Promise<string | null> {
    try {
      const item = await process();
      if (item) items.push(item);
    } catch (e) {
      if (isFatalHttpError(e)) return errorMessage(e);
      if (markError(errorMessage(e))) errors.push({ kind, name, message: errorMessage(e) });
    }
    return null;
  }
```

`processCard`: sostituire la chiamata `evaluateAlert(...)` con `const { next, event } = evaluate(card, result, furtherDropPercent);` e il return con:

```ts
    return applied && event ? { kind: 'card', name: card.name, listing, event } : null;
```

Nuovo metodo dopo `processCard`:

```ts
  private async processSealed(item: TrackedSealed, furtherDropPercent: number): Promise<ReportItem | null> {
    const { db, ct } = this.deps;
    const result = await priceSealed(ct, item, item.languages);
    const now = this.now();
    const iso = now.toISOString();
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    const listing = result.status === 'ok' ? result.listing : null;
    const { next, event } = evaluate(item, result, furtherDropPercent);
    const applied = transaction(db, () => {
      // Same guard as cards: stale results are neither written nor notified.
      if (!isUnchanged(getSealed(db, item.id), item)) return false;
      insertSealedSnapshot(db, { sealedId: item.id, configVersion: item.configVersion, syncedAt: iso, priceCents });
      updateSealed(
        db,
        item.id,
        { lastPriceCents: priceCents, lastListing: listing, lastSyncedAt: iso, lastSyncStatus: result.status, lastError: null, ...next },
        now,
      );
      return true;
    });
    return applied && event ? { kind: 'sealed', name: item.name, listing, event } : null;
  }
```

Nota per l'implementatore: `failRun` restituisce `Promise<void>`, quindi `return await this.failRun(...)` è valido dentro `execute`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run server/src/sync/ server/src/alerts/ && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 7: API REST e wiring

**Files:**
- Modify: `server/src/api/app.ts`
- Test: `server/src/api/app.test.ts`
- Modify: `server/src/main.ts`

**Interfaces:**
- Consumes: `SealedService` (Task 5), `SealedCatalog`, `parseBlueprintRef` (Task 4), schemi (Task 1).
- Produces: rotte `GET/POST /api/sealed`, `PUT/DELETE /api/sealed/:id`, `POST /api/sealed/preview`, `GET /api/expansions`, `GET /api/sealed/catalog?expansionId=`, `GET /api/sealed/resolve?ref=`. `AppDeps` acquisisce `sealed` e `sealedCatalog`.

- [ ] **Step 1: Write the failing tests** — in `server/src/api/app.test.ts`, dentro `setup()` prima di `const deps = ...`:

```ts
  const product = {
    blueprintId: 279368,
    name: 'Modern Horizons 3: Play Booster Box',
    expansionId: 3627,
    expansionName: 'Modern Horizons 3',
    categoryName: 'Booster Box',
    imageUrl: null,
  };
  const sealed = {
    list: vi.fn(() => []),
    create: vi.fn(async (input: object) => ({ id: 1, ...input })),
    update: vi.fn(async (id: number, input: object) => ({ id, ...input })),
    delete: vi.fn(),
    preview: vi.fn(async () => ({ priceCents: 19000, listing: null, presets: [], blueprintCount: 1 })),
  };
  const sealedCatalog = {
    listExpansions: vi.fn(async () => [{ id: 3627, code: 'mh3', name: 'Modern Horizons 3' }]),
    sealedProducts: vi.fn(async () => [product]),
    sealedProduct: vi.fn(async () => product),
  };
```

e cambiare `deps` in `const deps = { db, cards, sealed, sealedCatalog, sync, scheduler, catalog, scryfall, telegram, cardtraderConfigured: false };`. Poi aggiungere:

```ts
describe('sealed API', () => {
  const sealedBody = { blueprintId: 279368, languages: ['en'], thresholdCents: 20000 };

  it('CRUD routes delegate to the service', async () => {
    const { app, sealed } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/sealed' })).json()).toEqual([]);
    const created = await app.inject({ method: 'POST', url: '/api/sealed', payload: sealedBody });
    expect(created.statusCode).toBe(201);
    expect(sealed.create).toHaveBeenCalledWith(sealedBody);
    const updated = await app.inject({ method: 'PUT', url: '/api/sealed/3', payload: sealedBody });
    expect(updated.statusCode).toBe(200);
    expect(sealed.update).toHaveBeenCalledWith(3, { languages: ['en'], thresholdCents: 20000 });
    expect((await app.inject({ method: 'DELETE', url: '/api/sealed/3' })).statusCode).toBe(204);
    expect(sealed.delete).toHaveBeenCalledWith(3);
  });

  it('POST /api/sealed invalid → 400', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/sealed', payload: { ...sealedBody, blueprintId: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('blueprintId');
  });

  it('POST /api/sealed/preview', async () => {
    const { app, sealed } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/sealed/preview', payload: { blueprintId: 279368, languages: [] } });
    expect(res.statusCode).toBe(200);
    expect(sealed.preview).toHaveBeenCalledWith({ blueprintId: 279368, languages: [] });
  });

  it('GET /api/expansions and /api/sealed/catalog', async () => {
    const { app, sealedCatalog } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/expansions' })).json()).toEqual([
      { id: 3627, code: 'mh3', name: 'Modern Horizons 3' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/sealed/catalog?expansionId=3627' });
    expect(res.statusCode).toBe(200);
    expect(sealedCatalog.sealedProducts).toHaveBeenCalledWith(3627);
    expect((await app.inject({ method: 'GET', url: '/api/sealed/catalog?expansionId=abc' })).statusCode).toBe(400);
  });

  it('GET /api/sealed/resolve parses the link', async () => {
    const { app, sealedCatalog } = setup();
    const ref = encodeURIComponent('https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit');
    const res = await app.inject({ method: 'GET', url: `/api/sealed/resolve?ref=${ref}` });
    expect(res.statusCode).toBe(200);
    expect(sealedCatalog.sealedProduct).toHaveBeenCalledWith(389300);
  });

  it('GET /api/sealed/resolve with an unrecognized link → 422', async () => {
    const { app, sealedCatalog } = setup();
    const ref = encodeURIComponent('https://www.cardtrader.com/en/cards/the-hobbit-play-booster-box');
    const res = await app.inject({ method: 'GET', url: `/api/sealed/resolve?ref=${ref}` });
    expect(res.statusCode).toBe(422);
    expect(sealedCatalog.sealedProduct).not.toHaveBeenCalled();
  });

  it('catalog validation errors → 422', async () => {
    const { app, sealedCatalog } = setup();
    sealedCatalog.sealedProduct.mockRejectedValueOnce(new ValidationError('CardTrader item 5 is not a sealed product'));
    const res = await app.inject({ method: 'GET', url: '/api/sealed/resolve?ref=5' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'CardTrader item 5 is not a sealed product' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/api/`
Expected: FAIL — rotte `/api/sealed*` e `/api/expansions` rispondono 404.

- [ ] **Step 3: Implement** — in `server/src/api/app.ts`:

Import: aggiungere `sealedInputSchema, sealedPreviewSchema, sealedUpdateSchema, type Expansion, type SealedProduct` all'import da `@ctzero/shared`; aggiungere

```ts
import { parseBlueprintRef, type SealedCatalog } from '../catalog/sealed-catalog';
import type { SealedService } from '../sealed/sealed-service';
```

`AppDeps`, dopo `cards`:

```ts
  sealed: Pick<SealedService, 'list' | 'create' | 'update' | 'delete' | 'preview'>;
  sealedCatalog: Pick<SealedCatalog, 'listExpansions' | 'sealedProducts' | 'sealedProduct'>;
```

Accanto agli altri schemi di query:

```ts
const sealedCatalogQuery = z.object({ expansionId: z.coerce.number().int().positive() });
const resolveQuery = z.object({ ref: z.string().trim().min(1) });
```

Rotte, dopo `GET /api/printings`:

```ts
  app.get('/api/sealed', async () => deps.sealed.list());

  app.post('/api/sealed', async (req, reply) => {
    const item = await deps.sealed.create(sealedInputSchema.parse(req.body));
    return reply.status(201).send(item);
  });

  app.put('/api/sealed/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return deps.sealed.update(id, sealedUpdateSchema.parse(req.body));
  });

  app.delete('/api/sealed/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    deps.sealed.delete(id);
    return reply.status(204).send();
  });

  app.post('/api/sealed/preview', async (req) => deps.sealed.preview(sealedPreviewSchema.parse(req.body)));

  app.get('/api/expansions', async (): Promise<Expansion[]> => deps.sealedCatalog.listExpansions());

  app.get(
    '/api/sealed/catalog',
    async (req): Promise<SealedProduct[]> =>
      deps.sealedCatalog.sealedProducts(sealedCatalogQuery.parse(req.query).expansionId),
  );

  app.get(
    '/api/sealed/resolve',
    async (req): Promise<SealedProduct> =>
      deps.sealedCatalog.sealedProduct(parseBlueprintRef(resolveQuery.parse(req.query).ref)),
  );
```

In `server/src/main.ts`: import

```ts
import { SealedCatalog } from './catalog/sealed-catalog';
import { SealedService } from './sealed/sealed-service';
```

dopo `const cards = ...`:

```ts
const sealedCatalog = new SealedCatalog(ct, () => catalog.mtgExpansions());
const sealed = new SealedService({ db, catalog: sealedCatalog, ct });
```

e in `buildApp({...})` aggiungere `sealed,` e `sealedCatalog,` dopo `cards,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/api/ && npm run typecheck`
Expected: PASS.

---

### Task 8: Stato generico in `card-status.ts`

**Files:**
- Modify: `web/src/card-status.ts`
- Test: `web/src/card-status.test.ts`

**Interfaces:**
- Produces: `type PricedItem = Pick<TrackedCard, 'name' | 'thresholdCents' | 'lastPriceCents' | 'lastSyncStatus' | 'alertState'>`; `cardStatus(item: PricedItem)`, `deltaPercent(item: PricedItem)`, `sortForDisplay<T extends PricedItem>(items: T[]): T[]`. Nomi invariati: `CardsPage.vue` non cambia.

- [ ] **Step 1: Write the failing test** — aggiungere in fondo a `web/src/card-status.test.ts` (aggiungere `TrackedSealed` all'import di tipo da `@ctzero/shared`):

```ts
describe('sealed products', () => {
  it('status, delta and sort work on TrackedSealed too', () => {
    const base: TrackedSealed = {
      id: 1,
      name: 'Box',
      blueprintId: 1,
      expansionId: 1,
      expansionName: 'MH3',
      categoryName: 'Booster Box',
      imageUrl: null,
      languages: [],
      thresholdCents: 20000,
      configVersion: 1,
      lastPriceCents: 19000,
      lastListing: null,
      lastSyncedAt: null,
      lastSyncStatus: 'ok',
      lastError: null,
      alertState: 'below',
      lastNotifiedPriceCents: 19000,
      createdAt: '',
      updatedAt: '',
    };
    const other: TrackedSealed = { ...base, id: 2, name: 'Another', alertState: 'above', lastPriceCents: 25000 };
    expect(cardStatus(base)).toBe('below');
    expect(deltaPercent(base)).toBe(-5);
    const sorted: TrackedSealed[] = sortForDisplay([other, base]);
    expect(sorted.map((s) => s.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — `TrackedSealed` non assegnabile a `TrackedCard` in `card-status.test.ts`. (Vitest da solo non controlla i tipi: la verifica rossa è il typecheck.)

- [ ] **Step 3: Implement** — in `web/src/card-status.ts`:

```ts
import type { TrackedCard } from '@ctzero/shared';

/** Fields shared by tracked cards and tracked sealed products. */
export type PricedItem = Pick<TrackedCard, 'name' | 'thresholdCents' | 'lastPriceCents' | 'lastSyncStatus' | 'alertState'>;
```

e cambiare le firme:

```ts
export function cardStatus(c: PricedItem): CardStatus {
```

```ts
export function deltaPercent(c: PricedItem): number | null {
```

```ts
export function sortForDisplay<T extends PricedItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => ORDER[cardStatus(a)] - ORDER[cardStatus(b)] || a.name.localeCompare(b.name, 'en'),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src/ && npm run typecheck`
Expected: PASS.

---

### Task 9: Dialog "Add / Edit sealed product"

**Files:**
- Create: `web/src/components/SealedDialog.vue`

**Interfaces:**
- Consumes: API di Task 7; tipi `Expansion`, `SealedProduct`, `TrackedSealed`, `PreviewResult`, `Language` (Task 1); `api` da `../api`.
- Produces: componente `<SealedDialog v-model:visible="..." :item="TrackedSealed | null" @saved="(item: TrackedSealed) => ..." />`.

Nessun test unitario per i componenti Vue nel repo: verifica con typecheck e build (Step 2) e con il controllo manuale in Task 10.

- [ ] **Step 1: Create the component** — `web/src/components/SealedDialog.vue`:

```vue
<script setup lang="ts">
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  euroToCents,
  formatEuro,
  type Expansion,
  type Language,
  type PreviewResult,
  type SealedProduct,
  type TrackedSealed,
} from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import { computed, ref, watch } from 'vue';
import { api } from '../api';

type Mode = 'expansion' | 'link';

const props = defineProps<{ item: TrackedSealed | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [item: TrackedSealed] }>();

const mode = ref<Mode>('expansion');
const expansions = ref<Expansion[]>([]);
const expansionId = ref<number | null>(null);
const products = ref<SealedProduct[]>([]);
const product = ref<SealedProduct | null>(null);
const link = ref('');
const languages = ref<Language[]>([]);
const preview = ref<PreviewResult | null>(null);
const thresholdEuro = ref<number | null>(null);
const error = ref<string | null>(null);
const loadingProducts = ref(false);
const resolving = ref(false);
const loadingPreview = ref(false);
const saving = ref(false);

const isEdit = computed(() => props.item !== null);
const modeOptions = [
  { label: 'From expansion', value: 'expansion' },
  { label: 'From link', value: 'link' },
];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));
const canSave = computed(() => product.value !== null && thresholdEuro.value !== null && thresholdEuro.value > 0);

watch(visible, (open) => {
  if (open) void reset();
});

// A preview computed for another product or other languages is no longer valid.
watch([product, languages], () => {
  preview.value = null;
});

watch(mode, () => {
  if (isEdit.value) return;
  product.value = null;
  error.value = null;
});

watch(expansionId, async (id) => {
  if (isEdit.value) return;
  product.value = null;
  products.value = [];
  if (id === null) return;
  loadingProducts.value = true;
  error.value = null;
  try {
    products.value = await api.get<SealedProduct[]>(`/api/sealed/catalog?expansionId=${id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingProducts.value = false;
  }
});

async function reset() {
  const s = props.item;
  error.value = null;
  mode.value = 'expansion';
  link.value = '';
  products.value = [];
  preview.value = null;
  languages.value = s ? [...s.languages] : [];
  thresholdEuro.value = s ? s.thresholdCents / 100 : null;
  if (s) {
    expansionId.value = s.expansionId;
    product.value = {
      blueprintId: s.blueprintId,
      name: s.name,
      expansionId: s.expansionId,
      expansionName: s.expansionName,
      categoryName: s.categoryName,
      imageUrl: s.imageUrl,
    };
    return;
  }
  expansionId.value = null;
  product.value = null;
  if (expansions.value.length === 0) {
    try {
      expansions.value = await api.get<Expansion[]>('/api/expansions');
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
}

async function resolveLink() {
  resolving.value = true;
  error.value = null;
  product.value = null;
  try {
    product.value = await api.get<SealedProduct>(`/api/sealed/resolve?ref=${encodeURIComponent(link.value)}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    resolving.value = false;
  }
}

async function calculate() {
  if (!product.value) return;
  loadingPreview.value = true;
  error.value = null;
  try {
    preview.value = await api.post<PreviewResult>('/api/sealed/preview', {
      blueprintId: product.value.blueprintId,
      languages: languages.value,
    });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingPreview.value = false;
  }
}

async function save() {
  if (!canSave.value || !product.value || thresholdEuro.value === null) return;
  saving.value = true;
  error.value = null;
  const payload = { languages: languages.value, thresholdCents: euroToCents(thresholdEuro.value) };
  try {
    const saved = props.item
      ? await api.put<TrackedSealed>(`/api/sealed/${props.item.id}`, payload)
      : await api.post<TrackedSealed>('/api/sealed', { blueprintId: product.value.blueprintId, ...payload });
    emit('saved', saved);
    visible.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="isEdit ? 'Edit sealed product' : 'Add sealed product'"
    :style="{ width: '46rem' }"
  >
    <template v-if="!isEdit">
      <div class="field">
        <SelectButton v-model="mode" :options="modeOptions" option-label="label" option-value="value" :allow-empty="false" />
      </div>

      <div v-if="mode === 'expansion'">
        <div class="field">
          <label for="expansion">Expansion</label>
          <Select
            v-model="expansionId"
            input-id="expansion"
            :options="expansions"
            option-label="name"
            option-value="id"
            placeholder="Search an expansion"
            filter
            :virtual-scroller-options="{ itemSize: 38 }"
            fluid
          />
        </div>
        <div v-if="expansionId !== null" class="field">
          <label for="product">Product</label>
          <Select
            v-model="product"
            input-id="product"
            :options="products"
            option-label="name"
            data-key="blueprintId"
            :loading="loadingProducts"
            placeholder="Select a product"
            empty-message="No sealed products for this expansion"
            filter
            fluid
          >
            <template #option="{ option }">
              <div class="product-option">
                <img v-if="option.imageUrl" :src="option.imageUrl" :alt="option.name" />
                <div>
                  <div>{{ option.name }}</div>
                  <small class="muted">{{ option.categoryName }}</small>
                </div>
              </div>
            </template>
          </Select>
        </div>
      </div>

      <div v-else class="field">
        <label for="link">CardTrader link or id</label>
        <div class="link-row">
          <InputText
            id="link"
            v-model="link"
            placeholder="https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit"
            fluid
            @keyup.enter="resolveLink"
          />
          <Button label="Find" icon="pi pi-search" :loading="resolving" :disabled="!link.trim()" @click="resolveLink" />
        </div>
      </div>
    </template>

    <div v-if="product" class="lookup">
      <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" class="sealed-thumb" />
      <div class="filters">
        <p>
          <strong>{{ product.name }}</strong><br />
          <span class="muted">{{ product.expansionName }} · {{ product.categoryName }}</span>
        </p>
        <div class="field">
          <label for="languages">Languages</label>
          <MultiSelect
            v-model="languages"
            input-id="languages"
            :options="languageOptions"
            option-label="label"
            option-value="code"
            placeholder="Any language"
            display="chip"
            fluid
          />
        </div>
      </div>
    </div>

    <div v-if="product" class="pricing">
      <Button
        label="Calculate price"
        icon="pi pi-calculator"
        severity="secondary"
        :loading="loadingPreview"
        @click="calculate"
      />
      <div v-if="preview" class="preview">
        <p v-if="preview.listing">
          Current CT Zero price: <strong>{{ formatEuro(preview.listing.priceCents) }}</strong> —
          {{ preview.listing.language.toUpperCase() }}
          <a :href="preview.listing.url" target="_blank" rel="noopener">open</a>
        </p>
        <p v-else>No valid CT Zero offers right now.</p>
        <div class="presets">
          <Button
            v-for="preset in preview.presets"
            :key="preset.label"
            :label="`${preset.label} · ${formatEuro(preset.cents)}`"
            size="small"
            outlined
            @click="thresholdEuro = preset.cents / 100"
          />
        </div>
      </div>
      <div class="field">
        <label for="threshold">Notification threshold</label>
        <InputNumber
          v-model="thresholdEuro"
          input-id="threshold"
          mode="currency"
          currency="EUR"
          locale="en-US"
          :min="0.01"
        />
      </div>
    </div>

    <Message v-if="error" severity="error">{{ error }}</Message>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Save" icon="pi pi-check" :disabled="!canSave" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.lookup {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}
.filters {
  flex: 1;
}
.sealed-thumb {
  width: 120px;
  border-radius: 6px;
}
.product-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.product-option img {
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.link-row {
  display: flex;
  gap: 0.5rem;
}
.pricing {
  border-top: 1px solid #e5e7eb;
  padding-top: 1rem;
  margin-top: 0.5rem;
}
.preview {
  margin: 0.75rem 0;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck && npm run build`
Expected: nessun errore (il componente non è ancora montato da nessuna pagina: verrà usato in Task 10).

---

### Task 10: Pagina Sealed, navigazione e testo di avanzamento

**Files:**
- Create: `web/src/pages/SealedPage.vue`
- Modify: `web/src/router.ts`, `web/src/App.vue`, `web/src/components/SyncHeader.vue`

**Interfaces:**
- Consumes: `SealedDialog` (Task 9); `STATUS_META`, `cardStatus`, `deltaPercent`, `formatDateTime`, `sortForDisplay` (Task 8); `SyncHeader` (emette `finished`).

- [ ] **Step 1: Create the page** — `web/src/pages/SealedPage.vue`:

```vue
<script setup lang="ts">
import { LANGUAGE_LABELS, formatEuro, type TrackedSealed } from '@ctzero/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { STATUS_META, cardStatus, deltaPercent, formatDateTime, sortForDisplay } from '../card-status';
import SealedDialog from '../components/SealedDialog.vue';
import SyncHeader from '../components/SyncHeader.vue';

const toast = useToast();
const confirm = useConfirm();
const items = ref<TrackedSealed[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<TrackedSealed | null>(null);
const rows = computed(() => sortForDisplay(items.value));

const PREVIEW_SIZE = 300;
const preview = ref<{ src: string; alt: string; top: number; left: number } | null>(null);

// Stored images are CardTrader "preview_" thumbnails: "show_" is the larger version.
function largeImage(url: string): string {
  return url.replace('/preview_', '/show_');
}

function showPreview(event: MouseEvent, item: TrackedSealed) {
  if (!item.imageUrl) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const margin = 8;
  const top = Math.min(
    Math.max(margin, rect.top + rect.height / 2 - PREVIEW_SIZE / 2),
    window.innerHeight - PREVIEW_SIZE - margin,
  );
  preview.value = { src: largeImage(item.imageUrl), alt: item.name, top, left: rect.right + 12 };
}

function hidePreview() {
  preview.value = null;
}

async function load() {
  loading.value = true;
  try {
    items.value = await api.get<TrackedSealed[]>('/api/sealed');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editing.value = null;
  dialogVisible.value = true;
}

function openEdit(item: TrackedSealed) {
  editing.value = item;
  dialogVisible.value = true;
}

function onSaved(item: TrackedSealed) {
  toast.add({ severity: 'success', summary: `${item.name} saved`, life: 3000 });
  load();
}

function confirmDelete(item: TrackedSealed) {
  confirm.require({
    message: `Stop tracking "${item.name}"?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.del(`/api/sealed/${item.id}`);
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
      }
      await load();
    },
  });
}

function filterChips(item: TrackedSealed): string[] {
  return [
    item.categoryName,
    item.languages.length > 0 ? item.languages.map((l) => LANGUAGE_LABELS[l]).join(', ') : 'Any language',
  ];
}

function formatDelta(item: TrackedSealed): string {
  const d = deltaPercent(item);
  if (d === null) return '—';
  return `${d > 0 ? '+' : ''}${d.toLocaleString('en-US')}%`;
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Tracked sealed products</h1>
    <Button label="Add sealed product" icon="pi pi-plus" @click="openNew" />
  </div>

  <SyncHeader @finished="load" />

  <DataTable :value="rows" :loading="loading" data-key="id" striped-rows>
    <template #empty>No tracked sealed products. Add one with "Add sealed product".</template>
    <Column header="" style="width: 64px">
      <template #body="{ data }">
        <img
          v-if="data.imageUrl"
          :src="data.imageUrl"
          :alt="data.name"
          class="row-thumb"
          @mouseenter="showPreview($event, data)"
          @mouseleave="hidePreview"
        />
      </template>
    </Column>
    <Column field="name" header="Product">
      <template #body="{ data }">
        <strong>{{ data.name }}</strong>
        <div class="muted">{{ data.expansionName }}</div>
        <div class="chips">
          <Tag v-for="chip in filterChips(data)" :key="chip" :value="chip" severity="secondary" />
        </div>
      </template>
    </Column>
    <Column header="CT Zero price">
      <template #body="{ data }">
        <template v-if="data.lastPriceCents !== null">
          <strong>{{ formatEuro(data.lastPriceCents) }}</strong>
          <div v-if="data.lastListing" class="muted">{{ data.lastListing.language.toUpperCase() }}</div>
        </template>
        <span v-else>—</span>
      </template>
    </Column>
    <Column header="Threshold">
      <template #body="{ data }">{{ formatEuro(data.thresholdCents) }}</template>
    </Column>
    <Column header="Δ threshold">
      <template #body="{ data }">
        <span :class="(deltaPercent(data) ?? 0) <= 0 ? 'price-down' : 'price-up'">{{ formatDelta(data) }}</span>
      </template>
    </Column>
    <Column header="Status">
      <template #body="{ data }">
        <Tag
          v-tooltip.top="data.lastError ?? undefined"
          :value="STATUS_META[cardStatus(data)].label"
          :severity="STATUS_META[cardStatus(data)].severity"
        />
      </template>
    </Column>
    <Column header="Updated">
      <template #body="{ data }">{{ formatDateTime(data.lastSyncedAt) }}</template>
    </Column>
    <Column header="" style="width: 9rem">
      <template #body="{ data }">
        <div class="row-actions">
          <a :href="`https://www.cardtrader.com/cards/${data.blueprintId}`" target="_blank" rel="noopener">
            <Button v-tooltip.top="'Open on CardTrader'" icon="pi pi-external-link" text rounded />
          </a>
          <Button v-tooltip.top="'Edit'" icon="pi pi-pencil" text rounded @click="openEdit(data)" />
          <Button
            v-tooltip.top="'Delete'"
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            @click="confirmDelete(data)"
          />
        </div>
      </template>
    </Column>
  </DataTable>

  <SealedDialog v-model:visible="dialogVisible" :item="editing" @saved="onSaved" />

  <Teleport to="body">
    <img
      v-if="preview"
      :src="preview.src"
      :alt="preview.alt"
      class="sealed-preview"
      :style="{ top: `${preview.top}px`, left: `${preview.left}px`, width: `${PREVIEW_SIZE}px` }"
    />
  </Teleport>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.row-actions {
  display: flex;
  align-items: center;
}
.row-thumb {
  cursor: zoom-in;
}
.sealed-preview {
  position: fixed;
  z-index: 1100;
  max-height: 300px;
  object-fit: contain;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
</style>
```

- [ ] **Step 2: Wire router, nav and progress text**

`web/src/router.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import CardsPage from './pages/CardsPage.vue';
import SealedPage from './pages/SealedPage.vue';
import SettingsPage from './pages/SettingsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: CardsPage },
    { path: '/sealed', component: SealedPage },
    { path: '/settings', component: SettingsPage },
  ],
});
```

`web/src/App.vue`, nel `<nav>`:

```vue
      <RouterLink to="/">Cards</RouterLink>
      <RouterLink to="/sealed">Sealed</RouterLink>
      <RouterLink to="/settings">Settings</RouterLink>
```

`web/src/components/SyncHeader.vue`: il contatore ora include i sealed:

```vue
        <small>{{ running.cardsDone }}/{{ running.cardsTotal }} items</small>
```

- [ ] **Step 3: Verify build and typecheck**

Run: `npm run typecheck && npm run build`
Expected: nessun errore.

- [ ] **Step 4: Manual check in the browser** — `npm run dev:server` e `npm run dev:web`, aprire http://localhost:5173/sealed:
  - "Add sealed product" → Expansion "Modern Horizons 3" → il select mostra Play/Collector Booster Box, Bundle, Booster, Prerelease Pack (niente dadi, playmat, singole);
  - "From link" → incollare `https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit` → Find → prodotto trovato;
  - Calculate price → prezzo e preset; salvare → riga in tabella con stato coerente; hover sulla miniatura → anteprima grande;
  - modificare la sola soglia → nessun ricalcolo del prezzo; cambiare lingue → prezzo ricalcolato;
  - "Update now" → contatore "x/y items" che include carte + sealed.

---

### Task 11: README e verifica finale

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README** — prima riga descrittiva:

```markdown
Tracks the minimum **CardTrader Zero** price of Magic cards and sealed products (booster boxes, boosters, bundles, Commander precons, Secret Lairs, ...) and notifies you on Telegram when it drops below your chosen threshold.
```

In "Known limitations" aggiungere:

```markdown
- Sealed products: only listings still sealed are considered (opened Secret Lairs are ignored). Adding a product from a CardTrader link requires the product to have at least one listing; otherwise select it from its expansion.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: tutti i test PASS, nessun errore di tipo, build ok.

- [ ] **Step 3: Smoke test reale** (con token veri, `npm start`): tracciare un box e un precon Commander con soglia sopra il prezzo attuale → lanciare "Update now" → arriva un unico messaggio Telegram con le righe 📦. Riportare all'utente che le modifiche sono pronte per il commit (senza committare).
