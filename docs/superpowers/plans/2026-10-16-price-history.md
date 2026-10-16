# Price History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the price history already stored in `price_snapshots` / `sealed_price_snapshots`: a chart dialog per tracked card and sealed product, plus a 30-day sparkline and 7-day % change in the Cards and Sealed tables.

**Architecture:** No migration. The server computes a `PriceTrend` per item with a pure `computeTrend` (current filter configuration only) from one batched query per list, and adds it to `GET /api/cards` / `GET /api/sealed`. Two new endpoints return the full history of one item. The web side has a pure `price-history.ts` module (range filter, chart series, stats, axis bounds, sparkline geometry, change formatting), a hand-written SVG `PriceSparkline.vue` and a `PriceHistoryDialog.vue` built on `primevue/chart` + Chart.js with an inline plugin for the threshold line and the "Filters changed" markers.

**Tech Stack:** Node 24 (`node:sqlite`), Fastify 5, zod 4, Vue 3 + PrimeVue 4.5 + Chart.js 4.5, vitest 5, TypeScript 5.9 (npm workspaces `shared`, `server`, `web`).

**Spec:** `docs/superpowers/specs/2026-10-16-price-history-design.md`

## Global Constraints

- **No migration**: snapshots already have `config_version`, `synced_at` (UTC ISO from `toISOString()`, so string comparison is chronological), `price_cents` (null = no offers). Snapshot order is `ORDER BY id`.
- Trend (sparkline, `change7dPct`) and the dialog stats use **only the current `configVersion`**; the chart shows **all** history, breaking the line and drawing a "Filters changed" marker where `configVersion` changes.
- Sparkline window **30 days**; change window **7 days**; `change7dPct` rounded to **one decimal**, never `-0`.
- The threshold in the chart is the **current** threshold.
- `TrackedCard` / `TrackedSealed` stay unchanged; lists return `TrackedCardRow` / `TrackedSealedRow` (`& { trend: PriceTrend }`).
- Only new dependency: `chart.js` (`^4.5.1`) in `web/package.json`. No `chartjs-plugin-annotation`, no date adapter.
- UI text in **English**, number format like the rest of the UI (`-12.3%`, `+5.0%`, `€1,234.50` via `formatEuro`). Code comments in English.
- `web/tsconfig.json` targets **ES2022**: no `Array.prototype.findLast` in `web/src` (fine on the server, ES2023).
- **No `git commit`**: the user commits manually when they ask. Each task ends with a checkpoint (tests + typecheck green), not a commit.
- Commands run from the repo root: `npx vitest run <file>`, `npm test`, `npm run typecheck`.

## Review Focus

1. A tiny price move (e.g. €1,000.00 → €999.99) must not show as red/green `-0.0%`: `change7dPct` is `0`, never `-0`, and `formatChange(0)` is neutral → tests in Task 1 and Task 5.
2. After changing a card's filters, snapshots of the old configuration from the last 30 days must not leak into the sparkline or the 7-day change → tests in Task 1 (`computeTrend`) and Task 2 (repo JOIN).
3. A range (30 d / 90 d) that starts in the middle of an older configuration must not draw a "Filters changed" marker at its left edge → test in Task 5 (`buildSeries`).
4. A threshold far from the prices (e.g. €1 threshold, €50 price) or a period with only "no offers" points must still show the threshold line and the crosses → tests in Task 5 (`axisBounds`).
5. A flat price (all snapshots identical) must draw a flat sparkline, not `NaN` coordinates → test in Task 5 (`sparklinePoints`).

---

## File Structure

**shared**
- Modify `shared/src/types.ts` — `PriceTrend`, `TrackedCardRow`, `TrackedSealedRow`, `PricePoint`, `PriceHistoryDto`.

**server**
- Create `server/src/pricing/trend.ts` — pure `computeTrend`, `trendSince`.
- Modify `server/src/db/cards-repo.ts` — `groupSnapshots`, `listRecentSnapshotsByCard`.
- Modify `server/src/db/sealed-repo.ts` — `listRecentSealedSnapshots`.
- Modify `server/src/cards/card-service.ts` — `list()` with trend, `history(id)`.
- Modify `server/src/sealed/sealed-service.ts` — `list()` with trend, `history(id)`.
- Modify `server/src/api/app.ts` — two `/history` routes, `history` in `AppDeps`.

**web**
- Create `web/src/price-history.ts` — pure helpers for the dialog and the Trend column.
- Create `web/src/components/PriceSparkline.vue`.
- Create `web/src/components/PriceHistoryDialog.vue`.
- Modify `web/src/pages/CardsPage.vue`, `web/src/pages/SealedPage.vue` — Trend column, history button, dialog.
- Modify `web/src/style.css` — `.trend-cell`.
- Modify `web/package.json` — `chart.js`.

**docs**
- Modify `README.md` — one "Price history" bullet under Usage.

---

### Task 1: Shared types and `computeTrend`

**Files:**
- Modify: `shared/src/types.ts` (append after `TrackedSealed`)
- Create: `server/src/pricing/trend.ts`
- Test: `server/src/pricing/trend.test.ts`

**Interfaces:**
- Consumes: `Snapshot` from `server/src/db/cards-repo.ts` (`{ configVersion: number; syncedAt: string; priceCents: number | null }`).
- Produces:
  - `PriceTrend`, `TrackedCardRow`, `TrackedSealedRow`, `PricePoint`, `PriceHistoryDto` in `@ctzero/shared`.
  - `computeTrend(snapshots: Snapshot[], currentConfigVersion: number, now: Date): PriceTrend`
  - `trendSince(now: Date): string` — ISO start of the 30-day window.

- [ ] **Step 1: Add the shared types**

Append to `shared/src/types.ts` (after the `TrackedSealed` interface):

```ts
/** Recent price trend of a tracked item, current filter configuration only. */
export interface PriceTrend {
  /** Snapshots with a price from the last 30 days, oldest first. */
  sparkline: { t: string; priceCents: number }[];
  /** % change (one decimal) between the latest snapshot and the one ~7 days earlier; null if unknown. */
  change7dPct: number | null;
}

export type TrackedCardRow = TrackedCard & { trend: PriceTrend };
export type TrackedSealedRow = TrackedSealed & { trend: PriceTrend };

export interface PricePoint {
  syncedAt: string;
  /** null = no offers at that time. */
  priceCents: number | null;
  configVersion: number;
}

export interface PriceHistoryDto {
  /** Current threshold (the history does not record past thresholds). */
  thresholdCents: number;
  /** Current filter configuration. */
  configVersion: number;
  /** All snapshots, oldest first. */
  points: PricePoint[];
}
```

- [ ] **Step 2: Write the failing test**

Create `server/src/pricing/trend.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../db/cards-repo';
import { computeTrend, trendSince } from './trend';

const now = new Date('2026-10-16T09:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const snap = (d: number, priceCents: number | null, configVersion = 1): Snapshot => ({
  configVersion,
  syncedAt: daysAgo(d),
  priceCents,
});

describe('computeTrend', () => {
  it('empty history', () => {
    expect(computeTrend([], 1, now)).toEqual({ sparkline: [], change7dPct: null });
  });

  it('sparkline keeps the last 30 days of the current configuration with a price, oldest first', () => {
    const trend = computeTrend([snap(40, 500), snap(30, 480), snap(20, null), snap(10, 450), snap(5, 400)], 1, now);
    expect(trend.sparkline).toEqual([
      { t: daysAgo(30), priceCents: 480 },
      { t: daysAgo(10), priceCents: 450 },
      { t: daysAgo(5), priceCents: 400 },
    ]);
  });

  it('ignores snapshots of other configurations', () => {
    const trend = computeTrend([snap(20, 100, 1), snap(10, 900, 2), snap(1, 1000, 2)], 2, now);
    expect(trend.sparkline.map((p) => p.priceCents)).toEqual([900, 1000]);
    expect(trend.change7dPct).toBe(11.1);
  });

  it('change compares the latest snapshot with the most recent one at least 7 days old', () => {
    expect(computeTrend([snap(14, 1000), snap(9, 800), snap(3, 700), snap(0, 600)], 1, now).change7dPct).toBe(-25);
  });

  it('a snapshot exactly 7 days old is a valid reference', () => {
    expect(computeTrend([snap(7, 1000), snap(0, 1100)], 1, now).change7dPct).toBe(10);
  });

  it('irregular gaps: the reference can be much older than 7 days', () => {
    expect(computeTrend([snap(25, 1000), snap(1, 900)], 1, now).change7dPct).toBe(-10);
  });

  it('the reference skips snapshots without offers', () => {
    expect(computeTrend([snap(12, 1000), snap(8, null), snap(0, 900)], 1, now).change7dPct).toBe(-10);
  });

  it('null when the current configuration has less than 7 days of history', () => {
    expect(computeTrend([snap(20, 1000, 1), snap(5, 800, 2), snap(0, 700, 2)], 2, now).change7dPct).toBeNull();
  });

  it('null when the latest snapshot has no offers', () => {
    const trend = computeTrend([snap(10, 1000), snap(0, null)], 1, now);
    expect(trend.change7dPct).toBeNull();
    expect(trend.sparkline).toEqual([{ t: daysAgo(10), priceCents: 1000 }]);
  });

  it('rounds to one decimal and never returns -0', () => {
    expect(computeTrend([snap(8, 300), snap(0, 299)], 1, now).change7dPct).toBe(-0.3);
    // -0.001% rounds to -0: toBe uses Object.is, so this fails on -0.
    expect(computeTrend([snap(8, 100000), snap(0, 99999)], 1, now).change7dPct).toBe(0);
  });
});

describe('trendSince', () => {
  it('is 30 days before now', () => {
    expect(trendSince(now)).toBe(daysAgo(30));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/src/pricing/trend.test.ts`
Expected: FAIL, cannot resolve `./trend`.

- [ ] **Step 4: Write the implementation**

Create `server/src/pricing/trend.ts`:

```ts
import type { PriceTrend } from '@ctzero/shared';
import type { Snapshot } from '../db/cards-repo';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SPARKLINE_DAYS = 30;
export const CHANGE_DAYS = 7;

/** Start (ISO) of the window the trend looks at. */
export function trendSince(now: Date): string {
  return new Date(now.getTime() - SPARKLINE_DAYS * DAY_MS).toISOString();
}

/**
 * Trend of one item from its snapshots (oldest first). Only the current filter configuration
 * counts: older configurations priced a different set of listings.
 */
export function computeTrend(snapshots: Snapshot[], currentConfigVersion: number, now: Date): PriceTrend {
  const since = Date.parse(trendSince(now));
  const current = snapshots.filter((s) => s.configVersion === currentConfigVersion && Date.parse(s.syncedAt) >= since);
  const sparkline = current.flatMap((s) => (s.priceCents === null ? [] : [{ t: s.syncedAt, priceCents: s.priceCents }]));
  return { sparkline, change7dPct: changePct(current, now) };
}

function changePct(current: Snapshot[], now: Date): number | null {
  const latest = current.at(-1);
  if (!latest || latest.priceCents === null) return null;
  const refTime = now.getTime() - CHANGE_DAYS * DAY_MS;
  const ref = current.findLast((s) => s.priceCents !== null && Date.parse(s.syncedAt) <= refTime);
  if (!ref || ref.priceCents === null) return null;
  const pct = Math.round(((latest.priceCents - ref.priceCents) / ref.priceCents) * 1000) / 10;
  // Math.round(-0.01) is -0, which would print as "-0.0%".
  return pct === 0 ? 0 : pct;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/src/pricing/trend.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Checkpoint**

Run: `npm run typecheck`
Expected: no errors. Do not commit.

---

### Task 2: Recent snapshots queries

**Files:**
- Modify: `server/src/db/cards-repo.ts` (after `listSnapshots`)
- Modify: `server/src/db/sealed-repo.ts` (after `listSealedSnapshots`)
- Test: `server/src/db/repos.test.ts`, `server/src/db/sealed-repo.test.ts`

**Interfaces:**
- Consumes: `Snapshot` (existing).
- Produces:
  - `groupSnapshots(rows: (Snapshot & { ownerId: number })[]): Map<number, Snapshot[]>` (cards-repo, exported for sealed-repo)
  - `listRecentSnapshotsByCard(db: Db, sinceIso: string): Map<number, Snapshot[]>`
  - `listRecentSealedSnapshots(db: Db, sinceIso: string): Map<number, Snapshot[]>`

- [ ] **Step 1: Write the failing tests**

In `server/src/db/repos.test.ts`, add `listRecentSnapshotsByCard` to the import from `./cards-repo`, and add inside `describe('cards-repo', ...)` (after the `'snapshot with null price'` test):

```ts
  it('listRecentSnapshotsByCard keeps recent snapshots of the current configuration, grouped by card', () => {
    const a = insertCard(db, newCard, t0);
    const b = insertCard(db, { ...newCard, name: 'Abrade' }, t0);
    updateCard(db, b.id, { configVersion: 2 }, t0);
    insertSnapshot(db, { cardId: a.id, configVersion: 1, syncedAt: '2026-09-01T00:00:00.000Z', priceCents: 90 });
    insertSnapshot(db, { cardId: a.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 100 });
    insertSnapshot(db, { cardId: b.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 500 });
    insertSnapshot(db, { cardId: a.id, configVersion: 1, syncedAt: t1.toISOString(), priceCents: null });
    insertSnapshot(db, { cardId: b.id, configVersion: 2, syncedAt: t1.toISOString(), priceCents: 400 });
    expect(listRecentSnapshotsByCard(db, '2026-10-01T00:00:00.000Z')).toEqual(
      new Map([
        [
          a.id,
          [
            { configVersion: 1, syncedAt: t0.toISOString(), priceCents: 100 },
            { configVersion: 1, syncedAt: t1.toISOString(), priceCents: null },
          ],
        ],
        [b.id, [{ configVersion: 2, syncedAt: t1.toISOString(), priceCents: 400 }]],
      ]),
    );
  });
```


In `server/src/db/sealed-repo.test.ts`, add `listRecentSealedSnapshots` to the import from `./sealed-repo`, and add inside `describe('sealed-repo', ...)`:

```ts
  it('listRecentSealedSnapshots keeps recent snapshots of the current configuration, grouped by product', () => {
    const a = insertSealed(db, box, t0);
    const b = insertSealed(db, { ...box, name: 'Bloomburrow: Play Booster Box' }, t0);
    updateSealed(db, b.id, { configVersion: 2 }, t0);
    insertSealedSnapshot(db, { sealedId: a.id, configVersion: 1, syncedAt: '2026-09-01T00:00:00.000Z', priceCents: 18000 });
    insertSealedSnapshot(db, { sealedId: a.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 19000 });
    insertSealedSnapshot(db, { sealedId: b.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 15000 });
    insertSealedSnapshot(db, { sealedId: b.id, configVersion: 2, syncedAt: t1.toISOString(), priceCents: null });
    expect(listRecentSealedSnapshots(db, '2026-10-01T00:00:00.000Z')).toEqual(
      new Map([
        [a.id, [{ configVersion: 1, syncedAt: t0.toISOString(), priceCents: 19000 }]],
        [b.id, [{ configVersion: 2, syncedAt: t1.toISOString(), priceCents: null }]],
      ]),
    );
  });
```


- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/db/repos.test.ts server/src/db/sealed-repo.test.ts`
Expected: FAIL, `listRecentSnapshotsByCard` / `listRecentSealedSnapshots` is not a function.

- [ ] **Step 3: Implement**

In `server/src/db/cards-repo.ts`, after `listSnapshots`:

```ts
/** Groups snapshot rows (oldest first) by the id of the item they belong to. */
export function groupSnapshots(rows: (Snapshot & { ownerId: number })[]): Map<number, Snapshot[]> {
  const byOwner = new Map<number, Snapshot[]>();
  for (const { ownerId, configVersion, syncedAt, priceCents } of rows) {
    const list = byOwner.get(ownerId) ?? [];
    list.push({ configVersion, syncedAt, priceCents });
    byOwner.set(ownerId, list);
  }
  return byOwner;
}

/** Snapshots since `sinceIso` of each card's current configuration, oldest first, keyed by card id. */
export function listRecentSnapshotsByCard(db: Db, sinceIso: string): Map<number, Snapshot[]> {
  const rows = db
    .prepare(
      `SELECT s.tracked_card_id AS ownerId, s.config_version AS configVersion, s.synced_at AS syncedAt,
              s.price_cents AS priceCents
       FROM price_snapshots s
       JOIN tracked_cards c ON c.id = s.tracked_card_id AND c.config_version = s.config_version
       WHERE s.synced_at >= ?
       ORDER BY s.id`,
    )
    .all(sinceIso) as unknown as (Snapshot & { ownerId: number })[];
  return groupSnapshots(rows);
}
```

In `server/src/db/sealed-repo.ts`, change the import `import type { Snapshot } from './cards-repo';` to:

```ts
import { groupSnapshots, type Snapshot } from './cards-repo';
```

and add after `listSealedSnapshots`:

```ts
/** Snapshots since `sinceIso` of each product's current configuration, oldest first, keyed by product id. */
export function listRecentSealedSnapshots(db: Db, sinceIso: string): Map<number, Snapshot[]> {
  const rows = db
    .prepare(
      `SELECT s.tracked_sealed_id AS ownerId, s.config_version AS configVersion, s.synced_at AS syncedAt,
              s.price_cents AS priceCents
       FROM sealed_price_snapshots s
       JOIN tracked_sealed t ON t.id = s.tracked_sealed_id AND t.config_version = s.config_version
       WHERE s.synced_at >= ?
       ORDER BY s.id`,
    )
    .all(sinceIso) as unknown as (Snapshot & { ownerId: number })[];
  return groupSnapshots(rows);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/db/repos.test.ts server/src/db/sealed-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `npm run typecheck`
Expected: no errors. Do not commit.

---

### Task 3: Services — trend in lists, history

**Files:**
- Modify: `server/src/cards/card-service.ts` (`list()` at ~line 62, add `history`)
- Modify: `server/src/sealed/sealed-service.ts` (`list()` at ~line 36, add `history`)
- Test: `server/src/cards/card-service.test.ts`, `server/src/sealed/sealed-service.test.ts`

**Interfaces:**
- Consumes: `computeTrend`, `trendSince` (Task 1); `listRecentSnapshotsByCard`, `listRecentSealedSnapshots` (Task 2); existing `listSnapshots`, `listSealedSnapshots`, `getCard`, `getSealed`.
- Produces:
  - `CardService.list(): TrackedCardRow[]`, `CardService.history(id: number): PriceHistoryDto` (throws `NotFoundError('Card not found')`)
  - `SealedService.list(): TrackedSealedRow[]`, `SealedService.history(id: number): PriceHistoryDto` (throws `NotFoundError('Sealed product not found')`)

- [ ] **Step 1: Write the failing tests (cards)**

In `server/src/cards/card-service.test.ts`, extend the repo import to `import { getBlueprints, getCard, insertCard, insertSnapshot, listCards, listSnapshots, updateCard } from '../db/cards-repo';` and append:

```ts
describe('list and history', () => {
  const newCard = {
    name: 'Ragavan, Nimble Pilferer',
    scryfallOracleId: 'o1',
    imageUrl: null,
    expansionIds: [],
    languages: [],
    minCondition: 'Near Mint' as const,
    foil: false,
    thresholdCents: 4000,
  };

  it('list adds the trend of the current configuration', () => {
    const card = insertCard(db, newCard, t0);
    const other = insertCard(db, { ...newCard, name: 'Abrade' }, t0);
    // t0 is 2026-10-02T10:00Z: 10 days earlier is a valid 7-day reference.
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: '2026-09-22T10:00:00.000Z', priceCents: 4000 });
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 3000 });
    const rows = service.list();
    expect(rows.find((r) => r.id === card.id)).toEqual({
      ...getCard(db, card.id),
      trend: {
        sparkline: [
          { t: '2026-09-22T10:00:00.000Z', priceCents: 4000 },
          { t: t0.toISOString(), priceCents: 3000 },
        ],
        change7dPct: -25,
      },
    });
    expect(rows.find((r) => r.id === other.id)?.trend).toEqual({ sparkline: [], change7dPct: null });
  });

  it('history returns every snapshot with the current threshold and configuration', () => {
    const card = insertCard(db, newCard, t0);
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: '2026-09-22T10:00:00.000Z', priceCents: 4000 });
    updateCard(db, card.id, { configVersion: 2 }, t0);
    insertSnapshot(db, { cardId: card.id, configVersion: 2, syncedAt: t0.toISOString(), priceCents: null });
    expect(service.history(card.id)).toEqual({
      thresholdCents: 4000,
      configVersion: 2,
      points: [
        { configVersion: 1, syncedAt: '2026-09-22T10:00:00.000Z', priceCents: 4000 },
        { configVersion: 2, syncedAt: t0.toISOString(), priceCents: null },
      ],
    });
  });

  it('history of a missing card → NotFoundError', () => {
    expect(() => service.history(999)).toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Write the failing tests (sealed)**

In `server/src/sealed/sealed-service.test.ts`, extend the repo import to `import { getSealed, insertSealed, insertSealedSnapshot, listSealedSnapshots, updateSealed } from '../db/sealed-repo';` and append:

```ts
describe('list and history', () => {
  const newSealed = { ...product, languages: ['en' as const], thresholdCents: 20000 };

  it('list adds the trend of the current configuration', () => {
    const item = insertSealed(db, newSealed, t0);
    // t0 is 2026-10-07T10:00Z.
    insertSealedSnapshot(db, { sealedId: item.id, configVersion: 1, syncedAt: '2026-09-27T10:00:00.000Z', priceCents: 20000 });
    insertSealedSnapshot(db, { sealedId: item.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 19000 });
    expect(service.list()).toEqual([
      {
        ...getSealed(db, item.id),
        trend: {
          sparkline: [
            { t: '2026-09-27T10:00:00.000Z', priceCents: 20000 },
            { t: t0.toISOString(), priceCents: 19000 },
          ],
          change7dPct: -5,
        },
      },
    ]);
  });

  it('history returns every snapshot with the current threshold and configuration', () => {
    const item = insertSealed(db, newSealed, t0);
    insertSealedSnapshot(db, { sealedId: item.id, configVersion: 1, syncedAt: '2026-09-27T10:00:00.000Z', priceCents: 20000 });
    updateSealed(db, item.id, { configVersion: 2 }, t0);
    expect(service.history(item.id)).toEqual({
      thresholdCents: 20000,
      configVersion: 2,
      points: [{ configVersion: 1, syncedAt: '2026-09-27T10:00:00.000Z', priceCents: 20000 }],
    });
  });

  it('history of a missing product → NotFoundError', () => {
    expect(() => service.history(999)).toThrow(NotFoundError);
  });
});
```


- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/src/cards/card-service.test.ts server/src/sealed/sealed-service.test.ts`
Expected: FAIL, `trend` missing from list rows and `service.history is not a function`.

- [ ] **Step 4: Implement (cards)**

In `server/src/cards/card-service.ts`:
- add `type PriceHistoryDto` and `type TrackedCardRow` to the `@ctzero/shared` import;
- add `listRecentSnapshotsByCard` and `listSnapshots` to the `../db/cards-repo` import;
- add `import { computeTrend, trendSince } from '../pricing/trend';`
- replace `list()` and add `history` right after it:

```ts
  list(): TrackedCardRow[] {
    const { db } = this.deps;
    const now = this.now();
    const recent = listRecentSnapshotsByCard(db, trendSince(now));
    return listCards(db).map((card) => ({
      ...card,
      trend: computeTrend(recent.get(card.id) ?? [], card.configVersion, now),
    }));
  }

  history(id: number): PriceHistoryDto {
    const { db } = this.deps;
    const card = getCard(db, id);
    if (!card) throw new NotFoundError('Card not found');
    return { thresholdCents: card.thresholdCents, configVersion: card.configVersion, points: listSnapshots(db, id) };
  }
```

- [ ] **Step 5: Implement (sealed)**

In `server/src/sealed/sealed-service.ts`:
- add `type PriceHistoryDto` and `type TrackedSealedRow` to the `@ctzero/shared` import;
- add `listRecentSealedSnapshots` and `listSealedSnapshots` to the `../db/sealed-repo` import (keep the existing names);
- add `import { computeTrend, trendSince } from '../pricing/trend';`
- replace `list()` and add `history` right after it:

```ts
  list(): TrackedSealedRow[] {
    const { db } = this.deps;
    const now = this.now();
    const recent = listRecentSealedSnapshots(db, trendSince(now));
    return listSealed(db).map((item) => ({
      ...item,
      trend: computeTrend(recent.get(item.id) ?? [], item.configVersion, now),
    }));
  }

  history(id: number): PriceHistoryDto {
    const { db } = this.deps;
    const item = getSealed(db, id);
    if (!item) throw new NotFoundError('Sealed product not found');
    return { thresholdCents: item.thresholdCents, configVersion: item.configVersion, points: listSealedSnapshots(db, id) };
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/src/cards/card-service.test.ts server/src/sealed/sealed-service.test.ts`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `npm test && npm run typecheck`
Expected: all green. Do not commit.

---

### Task 4: History API routes

**Files:**
- Modify: `server/src/api/app.ts` (`AppDeps` at ~line 43, routes after `GET /api/cards` ~line 83 and after `GET /api/sealed` ~line 135)
- Test: `server/src/api/app.test.ts`

**Interfaces:**
- Consumes: `CardService.history`, `SealedService.history` (Task 3), `PriceHistoryDto`.
- Produces: `GET /api/cards/:id/history`, `GET /api/sealed/:id/history` → `PriceHistoryDto`; 404 for unknown ids, 400 for invalid ids.

- [ ] **Step 1: Write the failing tests**

In `server/src/api/app.test.ts`, in `setup()`, add to the `cards` mock:

```ts
    history: vi.fn((_id: number) => ({ thresholdCents: 4000, configVersion: 1, points: [] })),
```

and to the `sealed` mock:

```ts
    history: vi.fn((_id: number) => ({ thresholdCents: 20000, configVersion: 1, points: [] })),
```

Append a new describe block:

```ts
describe('history API', () => {
  it('GET /api/cards/:id/history forwards the id', async () => {
    const { app, cards } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/cards/5/history' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ thresholdCents: 4000, configVersion: 1, points: [] });
    expect(cards.history).toHaveBeenCalledWith(5);
  });

  it('GET /api/sealed/:id/history forwards the id', async () => {
    const { app, sealed } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/sealed/3/history' });
    expect(res.statusCode).toBe(200);
    expect(sealed.history).toHaveBeenCalledWith(3);
  });

  it('unknown id → 404, invalid id → 400', async () => {
    const { app, cards, sealed } = setup();
    cards.history.mockImplementationOnce(() => {
      throw new NotFoundError('Card not found');
    });
    sealed.history.mockImplementationOnce(() => {
      throw new NotFoundError('Sealed product not found');
    });
    expect((await app.inject({ method: 'GET', url: '/api/cards/9/history' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/sealed/9/history' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/cards/abc/history' })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/api/app.test.ts`
Expected: the three new tests FAIL with 404 (route not found).

- [ ] **Step 3: Implement**

In `server/src/api/app.ts`:
- add `type PriceHistoryDto` to the `@ctzero/shared` import;
- in `AppDeps`, add `'history'` to both Picks:

```ts
  cards: Pick<CardService, 'list' | 'create' | 'update' | 'delete' | 'preview' | 'bulk' | 'history'>;
  ...
  sealed: Pick<SealedService, 'list' | 'create' | 'update' | 'delete' | 'preview' | 'history'>;
```

- after `app.get('/api/cards', ...)`:

```ts
  app.get('/api/cards/:id/history', async (req): Promise<PriceHistoryDto> =>
    deps.cards.history(idParams.parse(req.params).id),
  );
```

- after `app.get('/api/sealed', ...)`:

```ts
  app.get('/api/sealed/:id/history', async (req): Promise<PriceHistoryDto> =>
    deps.sealed.history(idParams.parse(req.params).id),
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/api/app.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `npm test && npm run typecheck`
Expected: all green (`server/src/main.ts` passes the real services, which now have `history`). Do not commit.

---

### Task 5: Web pure helpers (`price-history.ts`)

**Files:**
- Create: `web/src/price-history.ts`
- Test: `web/src/price-history.test.ts`

**Interfaces:**
- Consumes: `PricePoint`, `PriceTrend` from `@ctzero/shared`.
- Produces:
  - `type HistoryRange = '30d' | '90d' | 'all'`
  - `filterRange(points: PricePoint[], range: HistoryRange, now: Date): PricePoint[]`
  - `interface ChartSeries { line: { x: number; y: number | null }[]; filterChanges: number[]; noOffers: number[] }` (x = epoch ms, y = cents)
  - `buildSeries(points: PricePoint[]): ChartSeries`
  - `interface HistoryStats { current: number | null; min: number | null; max: number | null }`
  - `summarize(points: PricePoint[], currentConfigVersion: number): HistoryStats`
  - `axisBounds(points: PricePoint[], thresholdCents: number): { min: number; max: number }`
  - `sparklinePoints(points: PriceTrend['sparkline'], width: number, height: number): string`
  - `formatChange(pct: number | null): { text: string; cls: string }`
  - `formatDay(ms: number): string` (`dd/MM`, local time)

- [ ] **Step 1: Write the failing test**

Create `web/src/price-history.test.ts`:

```ts
import type { PricePoint } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import {
  axisBounds,
  buildSeries,
  filterRange,
  formatChange,
  formatDay,
  sparklinePoints,
  summarize,
} from './price-history';

const now = new Date('2026-10-16T09:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const ms = (d: number) => Date.parse(daysAgo(d));
const pt = (d: number, priceCents: number | null, configVersion = 1): PricePoint => ({
  syncedAt: daysAgo(d),
  priceCents,
  configVersion,
});

describe('filterRange', () => {
  const points = [pt(100, 1), pt(60, 2), pt(20, 3)];
  it('30d / 90d / all', () => {
    expect(filterRange(points, '30d', now)).toEqual([pt(20, 3)]);
    expect(filterRange(points, '90d', now)).toEqual([pt(60, 2), pt(20, 3)]);
    expect(filterRange(points, 'all', now)).toEqual(points);
  });
});

describe('buildSeries', () => {
  it('breaks the line on no offers and records them', () => {
    expect(buildSeries([pt(3, 100), pt(2, null), pt(1, 120)])).toEqual({
      line: [
        { x: ms(3), y: 100 },
        { x: ms(2), y: null },
        { x: ms(1), y: 120 },
      ],
      filterChanges: [],
      noOffers: [ms(2)],
    });
  });

  it('breaks the line and marks a filter change where configVersion changes', () => {
    expect(buildSeries([pt(3, 100, 1), pt(2, 500, 2), pt(1, 510, 2)])).toEqual({
      line: [
        { x: ms(3), y: 100 },
        { x: ms(2), y: null },
        { x: ms(2), y: 500 },
        { x: ms(1), y: 510 },
      ],
      filterChanges: [ms(2)],
      noOffers: [],
    });
  });

  it('a range starting in the middle of a configuration has no marker at its left edge', () => {
    expect(buildSeries([pt(3, 500, 2), pt(1, 510, 2)]).filterChanges).toEqual([]);
  });
});

describe('summarize', () => {
  it('uses only the current configuration', () => {
    expect(summarize([pt(5, 50, 1), pt(4, 300, 2), pt(3, 200, 2), pt(2, 250, 2)], 2)).toEqual({
      current: 250,
      min: 200,
      max: 300,
    });
  });

  it('current is null when the latest point has no offers; all null without prices', () => {
    expect(summarize([pt(3, 300), pt(2, null)], 1)).toEqual({ current: null, min: 300, max: 300 });
    expect(summarize([pt(2, null)], 1)).toEqual({ current: null, min: null, max: null });
    expect(summarize([], 1)).toEqual({ current: null, min: null, max: null });
  });
});

describe('axisBounds', () => {
  it('covers prices and threshold with 10% padding', () => {
    expect(axisBounds([pt(2, 1000), pt(1, 2000)], 1500)).toEqual({ min: 900, max: 2100 });
  });

  it('keeps a far threshold visible', () => {
    expect(axisBounds([pt(1, 5000)], 100)).toEqual({ min: 0, max: 5490 });
  });

  it('flat prices or no prices at all still get a range', () => {
    expect(axisBounds([pt(2, 1000), pt(1, 1000)], 1000)).toEqual({ min: 950, max: 1050 });
    expect(axisBounds([pt(1, null)], 400)).toEqual({ min: 380, max: 420 });
  });
});

describe('sparklinePoints', () => {
  it('x follows time, y is scaled between min and max with a 1px inset', () => {
    const points = [
      { t: daysAgo(3), priceCents: 100 },
      { t: daysAgo(2), priceCents: 200 },
      { t: daysAgo(0), priceCents: 100 },
    ];
    expect(sparklinePoints(points, 80, 24)).toBe('1,23 27,1 79,23');
  });

  it('a flat price draws a centered flat line', () => {
    const points = [
      { t: daysAgo(1), priceCents: 100 },
      { t: daysAgo(0), priceCents: 100 },
    ];
    expect(sparklinePoints(points, 80, 24)).toBe('1,12 79,12');
  });

  it('fewer than 2 points → empty', () => {
    expect(sparklinePoints([{ t: daysAgo(0), priceCents: 100 }], 80, 24)).toBe('');
  });
});

describe('formatChange', () => {
  it('sign, one decimal and color class', () => {
    expect(formatChange(-12.3)).toEqual({ text: '-12.3%', cls: 'price-down' });
    expect(formatChange(5)).toEqual({ text: '+5.0%', cls: 'price-up' });
    expect(formatChange(0)).toEqual({ text: '0.0%', cls: '' });
    expect(formatChange(null)).toEqual({ text: '—', cls: '' });
  });
});

describe('formatDay', () => {
  it('dd/MM in local time', () => {
    expect(formatDay(new Date(2026, 9, 5, 12).getTime())).toBe('05/10');
  });
});
```

Check the expected `axisBounds` values against the formula in Step 3:
- `[1000, 2000]`, threshold 1500: lo 1000, hi 2000, pad = max(100, 100, 1) = 100 → `{ 900, 2100 }`.
- `[5000]`, threshold 100: lo 100, hi 5000, pad = max(490, 250, 1) = 490 → min = max(0, −390) = 0, max = 5490.
- flat 1000: pad = max(0, 50, 1) = 50 → `{ 950, 1050 }`.
- no prices, threshold 400: lo = hi = 400, pad = 20 → `{ 380, 420 }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/price-history.test.ts`
Expected: FAIL, cannot resolve `./price-history`.

- [ ] **Step 3: Write the implementation**

Create `web/src/price-history.ts`:

```ts
import type { PricePoint, PriceTrend } from '@ctzero/shared';

export type HistoryRange = '30d' | '90d' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS = { '30d': 30, '90d': 90 } as const;

export function filterRange(points: PricePoint[], range: HistoryRange, now: Date): PricePoint[] {
  if (range === 'all') return points;
  const since = now.getTime() - RANGE_DAYS[range] * DAY_MS;
  return points.filter((p) => Date.parse(p.syncedAt) >= since);
}

export interface ChartSeries {
  /** Price line (x = epoch ms, y = cents); a null y breaks the line. */
  line: { x: number; y: number | null }[];
  /** Times where a new filter configuration starts. */
  filterChanges: number[];
  /** Times of snapshots without offers. */
  noOffers: number[];
}

export function buildSeries(points: PricePoint[]): ChartSeries {
  const series: ChartSeries = { line: [], filterChanges: [], noOffers: [] };
  points.forEach((p, i) => {
    const x = Date.parse(p.syncedAt);
    const prev = points[i - 1];
    if (prev && prev.configVersion !== p.configVersion) {
      series.filterChanges.push(x);
      // The two configurations priced different listings: do not join them.
      series.line.push({ x, y: null });
    }
    if (p.priceCents === null) {
      series.noOffers.push(x);
      series.line.push({ x, y: null });
    } else {
      series.line.push({ x, y: p.priceCents });
    }
  });
  return series;
}

export interface HistoryStats {
  current: number | null;
  min: number | null;
  max: number | null;
}

/** Stats over the current filter configuration only, like the table's trend. */
export function summarize(points: PricePoint[], currentConfigVersion: number): HistoryStats {
  const current = points.filter((p) => p.configVersion === currentConfigVersion);
  const prices = current.flatMap((p) => (p.priceCents === null ? [] : [p.priceCents]));
  return {
    current: current.at(-1)?.priceCents ?? null,
    min: prices.length > 0 ? Math.min(...prices) : null,
    max: prices.length > 0 ? Math.max(...prices) : null,
  };
}

/** Y axis range (cents) covering prices and threshold, padded so the threshold line and no-offer marks stay inside. */
export function axisBounds(points: PricePoint[], thresholdCents: number): { min: number; max: number } {
  const values = [thresholdCents, ...points.flatMap((p) => (p.priceCents === null ? [] : [p.priceCents]))];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.1, hi * 0.05, 1);
  return { min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** SVG polyline `points` for a width×height box (1px inset), x proportional to time. */
export function sparklinePoints(points: PriceTrend['sparkline'], width: number, height: number): string {
  if (points.length < 2) return '';
  const inset = 1;
  const times = points.map((p) => Date.parse(p.t));
  const prices = points.map((p) => p.priceCents);
  const t0 = times[0]!;
  const t1 = times[times.length - 1]!;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return points
    .map((p, i) => {
      const fx = t1 === t0 ? i / (points.length - 1) : (times[i]! - t0) / (t1 - t0);
      const x = inset + fx * (width - 2 * inset);
      const y = hi === lo ? height / 2 : inset + ((hi - p.priceCents) * (height - 2 * inset)) / (hi - lo);
      return `${round1(x)},${round1(y)}`;
    })
    .join(' ');
}

/** 7-day change for the Trend column: a falling price is good news for a buyer, hence green. */
export function formatChange(pct: number | null): { text: string; cls: string } {
  if (pct === null) return { text: '—', cls: '' };
  const text = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  return { text, cls: pct < 0 ? 'price-down' : pct > 0 ? 'price-up' : '' };
}

export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
```

Check the expected sparkline coordinates: times 0d, 1d, 3d out of 3d → fx 0, 1/3, 1 → x 1, 27, 79; prices 100/200/100 with lo 100, hi 200 → y 23, 1, 23.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/price-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `npm test && npm run typecheck`
Expected: all green. Do not commit.

---

### Task 6: Chart.js, `PriceSparkline.vue`, `PriceHistoryDialog.vue`

**Files:**
- Modify: `web/package.json` (via npm)
- Create: `web/src/components/PriceSparkline.vue`
- Create: `web/src/components/PriceHistoryDialog.vue`

**Interfaces:**
- Consumes: Task 5 helpers; `PriceHistoryDto`, `PriceTrend`, `formatEuro` from `@ctzero/shared`; `api`, `latestRequest`, `formatDateTime` (`web/src/card-status.ts`).
- Produces:
  - `<PriceSparkline :points="PriceTrend['sparkline']" @click>`
  - `<PriceHistoryDialog v-model:visible :kind="'card' | 'sealed'" :id="number | null" :name="string">`

- [ ] **Step 1: Add the dependency**

Run: `npm install chart.js@^4.5.1 -w @ctzero/web`
Expected: `web/package.json` lists `"chart.js": "^4.5.1"`; `package-lock.json` updated.

- [ ] **Step 2: Create `PriceSparkline.vue`**

```vue
<script setup lang="ts">
import type { PriceTrend } from '@ctzero/shared';
import { computed } from 'vue';
import { sparklinePoints } from '../price-history';

const props = defineProps<{ points: PriceTrend['sparkline'] }>();
defineEmits<{ click: [] }>();

const WIDTH = 80;
const HEIGHT = 24;
const polyline = computed(() => sparklinePoints(props.points, WIDTH, HEIGHT));
</script>

<template>
  <button v-if="polyline" type="button" class="sparkline" aria-label="Price history" @click="$emit('click')">
    <svg :width="WIDTH" :height="HEIGHT" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" aria-hidden="true">
      <polyline
        :points="polyline"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  </button>
  <span v-else class="muted">—</span>
</template>

<style scoped>
.sparkline {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--p-primary-color);
  cursor: pointer;
}
</style>
```

- [ ] **Step 3: Create `PriceHistoryDialog.vue`**

```vue
<script setup lang="ts">
import { formatEuro, type PriceHistoryDto } from '@ctzero/shared';
import type { Plugin } from 'chart.js';
import Chart from 'primevue/chart';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import SelectButton from 'primevue/selectbutton';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { formatDateTime } from '../card-status';
import { latestRequest } from '../latest-request';
import { axisBounds, buildSeries, filterRange, formatDay, summarize, type HistoryRange } from '../price-history';

const props = defineProps<{ kind: 'card' | 'sealed'; id: number | null; name: string }>();
const visible = defineModel<boolean>('visible', { required: true });

const RANGES: { label: string; value: HistoryRange }[] = [
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
  { label: 'All', value: 'all' },
];
const range = ref<HistoryRange>('90d');
const history = ref<PriceHistoryDto | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const requests = latestRequest();

watch(
  [visible, () => props.id],
  async ([open, id]) => {
    if (!open || id === null) {
      requests.cancel();
      return;
    }
    range.value = '90d';
    history.value = null;
    error.value = null;
    loading.value = true;
    const isLatest = requests.start();
    try {
      const data = await api.get<PriceHistoryDto>(`/api/${props.kind === 'card' ? 'cards' : 'sealed'}/${id}/history`);
      if (isLatest()) history.value = data;
    } catch (e) {
      if (isLatest()) error.value = (e as Error).message;
    } finally {
      if (isLatest()) loading.value = false;
    }
  },
  { immediate: true },
);

const points = computed(() => (history.value ? filterRange(history.value.points, range.value, new Date()) : []));
const series = computed(() => buildSeries(points.value));
const stats = computed(() => (history.value ? summarize(points.value, history.value.configVersion) : null));
const enoughData = computed(() => series.value.line.filter((p) => p.y !== null).length >= 2);

const euroOrDash = (cents: number | null) => (cents === null ? '—' : formatEuro(cents));

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

interface MarkerOptions {
  thresholdCents: number;
  filterChanges: number[];
  thresholdColor: string;
  markerColor: string;
}

function strokeLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Draws the threshold line and the "Filters changed" markers; options come from `plugins.priceMarkers`. */
const markersPlugin: Plugin<'line', MarkerOptions> = {
  id: 'priceMarkers',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.font = '12px sans-serif';
    const y = scales.y!.getPixelForValue(opts.thresholdCents);
    ctx.strokeStyle = ctx.fillStyle = opts.thresholdColor;
    strokeLine(ctx, chartArea.left, y, chartArea.right, y);
    ctx.fillText('Threshold', chartArea.left + 4, y - 4);
    ctx.strokeStyle = ctx.fillStyle = opts.markerColor;
    for (const t of opts.filterChanges) {
      const x = scales.x!.getPixelForValue(t);
      strokeLine(ctx, x, chartArea.top, x, chartArea.bottom);
      ctx.fillText('Filters changed', x + 4, chartArea.top + 12);
    }
    ctx.restore();
  },
};

const bounds = computed(() => axisBounds(points.value, history.value?.thresholdCents ?? 0));

const chartData = computed(() => {
  const lineColor = cssVar('--p-primary-color', '#10b981');
  const mutedColor = cssVar('--p-text-muted-color', '#6b7280');
  return {
    datasets: [
      {
        label: 'Price',
        data: series.value.line,
        borderColor: lineColor,
        backgroundColor: lineColor,
        pointRadius: 2,
        spanGaps: false,
      },
      {
        label: 'No offers',
        data: series.value.noOffers.map((x) => ({ x, y: bounds.value.min })),
        showLine: false,
        pointStyle: 'crossRot',
        pointRadius: 6,
        borderColor: mutedColor,
        borderWidth: 2,
      },
    ],
  };
});

const chartOptions = computed(() => ({
  maintainAspectRatio: false,
  animation: false,
  scales: {
    x: { type: 'linear', ticks: { maxTicksLimit: 8, callback: (v: number | string) => formatDay(Number(v)) } },
    y: {
      min: bounds.value.min,
      max: bounds.value.max,
      ticks: { callback: (v: number | string) => formatEuro(Math.round(Number(v))) },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items: { parsed: { x: number } }[]) => formatDateTime(new Date(items[0]!.parsed.x).toISOString()),
        label: (item: { datasetIndex: number; parsed: { y: number } }) =>
          item.datasetIndex === 1 ? 'No offers' : formatEuro(item.parsed.y),
      },
    },
    priceMarkers: {
      thresholdCents: history.value?.thresholdCents ?? 0,
      filterChanges: series.value.filterChanges,
      thresholdColor: '#b91c1c',
      markerColor: cssVar('--p-text-muted-color', '#6b7280'),
    } satisfies MarkerOptions,
  },
}));
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="name"
    :style="{ width: '56rem' }"
    :breakpoints="{ '960px': '95vw' }"
  >
    <div class="history-toolbar">
      <SelectButton v-model="range" :options="RANGES" option-label="label" option-value="value" :allow-empty="false" />
      <div v-if="stats" class="history-stats">
        <span>Current <strong>{{ euroOrDash(stats.current) }}</strong></span>
        <span>Min <strong>{{ euroOrDash(stats.min) }}</strong></span>
        <span>Max <strong>{{ euroOrDash(stats.max) }}</strong></span>
      </div>
    </div>
    <div v-if="loading" class="history-state"><ProgressSpinner style="width: 2.5rem; height: 2.5rem" /></div>
    <Message v-else-if="error" severity="error">{{ error }}</Message>
    <template v-else-if="history">
      <p v-if="!enoughData" class="history-state muted">Not enough data yet</p>
      <Chart
        v-else
        type="line"
        :data="chartData"
        :options="chartOptions"
        :plugins="[markersPlugin]"
        style="height: 20rem"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.history-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}
.history-stats {
  display: flex;
  gap: 1.25rem;
}
.history-state {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}
</style>
```

Notes for the implementer:
- `primevue/chart` lazy-loads `chart.js/auto` (all controllers registered) and re-creates the chart when `data` or `options` change; `plugins` is read only at creation, which is why the plugin reads its values from `options.plugins.priceMarkers`.
- If `vue-tsc` rejects the `Plugin<'line', MarkerOptions>` generic, or the tooltip callback parameter types, type the callbacks with Chart.js's own types (`TooltipItem<'line'>`) rather than `any`.

- [ ] **Step 4: Checkpoint**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green; the Vite build succeeds (the chart chunk is split out by the dynamic import). Do not commit.

---

### Task 7: Wire into Cards and Sealed pages, README, manual check

**Files:**
- Modify: `web/src/pages/CardsPage.vue`
- Modify: `web/src/pages/SealedPage.vue`
- Modify: `web/src/style.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: `TrackedCardRow`, `TrackedSealedRow` (Task 1), `/history` endpoints (Task 4), `formatChange` (Task 5), components (Task 6).
- Produces: the user-facing feature.

- [ ] **Step 1: Shared style**

Append to `web/src/style.css`:

```css
.trend-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}
```

- [ ] **Step 2: `CardsPage.vue`**

Script changes:
- add `type TrackedCardRow` to the `@ctzero/shared` import;
- add `import PriceHistoryDialog from '../components/PriceHistoryDialog.vue';`, `import PriceSparkline from '../components/PriceSparkline.vue';` and `import { formatChange } from '../price-history';`
- `const cards = ref<TrackedCardRow[]>([]);`
- in `load()`: `cards.value = await api.get<TrackedCardRow[]>('/api/cards');`
- add, after `openEdit`:

```ts
const historyVisible = ref(false);
const historyTarget = ref<{ id: number; name: string } | null>(null);

function openHistory(card: TrackedCard) {
  historyTarget.value = { id: card.id, name: card.name };
  historyVisible.value = true;
}
```

Template changes:
- after the `CT Zero price` column:

```vue
    <Column header="Trend">
      <template #body="{ data }">
        <div class="trend-cell">
          <PriceSparkline :points="data.trend.sparkline" @click="openHistory(data)" />
          <span v-tooltip.top="'Change over 7 days'" :class="formatChange(data.trend.change7dPct).cls">
            {{ formatChange(data.trend.change7dPct).text }}
          </span>
        </div>
      </template>
    </Column>
```

- in the actions column, change `style="width: 9rem"` to `style="width: 11rem"` and add before the Edit button:

```vue
          <Button v-tooltip.top="'Price history'" icon="pi pi-chart-line" text rounded @click="openHistory(data)" />
```

- after `<GroupsDialog ... />`:

```vue
  <PriceHistoryDialog
    v-model:visible="historyVisible"
    kind="card"
    :id="historyTarget?.id ?? null"
    :name="historyTarget?.name ?? ''"
  />
```

- [ ] **Step 3: `SealedPage.vue`**

Script changes:
- add `type TrackedSealedRow` to the `@ctzero/shared` import;
- add the same three imports as in Step 2;
- `const items = ref<TrackedSealedRow[]>([]);`
- in `load()`: `items.value = await api.get<TrackedSealedRow[]>('/api/sealed');`
- add, after `openEdit`:

```ts
const historyVisible = ref(false);
const historyTarget = ref<{ id: number; name: string } | null>(null);

function openHistory(item: TrackedSealed) {
  historyTarget.value = { id: item.id, name: item.name };
  historyVisible.value = true;
}
```

Template changes: the same `Trend` column after `CT Zero price`, the same `pi-chart-line` button and width `11rem` in the actions column, and after `<SealedDialog ... />`:

```vue
  <PriceHistoryDialog
    v-model:visible="historyVisible"
    kind="sealed"
    :id="historyTarget?.id ?? null"
    :name="historyTarget?.name ?? ''"
  />
```

- [ ] **Step 4: README**

In `README.md`, under `## Usage`, after the "Import list" bullet, add:

```markdown
- **Price history**: the Trend column on the Cards and Sealed pages shows the last 30 days and the change over 7 days (only prices with the current filters). The chart button (or a click on the sparkline) opens the full history, with the current threshold and a marker where the filters were changed.
```

- [ ] **Step 5: Checkpoint**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 6: Manual check on a copy of the real data**

Do not use `data/ctzero.db` directly: the Docker container may be using it, and a catch-up sync would send Telegram messages. Copy it and run with empty tokens on another port:

```bash
SCRATCH=<scratchpad dir>
cp data/ctzero.db "$SCRATCH/ctzero-copy.db"
DB_PATH="$SCRATCH/ctzero-copy.db" PORT=3100 CARDTRADER_TOKEN= TELEGRAM_BOT_TOKEN= TELEGRAM_CHAT_ID= npm run start -w @ctzero/server
```

(If `data/ctzero.db-wal` exists, copy it next to the copy as `ctzero-copy.db-wal`, otherwise the most recent snapshots may be missing.)

Open http://localhost:3100 and check:
- Cards: every row has a sparkline (or "—") and a colored % (or "—"); the chart button and the sparkline open the dialog;
- dialog: 30 d / 90 d / All change the chart and the stats; the threshold line is visible; tooltips show date and price;
- a card with a filter change in its history shows the break and the "Filters changed" marker (if none exists in the data, edit a card's filters in the copy and reopen);
- Sealed: same checks;
- a narrow window (≤ 960px): the dialog takes 95% of the width.

Stop the server when done. Do not commit.
