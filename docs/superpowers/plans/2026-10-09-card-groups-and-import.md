# Card Groups and List Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user organize tracked cards into groups (folder model) with filtering, a summary and bulk edits, and import a pasted decklist into a group after a price/threshold review.

**Architecture:** One new table (`card_groups`) and a nullable `tracked_cards.group_id`. Fast bulk edits (threshold, group, delete) go through one transactional endpoint `POST /api/cards/bulk`; slow ones (bulk filter edits, import resolution and creation) are orchestrated by the browser with a sequential batch runner calling per-card endpoints, with progress and abort. A new `POST /api/import/resolve` resolves one decklist line; `Catalog` caches blueprints per expansion for 1 hour so the follow-up `create` does not repeat calls.

**Tech Stack:** Node 24 (`node:sqlite`), Fastify 5, zod 4, Vue 3 + PrimeVue 4 + vue-router 4, vitest 5, TypeScript 5.9 (npm workspaces `shared`, `server`, `web`).

**Spec:** `docs/superpowers/specs/2026-10-09-card-groups-and-import-design.md`

## Global Constraints

- UI text in **English**, like the rest of the app ("All cards", "No group", "Import list", ...). Code comments in English.
- Groups apply to **cards only**; sealed products are untouched.
- A card belongs to **at most one** group; deleting a group sets its cards' `group_id` to NULL (`ON DELETE SET NULL`).
- Group names: trimmed, 1–80 chars, unique **case-insensitively** (`COLLATE NOCASE`); duplicate → `ValidationError` (HTTP 422).
- Changing a card's group never bumps `configVersion` and never resets price/alert state.
- Bulk endpoint: 1–500 ids (deduplicated), runs in **one transaction**; unknown ids → `skipped` with reason `"not found"`; percent mode on a card without price → `skipped` with reason `"no current price"`.
- Percent threshold: `Math.max(1, Math.round(priceCents * (1 - percent / 100)))`, percent in 1..90.
- Import: at most **250** distinct cards per import (`MAX_IMPORT_CARDS`); quantity and collector number are parsed and ignored.
- `HttpError` that satisfies `isFatalHttpError` (401/403) → HTTP **503**; other `HttpError` → 502 (unchanged). The web batch runner treats 503 as fatal and stops.
- Blueprint cache TTL: 1 hour, in memory, slim entries (`id`, `scryfall_id` only).
- **No `git commit`**: the user commits manually when they ask. Each task ends with a checkpoint (tests + typecheck green), not a commit.
- Commands run from the repo root: `npx vitest run <file>`, `npm test`, `npm run typecheck`.

## Review Focus

1. A decklist pasted from Windows (CRLF line endings, trailing spaces) must parse exactly like an LF one → test in Task 2.
2. Split/MDFC names containing `//` (e.g. `1 Fire // Ice`) must be read as card names, not comments → test in Task 2.
3. A stale `?group=<id>` in the URL (group deleted, or a junk value) must fall back to "All cards", not show an empty table → test in Task 8 (`parseGroupFilter`).
4. Percent threshold on a very cheap card (price 1 cent, or 90%) must stay ≥ 1 cent, otherwise the threshold is rejected by `cardUpdateSchema` later → tests in Task 1 (`percentBelow`) and Task 4 (bulk).
5. Card names that start with `X` after a quantity (`1 Xenagos, the Reveler`, `2x Xenagos, the Reveler`) must keep the full name → test in Task 2.

---

## File Structure

**shared**
- Modify `shared/src/types.ts` — `TrackedCard.groupId`, `CardGroup`, `BulkResult`, `ImportResolveResult`.
- Modify `shared/src/schemas.ts` — `groupId` on card input/update, `groupInputSchema`, `bulkCardsSchema`, `importResolveSchema`.
- Modify `shared/src/money.ts` — `percentBelow`.
- Create `shared/src/decklist.ts` — pure decklist parser.
- Modify `shared/src/index.ts` — export decklist.

**server**
- Modify `server/src/db/db.ts` — migration 3.
- Modify `server/src/db/cards-repo.ts` — `group_id`, `cardExistsByOracleId`.
- Create `server/src/db/groups-repo.ts` — groups CRUD.
- Modify `server/src/cards/card-service.ts` — `groupId` on create/update, `bulk`.
- Modify `server/src/catalog/catalog.ts` — blueprint cache.
- Create `server/src/import/import-service.ts` — resolve one decklist line.
- Modify `server/src/api/app.ts` — routes, 503 mapping.
- Modify `server/src/main.ts` — wiring.

**web**
- Create `web/src/batch-runner.ts` — sequential batch with progress/abort/fatal stop.
- Create `web/src/group-summary.ts` — group filter + summary.
- Create `web/src/bulk-filters.ts` — build the per-card update for bulk filter edits.
- Create `web/src/import-review.ts` — review rows, threshold proposal, create payload.
- Create `web/src/components/GroupsDialog.vue`, `BulkThresholdDialog.vue`, `BulkGroupDialog.vue`, `BulkFiltersDialog.vue`.
- Create `web/src/pages/ImportPage.vue`.
- Modify `web/src/pages/CardsPage.vue`, `web/src/components/CardDialog.vue`, `web/src/router.ts`, `web/src/style.css`.
- Modify `README.md`.

---

### Task 1: Shared types, schemas and `percentBelow`

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/schemas.ts`
- Modify: `shared/src/money.ts`
- Test: `shared/src/money.test.ts`, `shared/src/schemas.test.ts`

**Interfaces:**
- Produces:
  - `TrackedCard.groupId: number | null`
  - `interface CardGroup { id: number; name: string; cardCount: number; createdAt: string }`
  - `interface BulkResult { updated: number[]; skipped: { id: number; reason: string }[] }`
  - `interface ImportResolveResult { name: string; imageUrl: string | null; expansionIds: number[]; priceCents: number | null; listing: Listing | null; alreadyTracked: boolean }`
  - `cardInputSchema` / `cardUpdateSchema` with `groupId?: number | null`
  - `groupInputSchema` → `GroupInput { name: string }`
  - `bulkActionSchema` → `BulkAction`; `bulkCardsSchema` → `BulkCards { ids: number[]; action: BulkAction }`
  - `importResolveSchema` → `ImportResolve { name; setCode: string | null; respectSet: boolean; languages: Language[]; minCondition: Condition; foil: boolean }`
  - `percentBelow(priceCents: number, percent: number): number`

- [ ] **Step 1: Write the failing tests**

Append to `shared/src/money.test.ts` (add `percentBelow` to the existing import from `./money`):

```ts
describe('percentBelow', () => {
  it('takes the given percent off and rounds to the cent', () => {
    expect(percentBelow(3800, 10)).toBe(3420);
    expect(percentBelow(999, 15)).toBe(849);
  });

  it('never goes below 1 cent', () => {
    expect(percentBelow(1, 10)).toBe(1);
    expect(percentBelow(5, 90)).toBe(1);
  });
});
```

Append to `shared/src/schemas.test.ts` (add `bulkCardsSchema`, `cardInputSchema`, `cardUpdateSchema`, `groupInputSchema`, `importResolveSchema` to the import from `./schemas` as needed):

```ts
describe('groupId on cards', () => {
  const base = { name: 'Bolt', expansionIds: [], languages: [], minCondition: 'Near Mint', foil: false, thresholdCents: 100 };

  it('is optional, nullable or a positive id', () => {
    expect(cardInputSchema.parse(base)).not.toHaveProperty('groupId');
    expect(cardInputSchema.parse({ ...base, groupId: null }).groupId).toBeNull();
    expect(cardInputSchema.parse({ ...base, groupId: 3 }).groupId).toBe(3);
    expect(() => cardInputSchema.parse({ ...base, groupId: 0 })).toThrow();
    const { name: _n, ...update } = base;
    expect(cardUpdateSchema.parse({ ...update, groupId: 2 }).groupId).toBe(2);
  });
});

describe('groupInputSchema', () => {
  it('trims and requires 1..80 chars', () => {
    expect(groupInputSchema.parse({ name: '  Atraxa  ' })).toEqual({ name: 'Atraxa' });
    expect(() => groupInputSchema.parse({ name: '   ' })).toThrow();
    expect(() => groupInputSchema.parse({ name: 'x'.repeat(81) })).toThrow();
  });
});

describe('bulkCardsSchema', () => {
  it('accepts every action and deduplicates ids', () => {
    expect(bulkCardsSchema.parse({ ids: [1, 1, 2], action: { type: 'delete' } }).ids).toEqual([1, 2]);
    expect(bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'fixed', cents: 500 } }).action).toEqual({
      type: 'threshold',
      mode: 'fixed',
      cents: 500,
    });
    expect(bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'percent', percent: 10 } }).action).toEqual({
      type: 'threshold',
      mode: 'percent',
      percent: 10,
    });
    expect(bulkCardsSchema.parse({ ids: [1], action: { type: 'group', groupId: null } }).action).toEqual({
      type: 'group',
      groupId: null,
    });
  });

  it('rejects empty or oversized id lists and out-of-range values', () => {
    expect(() => bulkCardsSchema.parse({ ids: [], action: { type: 'delete' } })).toThrow();
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    expect(() => bulkCardsSchema.parse({ ids, action: { type: 'delete' } })).toThrow();
    expect(() => bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'percent', percent: 95 } })).toThrow();
    expect(() => bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'fixed', cents: 0 } })).toThrow();
  });
});

describe('importResolveSchema', () => {
  it('parses a resolve request', () => {
    const parsed = importResolveSchema.parse({
      name: ' Sol Ring ',
      setCode: null,
      respectSet: false,
      languages: ['en', 'en'],
      minCondition: 'Near Mint',
      foil: false,
    });
    expect(parsed).toEqual({ name: 'Sol Ring', setCode: null, respectSet: false, languages: ['en'], minCondition: 'Near Mint', foil: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/src/money.test.ts shared/src/schemas.test.ts`
Expected: FAIL (`percentBelow` / `groupInputSchema` / `bulkCardsSchema` / `importResolveSchema` not exported).

- [ ] **Step 3: Implement**

`shared/src/money.ts`, append:

```ts
/** Price lowered by `percent`%, rounded to the cent and never below 1 cent. */
export function percentBelow(priceCents: number, percent: number): number {
  return Math.max(1, Math.round(priceCents * (1 - percent / 100)));
}
```

`shared/src/schemas.ts`: replace `cardInputSchema` and add the new schemas after `cardUpdateSchema`:

```ts
/** `undefined` = leave unchanged (on update), `null` = no group. */
const groupIdSchema = z.number().int().positive().nullable().optional();

export const cardInputSchema = cardFiltersSchema.extend({
  thresholdCents: z.number().int().positive(),
  groupId: groupIdSchema,
});
export type CardInput = z.infer<typeof cardInputSchema>;

export const cardUpdateSchema = cardInputSchema.omit({ name: true });
export type CardUpdate = z.infer<typeof cardUpdateSchema>;

export const groupInputSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type GroupInput = z.infer<typeof groupInputSchema>;

export const bulkActionSchema = z.union([
  z.object({ type: z.literal('threshold'), mode: z.literal('fixed'), cents: z.number().int().positive() }),
  z.object({ type: z.literal('threshold'), mode: z.literal('percent'), percent: z.number().min(1).max(90) }),
  z.object({ type: z.literal('group'), groupId: z.number().int().positive().nullable() }),
  z.object({ type: z.literal('delete') }),
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;

export const bulkCardsSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(500)
    .transform((a) => [...new Set(a)]),
  action: bulkActionSchema,
});
export type BulkCards = z.infer<typeof bulkCardsSchema>;

export const importResolveSchema = cardFiltersSchema.omit({ expansionIds: true }).extend({
  setCode: z.string().trim().min(1).nullable(),
  respectSet: z.boolean(),
});
export type ImportResolve = z.infer<typeof importResolveSchema>;
```

(The old `cardInputSchema`/`CardInput`/`cardUpdateSchema`/`CardUpdate` definitions are replaced, not duplicated.)

`shared/src/types.ts`: add `groupId` to `TrackedCard` (after `imageUrl`) and the new interfaces at the end of the cards section (after `CardLookupDto`):

```ts
  imageUrl: string | null;
  /** Group the card belongs to, null = no group. */
  groupId: number | null;
```

```ts
export interface CardGroup {
  id: number;
  name: string;
  cardCount: number;
  createdAt: string;
}

export interface BulkResult {
  updated: number[];
  skipped: { id: number; reason: string }[];
}

/** One decklist line resolved for the import review. */
export interface ImportResolveResult {
  name: string;
  imageUrl: string | null;
  /** [] = any expansion. */
  expansionIds: number[];
  priceCents: number | null;
  listing: Listing | null;
  /** A card with the same Scryfall oracle id is already tracked. */
  alreadyTracked: boolean;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run shared/src/money.test.ts shared/src/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`npm run typecheck` will now fail in `server/src/db/cards-repo.ts` (`toCard` lacks `groupId`); that is fixed in Task 3. Run `npm test` and confirm only pre-existing tests run green. No commit.

---

### Task 2: Decklist parser

**Files:**
- Create: `shared/src/decklist.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/decklist.test.ts`

**Interfaces:**
- Produces:
  - `interface DecklistLine { name: string; setCode: string | null; foil: boolean; lineNo: number }` (`setCode` lowercase)
  - `interface DecklistError { lineNo: number; text: string }`
  - `interface ParsedDecklist { lines: DecklistLine[]; errors: DecklistError[] }`
  - `parseDecklist(text: string): ParsedDecklist`
  - `const MAX_IMPORT_CARDS = 250`

- [ ] **Step 1: Write the failing test**

`shared/src/decklist.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseDecklist } from './decklist';

const names = (text: string) => parseDecklist(text).lines.map((l) => l.name);

describe('parseDecklist', () => {
  it('reads plain names, quantities and "x" quantities', () => {
    expect(names('Sol Ring\n1 Arcane Signet\n4x Lightning Bolt\n4 x Counterspell')).toEqual([
      'Sol Ring',
      'Arcane Signet',
      'Lightning Bolt',
      'Counterspell',
    ]);
  });

  it('keeps names starting with X after a quantity', () => {
    expect(names('1 Xenagos, the Reveler')).toEqual(['Xenagos, the Reveler']);
    expect(names('2x Xenagos, the Reveler')).toEqual(['Xenagos, the Reveler']);
  });

  it('reads set code and collector number (Moxfield/Arena), lowercasing the set', () => {
    const { lines } = parseDecklist('1 Sol Ring (C21) 263\n1 Arcane Signet [CMR]\n1 Command Tower (PLST) SLD-123');
    expect(lines.map((l) => [l.name, l.setCode])).toEqual([
      ['Sol Ring', 'c21'],
      ['Arcane Signet', 'cmr'],
      ['Command Tower', 'plst'],
    ]);
  });

  it('reads foil and etched markers', () => {
    const { lines } = parseDecklist('1 Sol Ring (C21) 263 *F*\n1 Arcane Signet *E*\n1 Command Tower');
    expect(lines.map((l) => l.foil)).toEqual([true, true, false]);
  });

  it('ignores blank lines, comments and section headers', () => {
    const text = 'Commander\n1 Atraxa, Praetors\' Voice\n\n// ramp\n# note\nDeck:\n1 Sol Ring\nSIDEBOARD:\n1 Duress\nMaybeboard (3)';
    expect(names(text)).toEqual(["Atraxa, Praetors' Voice", 'Sol Ring', 'Duress']);
  });

  it('keeps split/MDFC names with //', () => {
    expect(names('1 Fire // Ice\nDelver of Secrets // Insectile Aberration')).toEqual([
      'Fire // Ice',
      'Delver of Secrets // Insectile Aberration',
    ]);
  });

  it('handles CRLF line endings and trailing spaces like LF', () => {
    expect(parseDecklist('1 Sol Ring  \r\n4x Lightning Bolt (M11) 149 \r\n')).toEqual(
      parseDecklist('1 Sol Ring\n4x Lightning Bolt (M11) 149\n'),
    );
  });

  it('merges duplicates case-insensitively: first occurrence wins, foil is OR-ed', () => {
    const { lines } = parseDecklist('1 Sol Ring (C21)\n1 sol ring (CMR) *F*');
    expect(lines).toEqual([{ name: 'Sol Ring', setCode: 'c21', foil: true, lineNo: 1 }]);
  });

  it('reports lines without a card name with their line number', () => {
    const { lines, errors } = parseDecklist('1 Sol Ring\n4\n***');
    expect(lines).toHaveLength(1);
    expect(errors).toEqual([
      { lineNo: 2, text: '4' },
      { lineNo: 3, text: '***' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/src/decklist.test.ts`
Expected: FAIL ("Failed to resolve import ./decklist").

- [ ] **Step 3: Implement**

`shared/src/decklist.ts`:

```ts
/** Maximum number of distinct cards accepted by a single import. */
export const MAX_IMPORT_CARDS = 250;

export interface DecklistLine {
  name: string;
  /** Lowercase set code written in the list, if any. */
  setCode: string | null;
  foil: boolean;
  /** 1-based line of the first occurrence. */
  lineNo: number;
}

export interface DecklistError {
  lineNo: number;
  text: string;
}

export interface ParsedDecklist {
  lines: DecklistLine[];
  errors: DecklistError[];
}

const SECTION =
  /^(deck|main\s*deck|mainboard|sideboard|commanders?|companions?|maybeboard|considering|tokens?)\s*:?\s*(\(\d+\))?$/i;
const FOIL = /\s+\*[FE]\*$/i;
// [quantity[x]] name [(SET) or [SET] [collector number]]
const CARD = /^(?:\d+\s*x?\s+)?(.+?)(?:\s+[([]([A-Za-z0-9]{2,6})[)\]](?:\s+\S+)?)?$/;

/**
 * Parses a text decklist (Moxfield, Archidekt, MTGA, plain names), one card per line.
 * Quantities and collector numbers are ignored; duplicates are merged.
 */
export function parseDecklist(text: string): ParsedDecklist {
  const lines: DecklistLine[] = [];
  const errors: DecklistError[] = [];
  const byName = new Map<string, DecklistLine>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    let line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('#') || SECTION.test(line)) return;
    const foil = FOIL.test(line);
    if (foil) line = line.replace(FOIL, '');
    const match = CARD.exec(line);
    const name = match?.[1]?.trim() ?? '';
    if (!/\p{L}/u.test(name)) {
      errors.push({ lineNo, text: raw.trim() });
      return;
    }
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.foil ||= foil;
      return;
    }
    const entry: DecklistLine = { name, setCode: match?.[2]?.toLowerCase() ?? null, foil, lineNo };
    byName.set(key, entry);
    lines.push(entry);
  });

  return { lines, errors };
}
```

`shared/src/index.ts`, add:

```ts
export * from './decklist';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/src/decklist.test.ts`
Expected: PASS. If the "x quantity" or Xenagos case fails, check that `x?` is lowercase-only and followed by `\s+`.

- [ ] **Step 5: Checkpoint**

`npx vitest run shared` green. No commit.

---

### Task 3: Migration, groups repo, `group_id` in cards repo

**Files:**
- Modify: `server/src/db/db.ts`
- Modify: `server/src/db/cards-repo.ts`
- Create: `server/src/db/groups-repo.ts`
- Test: `server/src/db/groups-repo.test.ts`, `server/src/db/repos.test.ts`

**Interfaces:**
- Consumes: `CardGroup`, `TrackedCard.groupId` (Task 1).
- Produces:
  - `NewCard.groupId?: number | null`; `CardPatch` gains `groupId` (derived from `TrackedCard`).
  - `cardExistsByOracleId(db: Db, oracleId: string): boolean`
  - `listGroups(db: Db): CardGroup[]`, `getGroup(db: Db, id: number): CardGroup | null`, `insertGroup(db: Db, name: string, now?: Date): CardGroup`, `renameGroup(db: Db, id: number, name: string): CardGroup`, `deleteGroup(db: Db, id: number): boolean`

- [ ] **Step 1: Write the failing tests**

`server/src/db/groups-repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../errors';
import { getCard, insertCard, updateCard, type NewCard } from './cards-repo';
import { openDb, type Db } from './db';
import { deleteGroup, getGroup, insertGroup, listGroups, renameGroup } from './groups-repo';

const t0 = new Date('2026-10-09T10:00:00.000Z');
const card: NewCard = {
  name: 'Sol Ring',
  scryfallOracleId: 'o-sol',
  imageUrl: null,
  expansionIds: [],
  languages: [],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 100,
};

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('groups-repo', () => {
  it('insert + list sorted by name with card counts', () => {
    const b = insertGroup(db, 'Wishlist', t0);
    const a = insertGroup(db, 'atraxa', t0);
    insertCard(db, { ...card, groupId: b.id });
    insertCard(db, { ...card, name: 'Arcane Signet', groupId: b.id });
    insertCard(db, card);
    expect(listGroups(db)).toEqual([
      { id: a.id, name: 'atraxa', cardCount: 0, createdAt: t0.toISOString() },
      { id: b.id, name: 'Wishlist', cardCount: 2, createdAt: t0.toISOString() },
    ]);
  });

  it('names are unique case-insensitively, on insert and rename', () => {
    const a = insertGroup(db, 'Atraxa');
    expect(() => insertGroup(db, 'ATRAXA')).toThrow(ValidationError);
    const b = insertGroup(db, 'Wishlist');
    expect(() => renameGroup(db, b.id, 'atraxa')).toThrow(ValidationError);
    expect(renameGroup(db, a.id, 'ATRAXA').name).toBe('ATRAXA');
  });

  it('rename of a nonexistent group → NotFoundError', () => {
    expect(() => renameGroup(db, 99, 'X')).toThrow(NotFoundError);
  });

  it('delete keeps the cards, without a group', () => {
    const g = insertGroup(db, 'Deck');
    const c = insertCard(db, { ...card, groupId: g.id });
    expect(deleteGroup(db, g.id)).toBe(true);
    expect(getGroup(db, g.id)).toBeNull();
    expect(getCard(db, c.id)?.groupId).toBeNull();
    expect(deleteGroup(db, g.id)).toBe(false);
  });

  it('updateCard can set and clear the group', () => {
    const g = insertGroup(db, 'Deck');
    const c = insertCard(db, card);
    expect(c.groupId).toBeNull();
    expect(updateCard(db, c.id, { groupId: g.id }).groupId).toBe(g.id);
    expect(updateCard(db, c.id, { groupId: null }).groupId).toBeNull();
  });
});
```

Append to `server/src/db/repos.test.ts` inside `describe('cards-repo', ...)` (add `cardExistsByOracleId` to the `./cards-repo` import):

```ts
  it('cardExistsByOracleId', () => {
    expect(cardExistsByOracleId(db, 'oid')).toBe(false);
    insertCard(db, newCard, t0);
    expect(cardExistsByOracleId(db, 'oid')).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/db`
Expected: FAIL (`./groups-repo` missing, `cardExistsByOracleId` not exported).

- [ ] **Step 3: Implement**

`server/src/db/db.ts`: append a third entry to `MIGRATIONS`:

```ts
  `
  CREATE TABLE card_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  ALTER TABLE tracked_cards ADD COLUMN group_id INTEGER REFERENCES card_groups(id) ON DELETE SET NULL;
  CREATE INDEX tracked_cards_group ON tracked_cards(group_id);
  `,
```

`server/src/db/cards-repo.ts`:
- `CardRecord`: add `group_id: number | null;` after `image_url`.
- `NewCard`: add `groupId?: number | null;` at the end.
- `COLUMNS`: add `groupId: 'group_id',` after `imageUrl`.
- `toCard`: add `groupId: r.group_id,` after `imageUrl`.
- `insertCard`: include the column:

```ts
export function insertCard(db: Db, c: NewCard, now: Date = new Date()): TrackedCard {
  const iso = now.toISOString();
  const res = db
    .prepare(
      `INSERT INTO tracked_cards
        (name, scryfall_oracle_id, image_url, group_id, expansion_ids, languages, min_condition, foil, threshold_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.name,
      c.scryfallOracleId,
      c.imageUrl,
      c.groupId ?? null,
      JSON.stringify(c.expansionIds),
      JSON.stringify(c.languages),
      c.minCondition,
      c.foil ? 1 : 0,
      c.thresholdCents,
      iso,
      iso,
    );
  return getCard(db, Number(res.lastInsertRowid))!;
}
```

- after `deleteCard`, add:

```ts
export function cardExistsByOracleId(db: Db, oracleId: string): boolean {
  return db.prepare('SELECT 1 FROM tracked_cards WHERE scryfall_oracle_id = ? LIMIT 1').get(oracleId) !== undefined;
}
```

`server/src/db/groups-repo.ts`:

```ts
import type { CardGroup } from '@ctzero/shared';
import { NotFoundError, ValidationError } from '../errors';
import type { Db } from './db';

interface GroupRecord {
  id: number;
  name: string;
  created_at: string;
  card_count: number;
}

const SELECT = `SELECT g.id, g.name, g.created_at, COUNT(c.id) AS card_count
  FROM card_groups g LEFT JOIN tracked_cards c ON c.group_id = g.id`;

function toGroup(r: GroupRecord): CardGroup {
  return { id: r.id, name: r.name, cardCount: r.card_count, createdAt: r.created_at };
}

/** `name` has COLLATE NOCASE, so the comparison is case-insensitive. */
function assertNameFree(db: Db, name: string, exceptId = 0): void {
  if (db.prepare('SELECT 1 FROM card_groups WHERE name = ? AND id != ?').get(name, exceptId) !== undefined) {
    throw new ValidationError(`A group named "${name}" already exists`);
  }
}

export function listGroups(db: Db): CardGroup[] {
  const rows = db.prepare(`${SELECT} GROUP BY g.id ORDER BY g.name COLLATE NOCASE`).all() as unknown as GroupRecord[];
  return rows.map(toGroup);
}

export function getGroup(db: Db, id: number): CardGroup | null {
  const row = db.prepare(`${SELECT} WHERE g.id = ? GROUP BY g.id`).get(id) as unknown as GroupRecord | undefined;
  return row ? toGroup(row) : null;
}

export function insertGroup(db: Db, name: string, now: Date = new Date()): CardGroup {
  assertNameFree(db, name);
  const res = db.prepare('INSERT INTO card_groups (name, created_at) VALUES (?, ?)').run(name, now.toISOString());
  return getGroup(db, Number(res.lastInsertRowid))!;
}

export function renameGroup(db: Db, id: number, name: string): CardGroup {
  if (!getGroup(db, id)) throw new NotFoundError('Group not found');
  assertNameFree(db, name, id);
  db.prepare('UPDATE card_groups SET name = ? WHERE id = ?').run(name, id);
  return getGroup(db, id)!;
}

/** The group's cards stay tracked, without a group (ON DELETE SET NULL). */
export function deleteGroup(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM card_groups WHERE id = ?').run(id).changes) > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/db`
Expected: PASS (including the existing `applies migrations only once` test).

- [ ] **Step 5: Checkpoint**

`npm test` and `npm run typecheck` green (the `groupId` gap from Task 1 is now closed). No commit.

---

### Task 4: `CardService`: group on create/update, `bulk`

**Files:**
- Modify: `server/src/cards/card-service.ts`
- Test: `server/src/cards/card-service.test.ts`

**Interfaces:**
- Consumes: `getGroup`, `insertGroup` (Task 3), `BulkCards`, `BulkResult`, `percentBelow` (Task 1).
- Produces: `CardService.bulk(input: BulkCards): BulkResult`; `create`/`update` honor `input.groupId` (`undefined` = untouched on update; unknown id → `ValidationError('Group not found')`).

- [ ] **Step 1: Write the failing tests**

Append to `server/src/cards/card-service.test.ts` (add `insertGroup` import from `../db/groups-repo`):

```ts
describe('groups', () => {
  it('create puts the card in the group; unknown group → ValidationError and nothing saved', async () => {
    const g = insertGroup(db, 'Deck');
    expect((await service.create({ ...input, groupId: g.id })).groupId).toBe(g.id);
    await expect(service.create({ ...input, groupId: 999 })).rejects.toBeInstanceOf(ValidationError);
    expect(listCards(db)).toHaveLength(1);
  });

  it('update: undefined keeps the group, null clears it, without touching price state', async () => {
    const g = insertGroup(db, 'Deck');
    const card = await service.create({ ...input, groupId: g.id });
    expect((await service.update(card.id, update)).groupId).toBe(g.id);
    const cleared = await service.update(card.id, { ...update, groupId: null });
    expect(cleared).toMatchObject({ groupId: null, configVersion: 1, lastPriceCents: 3800, alertState: 'below' });
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
  });

  it('update with filter change also applies the group', async () => {
    const g = insertGroup(db, 'Deck');
    const card = await service.create(input);
    expect(await service.update(card.id, { ...update, foil: true, groupId: g.id })).toMatchObject({ foil: true, groupId: g.id });
  });

  it('update with unknown group → ValidationError, card unchanged', async () => {
    const card = await service.create(input);
    await expect(service.update(card.id, { ...update, thresholdCents: 1, groupId: 999 })).rejects.toBeInstanceOf(ValidationError);
    expect(getCard(db, card.id)?.thresholdCents).toBe(4000);
  });
});

describe('bulk', () => {
  it('fixed threshold: updates and re-evaluates silently', async () => {
    const a = await service.create(input);
    const b = await service.create(input);
    const result = service.bulk({ ids: [a.id, b.id], action: { type: 'threshold', mode: 'fixed', cents: 3000 } });
    expect(result).toEqual({ updated: [a.id, b.id], skipped: [] });
    expect(getCard(db, a.id)).toMatchObject({ thresholdCents: 3000, alertState: 'above', lastNotifiedPriceCents: null, configVersion: 1 });
  });

  it('percent threshold: computed from the current price; cards without price are skipped', async () => {
    const a = await service.create(input);
    ct.products.mockRejectedValueOnce(new Error('timeout'));
    const b = await service.create(input);
    const result = service.bulk({ ids: [a.id, b.id], action: { type: 'threshold', mode: 'percent', percent: 10 } });
    expect(result).toEqual({ updated: [a.id], skipped: [{ id: b.id, reason: 'no current price' }] });
    // 3800 > 3420: the card is now above its threshold.
    expect(getCard(db, a.id)).toMatchObject({ thresholdCents: 3420, alertState: 'above', lastNotifiedPriceCents: null });
    expect(getCard(db, b.id)?.thresholdCents).toBe(4000);
  });

  it('percent threshold on a 1-cent card stays at 1 cent', async () => {
    price = 1;
    const a = await service.create(input);
    service.bulk({ ids: [a.id], action: { type: 'threshold', mode: 'percent', percent: 90 } });
    expect(getCard(db, a.id)?.thresholdCents).toBe(1);
  });

  it('group: moves and clears without touching configVersion', async () => {
    const g = insertGroup(db, 'Deck');
    const a = await service.create(input);
    service.bulk({ ids: [a.id], action: { type: 'group', groupId: g.id } });
    expect(getCard(db, a.id)).toMatchObject({ groupId: g.id, configVersion: 1 });
    service.bulk({ ids: [a.id], action: { type: 'group', groupId: null } });
    expect(getCard(db, a.id)?.groupId).toBeNull();
  });

  it('group: unknown group → ValidationError, nothing changed', async () => {
    const a = await service.create(input);
    expect(() => service.bulk({ ids: [a.id], action: { type: 'group', groupId: 999 } })).toThrow(ValidationError);
    expect(getCard(db, a.id)?.groupId).toBeNull();
  });

  it('delete, with unknown ids reported as skipped', async () => {
    const a = await service.create(input);
    const result = service.bulk({ ids: [a.id, 999], action: { type: 'delete' } });
    expect(result).toEqual({ updated: [a.id], skipped: [{ id: 999, reason: 'not found' }] });
    expect(listCards(db)).toEqual([]);
  });

  it('a failure midway rolls back the whole batch', async () => {
    const a = await service.create(input);
    const b = await service.create(input);
    db.exec(`CREATE TRIGGER fail_b BEFORE UPDATE ON tracked_cards WHEN NEW.id = ${b.id} BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    expect(() => service.bulk({ ids: [a.id, b.id], action: { type: 'threshold', mode: 'fixed', cents: 3000 } })).toThrow('boom');
    expect(getCard(db, a.id)?.thresholdCents).toBe(4000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/cards/card-service.test.ts`
Expected: FAIL (`service.bulk is not a function`, `groupId` ignored).

- [ ] **Step 3: Implement**

In `server/src/cards/card-service.ts`:

Imports:

```ts
import {
  percentBelow,
  type BulkCards,
  type BulkResult,
  type CardBlueprint,
  type CardFilters,
  type CardInput,
  type CardUpdate,
  type PreviewResult,
  type TrackedCard,
} from '@ctzero/shared';
```

add `deleteCard` is already imported; add `import { getGroup } from '../db/groups-repo';` and `ValidationError` to the `../errors` import.

Add a private helper in the class:

```ts
  /** Throws if `groupId` is set but does not exist. */
  private assertGroup(groupId: number | null | undefined): void {
    if (groupId != null && !getGroup(this.deps.db, groupId)) throw new ValidationError('Group not found');
  }
```

In `create`, before `catalog.lookup`: `this.assertGroup(input.groupId);` and add `groupId: input.groupId ?? null,` to the `insertCard` object.

In `update`, right after the `NotFoundError` check:

```ts
    this.assertGroup(input.groupId);
    const groupPatch = input.groupId !== undefined ? { groupId: input.groupId } : {};
```

and spread `...groupPatch` into both `updateCard` patches (the threshold-only branch and the filter-change branch).

Add the method after `delete`:

```ts
  /** Fast bulk edits, DB only, in one transaction. */
  bulk(input: BulkCards): BulkResult {
    const { db } = this.deps;
    const { action } = input;
    if (action.type === 'group') this.assertGroup(action.groupId);
    const now = this.now();
    return transaction(db, () => {
      const updated: number[] = [];
      const skipped: BulkResult['skipped'] = [];
      for (const id of input.ids) {
        const card = getCard(db, id);
        if (!card) {
          skipped.push({ id, reason: 'not found' });
          continue;
        }
        if (action.type === 'delete') {
          deleteCard(db, id);
        } else if (action.type === 'group') {
          updateCard(db, id, { groupId: action.groupId }, now);
        } else {
          if (action.mode === 'percent' && card.lastPriceCents === null) {
            skipped.push({ id, reason: 'no current price' });
            continue;
          }
          const cents = action.mode === 'fixed' ? action.cents : percentBelow(card.lastPriceCents!, action.percent);
          updateCard(db, id, { thresholdCents: cents, ...evaluateSilently(card.lastPriceCents, cents) }, now);
        }
        updated.push(id);
      }
      return { updated, skipped };
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/cards/card-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`npm test` and `npm run typecheck` green. No commit.

---

### Task 5: Blueprint cache in `Catalog`

**Files:**
- Modify: `server/src/catalog/catalog.ts`
- Test: `server/src/catalog/catalog.test.ts`

**Interfaces:**
- Produces: `resolveBlueprints` unchanged in signature; calls `ct.blueprints(expansionId)` at most once per expansion per hour.

- [ ] **Step 1: Write the failing test**

Append inside `describe('Catalog.resolveBlueprints', ...)`:

```ts
  it('caches blueprints per expansion for 1 hour', async () => {
    const lookup = await catalog.lookup('ragavan');
    await catalog.resolveBlueprints(lookup, []);
    await catalog.resolveBlueprints(lookup, [1]);
    expect(ct.blueprints).toHaveBeenCalledTimes(2); // expansions 1 and 2, once each
    clock = 61 * 60 * 1000;
    await catalog.resolveBlueprints(lookup, [1]);
    expect(ct.blueprints).toHaveBeenCalledTimes(3);
  });
```

Note: the existing `caches expansions for 24 hours` test sets `clock` past 1 hour, so it is unaffected; the existing `with specific expansions fetches only those` test starts from a fresh `Catalog` (`beforeEach`), so it still sees one call.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/catalog/catalog.test.ts`
Expected: FAIL (`toHaveBeenCalledTimes(2)` receives 3).

- [ ] **Step 3: Implement**

In `server/src/catalog/catalog.ts`:

```ts
const BLUEPRINTS_TTL_MS = 3600 * 1000;

/** Only the fields needed to match blueprints to Scryfall printings. */
type SlimBlueprint = Pick<CtBlueprint, 'id' | 'scryfall_id'>;
```

(add `type CtBlueprint` to the `../clients/cardtrader` import). In the class:

```ts
  private readonly blueprintsCache = new Map<number, { fetchedAt: number; list: SlimBlueprint[] }>();

  /** Blueprints of an expansion, cached for an hour (an import resolves and then creates the same cards). */
  private async expansionBlueprints(expansionId: number): Promise<SlimBlueprint[]> {
    const cached = this.blueprintsCache.get(expansionId);
    if (cached && this.now() - cached.fetchedAt < BLUEPRINTS_TTL_MS) return cached.list;
    const list = (await this.ct.blueprints(expansionId)).map((bp) => ({ id: bp.id, scryfall_id: bp.scryfall_id }));
    this.blueprintsCache.set(expansionId, { fetchedAt: this.now(), list });
    return list;
  }
```

and in `resolveBlueprints` replace `await this.ct.blueprints(expansionId)` with `await this.expansionBlueprints(expansionId)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/catalog server/src/sync server/src/cards`
Expected: PASS (sync and card service use `resolveBlueprints` through fakes or the real catalog; both must stay green).

- [ ] **Step 5: Checkpoint**

`npm run typecheck` green. No commit.

---

### Task 6: `ImportService.resolve`

**Files:**
- Create: `server/src/import/import-service.ts`
- Test: `server/src/import/import-service.test.ts`

**Interfaces:**
- Consumes: `cardExistsByOracleId` (Task 3), `ImportResolve`, `ImportResolveResult` (Task 1), `Catalog.lookup`/`resolveBlueprints`, `priceCard`.
- Produces: `class ImportService { constructor(deps: ImportServiceDeps); resolve(input: ImportResolve): Promise<ImportResolveResult> }`, `interface ImportServiceDeps { db: Db; catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>; ct: Pick<CardTraderClient, 'products'> }`

- [ ] **Step 1: Write the failing test**

`server/src/import/import-service.test.ts`:

```ts
import type { CardBlueprint, ImportResolve } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CardLookup } from '../catalog/catalog';
import { insertCard } from '../db/cards-repo';
import { openDb, type Db } from '../db/db';
import { NotFoundError, ValidationError } from '../errors';
import { makeProduct } from '../test-utils';
import { ImportService } from './import-service';

const lookup: CardLookup = {
  name: 'Sol Ring',
  oracleId: 'o-sol',
  imageUrl: 'img',
  printings: [
    { expansionId: 1, expansionName: 'Commander 2021', code: 'C21' },
    { expansionId: 2, expansionName: 'Commander Legends', code: 'cmr' },
  ],
  scryfallIdsByExpansion: new Map(),
};
const blueprints: CardBlueprint[] = [{ blueprintId: 100, expansionId: 1, expansionName: 'Commander 2021' }];
const input: ImportResolve = {
  name: 'sol ring',
  setCode: 'c21',
  respectSet: false,
  languages: [],
  minCondition: 'Near Mint',
  foil: false,
};

type Fn = Mock<(...args: any[]) => any>;
let db: Db;
let catalog: { lookup: Fn; resolveBlueprints: Fn };
let ct: { products: Fn };
let service: ImportService;

beforeEach(() => {
  db = openDb(':memory:');
  catalog = { lookup: vi.fn(async () => lookup), resolveBlueprints: vi.fn(async () => blueprints) };
  ct = { products: vi.fn(async () => [makeProduct({ blueprint_id: 100, price: { cents: 250, currency: 'EUR' } })]) };
  service = new ImportService({ db, catalog, ct });
});

describe('ImportService.resolve', () => {
  it('ignores the set by default and prices any expansion', async () => {
    const result = await service.resolve(input);
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
    expect(catalog.resolveBlueprints).toHaveBeenCalledWith(lookup, []);
    expect(result).toMatchObject({ name: 'Sol Ring', imageUrl: 'img', expansionIds: [], priceCents: 250, alreadyTracked: false });
    expect(result.listing?.expansionName).toBe('Commander 2021');
  });

  it('with respectSet maps the set code case-insensitively', async () => {
    const result = await service.resolve({ ...input, respectSet: true, setCode: 'CMR' });
    expect(catalog.resolveBlueprints).toHaveBeenCalledWith(lookup, [2]);
    expect(result.expansionIds).toEqual([2]);
  });

  it('respectSet without a set code → any expansion', async () => {
    await service.resolve({ ...input, respectSet: true, setCode: null });
    expect(catalog.resolveBlueprints).toHaveBeenCalledWith(lookup, []);
  });

  it('unknown set with respectSet → ValidationError', async () => {
    await expect(service.resolve({ ...input, respectSet: true, setCode: 'zzz' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('no offers → null price', async () => {
    ct.products.mockResolvedValueOnce([]);
    expect(await service.resolve(input)).toMatchObject({ priceCents: null, listing: null });
  });

  it('alreadyTracked when a card with the same oracle id exists', async () => {
    insertCard(db, {
      name: 'Sol Ring',
      scryfallOracleId: 'o-sol',
      imageUrl: null,
      expansionIds: [],
      languages: [],
      minCondition: 'Near Mint',
      foil: false,
      thresholdCents: 100,
    });
    expect((await service.resolve(input)).alreadyTracked).toBe(true);
  });

  it('card not found propagates NotFoundError', async () => {
    catalog.lookup.mockRejectedValueOnce(new NotFoundError('Card "Xyz" not found'));
    await expect(service.resolve({ ...input, name: 'Xyz' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/import`
Expected: FAIL (module `./import-service` missing).

- [ ] **Step 3: Implement**

`server/src/import/import-service.ts`:

```ts
import type { ImportResolve, ImportResolveResult } from '@ctzero/shared';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { cardExistsByOracleId } from '../db/cards-repo';
import type { Db } from '../db/db';
import { ValidationError } from '../errors';
import { priceCard } from '../pricing/card-pricer';

export interface ImportServiceDeps {
  db: Db;
  catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>;
  ct: Pick<CardTraderClient, 'products'>;
}

export class ImportService {
  constructor(private readonly deps: ImportServiceDeps) {}

  /** Resolves one decklist line: canonical name, expansions, current price. Saves nothing. */
  async resolve(input: ImportResolve): Promise<ImportResolveResult> {
    const { db, catalog, ct } = this.deps;
    const lookup = await catalog.lookup(input.name);
    let expansionIds: number[] = [];
    if (input.respectSet && input.setCode) {
      const code = input.setCode.toLowerCase();
      const printing = lookup.printings.find((p) => p.code.toLowerCase() === code);
      if (!printing) throw new ValidationError(`Set "${input.setCode.toUpperCase()}" not found for "${lookup.name}"`);
      expansionIds = [printing.expansionId];
    }
    const blueprints = await catalog.resolveBlueprints(lookup, expansionIds);
    const result = await priceCard(ct, blueprints, input);
    return {
      name: lookup.name,
      imageUrl: lookup.imageUrl,
      expansionIds,
      priceCents: result.status === 'ok' ? result.priceCents : null,
      listing: result.status === 'ok' ? result.listing : null,
      alreadyTracked: cardExistsByOracleId(db, lookup.oracleId),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/import`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`npm run typecheck` green. No commit.

---

### Task 7: API routes, 503 mapping, wiring

**Files:**
- Modify: `server/src/api/app.ts`
- Modify: `server/src/main.ts`
- Test: `server/src/api/app.test.ts`

**Interfaces:**
- Consumes: groups repo (Task 3), `CardService.bulk` (Task 4), `ImportService` (Task 6), schemas (Task 1).
- Produces (HTTP):
  - `GET /api/groups` → `CardGroup[]`; `POST /api/groups` `{name}` → 201 `CardGroup`; `PUT /api/groups/:id` `{name}` → `CardGroup`; `DELETE /api/groups/:id` → 204 / 404
  - `POST /api/cards/bulk` `BulkCards` → `BulkResult`
  - `POST /api/import/resolve` `ImportResolve` → `ImportResolveResult`
  - fatal `HttpError` → 503
- `AppDeps.cards` gains `'bulk'`; new `AppDeps.importer: Pick<ImportService, 'resolve'>`.

- [ ] **Step 1: Write the failing tests**

In `server/src/api/app.test.ts`, extend `setup()`:

```ts
  const cards = {
    // ...existing fns...
    bulk: vi.fn(() => ({ updated: [1], skipped: [] })),
  };
  const importer = {
    resolve: vi.fn(async () => ({
      name: 'Sol Ring',
      imageUrl: null,
      expansionIds: [],
      priceCents: 250,
      listing: null,
      alreadyTracked: false,
    })),
  };
```

and add `importer` to `deps`. Change the existing test `preview: ValidationError → 422, HttpError upstream → 502` to:

```ts
  it('preview: ValidationError → 422, fatal HttpError → 503, other HttpError → 502', async () => {
    const { app, cards } = setup();
    const { thresholdCents: _t, ...filters } = body;
    cards.preview.mockRejectedValueOnce(new ValidationError('no printings'));
    expect((await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters })).statusCode).toBe(422);
    cards.preview.mockRejectedValueOnce(new HttpError(401, 'HTTP 401 da api.cardtrader.com'));
    const fatal = await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters });
    expect(fatal.statusCode).toBe(503);
    expect(fatal.json().error).toContain('401');
    cards.preview.mockRejectedValueOnce(new HttpError(500, 'HTTP 500 da api.cardtrader.com'));
    expect((await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters })).statusCode).toBe(502);
  });
```

Add (`insertCard` is not needed; groups use the real in-memory db of `setup()`):

```ts
describe('groups API', () => {
  it('CRUD', async () => {
    const { app } = setup();
    const created = await app.inject({ method: 'POST', url: '/api/groups', payload: { name: ' Atraxa ' } });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect(created.json()).toMatchObject({ name: 'Atraxa', cardCount: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/groups' })).json()).toHaveLength(1);
    const renamed = await app.inject({ method: 'PUT', url: `/api/groups/${id}`, payload: { name: 'Wishlist' } });
    expect(renamed.json().name).toBe('Wishlist');
    expect((await app.inject({ method: 'DELETE', url: `/api/groups/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/groups/${id}` })).statusCode).toBe(404);
  });

  it('duplicate name → 422, empty name → 400, rename unknown → 404', async () => {
    const { app } = setup();
    await app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'Deck' } });
    expect((await app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'deck' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/groups', payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/groups/99', payload: { name: 'X' } })).statusCode).toBe(404);
  });
});

describe('bulk and import API', () => {
  it('POST /api/cards/bulk validates and forwards', async () => {
    const { app, cards } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/cards/bulk', payload: { ids: [1, 1], action: { type: 'delete' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: [1], skipped: [] });
    expect(cards.bulk).toHaveBeenCalledWith({ ids: [1], action: { type: 'delete' } });
    expect((await app.inject({ method: 'POST', url: '/api/cards/bulk', payload: { ids: [], action: { type: 'delete' } } })).statusCode).toBe(400);
  });

  it('POST /api/import/resolve validates and forwards', async () => {
    const { app, importer } = setup();
    const payload = { name: 'Sol Ring', setCode: 'c21', respectSet: true, languages: [], minCondition: 'Near Mint', foil: false };
    const res = await app.inject({ method: 'POST', url: '/api/import/resolve', payload });
    expect(res.statusCode).toBe(200);
    expect(importer.resolve).toHaveBeenCalledWith(payload);
    expect((await app.inject({ method: 'POST', url: '/api/import/resolve', payload: { name: '' } })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/api/app.test.ts`
Expected: FAIL (404 on new routes, 502 instead of 503).

- [ ] **Step 3: Implement**

In `server/src/api/app.ts`:
- Add to the `@ctzero/shared` import: `bulkCardsSchema`, `groupInputSchema`, `importResolveSchema`, `type CardGroup`, `type ImportResolveResult`.
- `import { HttpError, isFatalHttpError } from '../clients/http';`
- `import { deleteGroup, insertGroup, listGroups, renameGroup } from '../db/groups-repo';`
- `import type { ImportService } from '../import/import-service';`
- `AppDeps`: `cards: Pick<CardService, 'list' | 'create' | 'update' | 'delete' | 'preview' | 'bulk'>;` and `importer: Pick<ImportService, 'resolve'>;`
- Error handler line for `HttpError`:

```ts
    // Missing or invalid token: retrying is pointless, the client stops its batch.
    if (err instanceof HttpError) return reply.status(isFatalHttpError(err) ? 503 : 502).send({ error: err.message });
```

- After `app.post('/api/cards/preview', ...)`:

```ts
  app.post('/api/cards/bulk', async (req) => deps.cards.bulk(bulkCardsSchema.parse(req.body)));

  app.get('/api/groups', async (): Promise<CardGroup[]> => listGroups(deps.db));

  app.post('/api/groups', async (req, reply) => {
    const group = insertGroup(deps.db, groupInputSchema.parse(req.body).name);
    return reply.status(201).send(group);
  });

  app.put('/api/groups/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return renameGroup(deps.db, id, groupInputSchema.parse(req.body).name);
  });

  app.delete('/api/groups/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    if (!deleteGroup(deps.db, id)) throw new NotFoundError('Group not found');
    return reply.status(204).send();
  });

  app.post(
    '/api/import/resolve',
    async (req): Promise<ImportResolveResult> => deps.importer.resolve(importResolveSchema.parse(req.body)),
  );
```

In `server/src/main.ts`: `import { ImportService } from './import/import-service';`, after `const cards = ...`: `const importer = new ImportService({ db, catalog, ct });`, and pass `importer` to `buildApp`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/api/app.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`npm test` and `npm run typecheck` green. No commit.

---

### Task 8: Web pure modules: batch runner, group summary, bulk filters

**Files:**
- Create: `web/src/batch-runner.ts`, `web/src/group-summary.ts`, `web/src/bulk-filters.ts`
- Test: `web/src/batch-runner.test.ts`, `web/src/group-summary.test.ts`, `web/src/bulk-filters.test.ts`

**Interfaces:**
- Consumes: `ApiError` (`web/src/api.ts`), `cardStatus`, `PricedItem` (`web/src/card-status.ts`), `CardUpdate`, `TrackedCard` (shared).
- Produces:
  - `isFatalApiError(e: unknown): boolean` (ApiError with status 503)
  - `interface BatchOutcome<T, R> { results: { item: T; value: R }[]; errors: { item: T; message: string; status: number | null }[]; stopped: 'aborted' | 'fatal' | null; fatalMessage: string | null }`
  - `runBatch<T, R>(items: T[], task: (item: T) => Promise<R>, opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; isFatal?: (e: unknown) => boolean }): Promise<BatchOutcome<T, R>>`
  - `type GroupFilter = 'all' | 'none' | number`; `parseGroupFilter(raw: unknown, groupIds: number[]): GroupFilter`; `groupFilterQuery(f: GroupFilter): string | undefined`; `filterByGroup<T extends { groupId: number | null }>(cards: T[], f: GroupFilter): T[]`
  - `interface GroupSummary { count: number; below: number; problems: number; totalPriceCents: number; totalThresholdCents: number; missingPrice: number }`; `summarize(cards: PricedItem[]): GroupSummary`
  - `interface FilterChange { languages?: Language[]; minCondition?: Condition; foil?: boolean }`; `filterUpdate(card: TrackedCard, change: FilterChange): CardUpdate`

- [ ] **Step 1: Write the failing tests**

`web/src/batch-runner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { isFatalApiError, runBatch } from './batch-runner';

describe('runBatch', () => {
  it('runs in order, reports progress and collects results', async () => {
    const order: number[] = [];
    const onProgress = vi.fn();
    const out = await runBatch([1, 2, 3], async (n) => (order.push(n), n * 10), { onProgress });
    expect(order).toEqual([1, 2, 3]);
    expect(out.results.map((r) => r.value)).toEqual([10, 20, 30]);
    expect(out.stopped).toBeNull();
    expect(onProgress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it('collects errors with their status and keeps going', async () => {
    const out = await runBatch([1, 2, 3], async (n) => {
      if (n === 2) throw new ApiError(404, 'Card "x" not found');
      return n;
    });
    expect(out.results.map((r) => r.item)).toEqual([1, 3]);
    expect(out.errors).toEqual([{ item: 2, message: 'Card "x" not found', status: 404 }]);
  });

  it('stops on a fatal error', async () => {
    const task = vi.fn(async (n: number) => {
      if (n === 2) throw new ApiError(503, 'HTTP 401 from api.cardtrader.com');
      return n;
    });
    const out = await runBatch([1, 2, 3], task);
    expect(task).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ stopped: 'fatal', fatalMessage: 'HTTP 401 from api.cardtrader.com' });
    expect(out.errors).toEqual([]);
  });

  it('abort lets the running item finish, then stops', async () => {
    const controller = new AbortController();
    const out = await runBatch([1, 2, 3], async (n) => {
      if (n === 1) controller.abort();
      return n;
    }, { signal: controller.signal });
    expect(out.results.map((r) => r.item)).toEqual([1]);
    expect(out.stopped).toBe('aborted');
  });

  it('isFatalApiError only for 503 ApiErrors', () => {
    expect(isFatalApiError(new ApiError(503, 'x'))).toBe(true);
    expect(isFatalApiError(new ApiError(502, 'x'))).toBe(false);
    expect(isFatalApiError(new Error('x'))).toBe(false);
  });
});
```

`web/src/group-summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterByGroup, groupFilterQuery, parseGroupFilter, summarize } from './group-summary';

describe('parseGroupFilter', () => {
  it('reads all / none / existing ids', () => {
    expect(parseGroupFilter(undefined, [1])).toBe('all');
    expect(parseGroupFilter('none', [1])).toBe('none');
    expect(parseGroupFilter('1', [1])).toBe(1);
  });

  it('falls back to all for stale or junk values', () => {
    expect(parseGroupFilter('7', [1])).toBe('all');
    expect(parseGroupFilter('abc', [1])).toBe('all');
    expect(parseGroupFilter(['1'], [1])).toBe('all');
  });

  it('round-trips through the query', () => {
    expect(groupFilterQuery('all')).toBeUndefined();
    expect(groupFilterQuery('none')).toBe('none');
    expect(groupFilterQuery(3)).toBe('3');
  });
});

describe('filterByGroup', () => {
  const cards = [{ groupId: 1 }, { groupId: null }, { groupId: 2 }];
  it('filters', () => {
    expect(filterByGroup(cards, 'all')).toHaveLength(3);
    expect(filterByGroup(cards, 'none')).toEqual([{ groupId: null }]);
    expect(filterByGroup(cards, 2)).toEqual([{ groupId: 2 }]);
  });
});

describe('summarize', () => {
  const base = { name: 'x', lastSyncStatus: 'ok' as const, alertState: 'above' as const };
  it('counts statuses and sums prices and thresholds', () => {
    const s = summarize([
      { ...base, thresholdCents: 1000, lastPriceCents: 900, alertState: 'below' },
      { ...base, thresholdCents: 500, lastPriceCents: 700 },
      { ...base, thresholdCents: 300, lastPriceCents: null, lastSyncStatus: 'no_offers' },
      { ...base, thresholdCents: 200, lastPriceCents: null, lastSyncStatus: 'error' },
    ]);
    expect(s).toEqual({ count: 4, below: 1, problems: 2, totalPriceCents: 1600, totalThresholdCents: 2000, missingPrice: 2 });
  });

  it('empty', () => {
    expect(summarize([])).toEqual({ count: 0, below: 0, problems: 0, totalPriceCents: 0, totalThresholdCents: 0, missingPrice: 0 });
  });
});
```

`web/src/bulk-filters.test.ts`:

```ts
import type { TrackedCard } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { filterUpdate } from './bulk-filters';

const card = {
  id: 1,
  expansionIds: [5],
  languages: ['en'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 1200,
  groupId: 3,
} as unknown as TrackedCard;

describe('filterUpdate', () => {
  it('keeps the card values for fields not being changed, and never sends groupId', () => {
    expect(filterUpdate(card, { foil: true })).toEqual({
      expansionIds: [5],
      languages: ['en'],
      minCondition: 'Near Mint',
      foil: true,
      thresholdCents: 1200,
    });
  });

  it('replaces the changed fields', () => {
    expect(filterUpdate(card, { languages: [], minCondition: 'Played' })).toMatchObject({ languages: [], minCondition: 'Played' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/src/batch-runner.test.ts web/src/group-summary.test.ts web/src/bulk-filters.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`web/src/batch-runner.ts`:

```ts
import { ApiError } from './api';

export interface BatchOutcome<T, R> {
  results: { item: T; value: R }[];
  errors: { item: T; message: string; status: number | null }[];
  /** Why the batch ended early, if it did. */
  stopped: 'aborted' | 'fatal' | null;
  fatalMessage: string | null;
}

/** The server answers 503 when CardTrader rejects the token: every following call would fail too. */
export function isFatalApiError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 503;
}

/**
 * Runs `task` on each item, one at a time. Errors are collected and the batch goes on,
 * except for fatal ones. After `signal` is aborted, the running item finishes and the batch stops.
 */
export async function runBatch<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; isFatal?: (e: unknown) => boolean } = {},
): Promise<BatchOutcome<T, R>> {
  const isFatal = opts.isFatal ?? isFatalApiError;
  const out: BatchOutcome<T, R> = { results: [], errors: [], stopped: null, fatalMessage: null };
  let done = 0;
  opts.onProgress?.(0, items.length);
  for (const item of items) {
    if (opts.signal?.aborted) {
      out.stopped = 'aborted';
      break;
    }
    try {
      out.results.push({ item, value: await task(item) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isFatal(e)) {
        out.stopped = 'fatal';
        out.fatalMessage = message;
        break;
      }
      out.errors.push({ item, message, status: e instanceof ApiError ? e.status : null });
    }
    opts.onProgress?.(++done, items.length);
  }
  return out;
}
```

`web/src/group-summary.ts`:

```ts
import { cardStatus, type PricedItem } from './card-status';

/** Group shown in the cards page: every card, cards without a group, or one group. */
export type GroupFilter = 'all' | 'none' | number;

/** Reads `?group=`; unknown ids (e.g. a deleted group) and junk fall back to 'all'. */
export function parseGroupFilter(raw: unknown, groupIds: number[]): GroupFilter {
  if (raw === 'none') return 'none';
  if (typeof raw !== 'string') return 'all';
  const id = Number(raw);
  return Number.isInteger(id) && groupIds.includes(id) ? id : 'all';
}

export function groupFilterQuery(f: GroupFilter): string | undefined {
  return f === 'all' ? undefined : String(f);
}

export function filterByGroup<T extends { groupId: number | null }>(cards: T[], f: GroupFilter): T[] {
  if (f === 'all') return cards;
  if (f === 'none') return cards.filter((c) => c.groupId === null);
  return cards.filter((c) => c.groupId === f);
}

export interface GroupSummary {
  count: number;
  below: number;
  /** No offers or last update failed. */
  problems: number;
  totalPriceCents: number;
  totalThresholdCents: number;
  /** Cards not counted in `totalPriceCents`. */
  missingPrice: number;
}

export function summarize(cards: PricedItem[]): GroupSummary {
  const s: GroupSummary = { count: 0, below: 0, problems: 0, totalPriceCents: 0, totalThresholdCents: 0, missingPrice: 0 };
  for (const c of cards) {
    const status = cardStatus(c);
    s.count++;
    if (status === 'below') s.below++;
    if (status === 'no_offers' || status === 'error') s.problems++;
    if (c.lastPriceCents === null) s.missingPrice++;
    else s.totalPriceCents += c.lastPriceCents;
    s.totalThresholdCents += c.thresholdCents;
  }
  return s;
}
```

`web/src/bulk-filters.ts`:

```ts
import type { CardUpdate, Condition, Language, TrackedCard } from '@ctzero/shared';

/** Fields chosen in the bulk filters dialog; missing ones keep each card's own value. */
export interface FilterChange {
  languages?: Language[];
  minCondition?: Condition;
  foil?: boolean;
}

/** Full update for one card: expansions and threshold are always the card's own; the group is left untouched. */
export function filterUpdate(card: TrackedCard, change: FilterChange): CardUpdate {
  return {
    expansionIds: card.expansionIds,
    languages: change.languages ?? card.languages,
    minCondition: change.minCondition ?? card.minCondition,
    foil: change.foil ?? card.foil,
    thresholdCents: card.thresholdCents,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/src`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`npm run typecheck` green. No commit.

---

### Task 9: Cards page: group selector, summary, group management, group in `CardDialog`

**Files:**
- Create: `web/src/components/GroupsDialog.vue`
- Modify: `web/src/pages/CardsPage.vue`, `web/src/components/CardDialog.vue`, `web/src/style.css`

**Interfaces:**
- Consumes: `CardGroup` (Task 1), `/api/groups` (Task 7), `parseGroupFilter`, `groupFilterQuery`, `filterByGroup`, `summarize`, `GroupFilter` (Task 8).
- Produces: `GroupsDialog` (`v-model:visible`, prop `groups: CardGroup[]`, emits `changed`); `CardDialog` new props `groups: CardGroup[]`, `defaultGroupId: number | null`; in `CardsPage`: `groups` ref, `load()` loading cards and groups, `rows` filtered by group (used by Task 10).

- [ ] **Step 1: `GroupsDialog.vue`**

```vue
<script setup lang="ts">
import type { CardGroup } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { useConfirm } from 'primevue/useconfirm';
import { ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ groups: CardGroup[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ changed: [] }>();
const confirm = useConfirm();

const newName = ref('');
const names = ref<Record<number, string>>({});
const error = ref<string | null>(null);
const busy = ref(false);

watch(
  () => props.groups,
  (groups) => {
    names.value = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  },
  { immediate: true },
);

watch(visible, (open) => {
  if (open) {
    newName.value = '';
    error.value = null;
  }
});

async function run(action: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await action();
    emit('changed');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function create() {
  const name = newName.value.trim();
  if (!name) return;
  void run(async () => {
    await api.post('/api/groups', { name });
    newName.value = '';
  });
}

function rename(group: CardGroup) {
  const name = names.value[group.id]?.trim();
  if (!name || name === group.name) return;
  void run(() => api.put(`/api/groups/${group.id}`, { name }));
}

function remove(group: CardGroup) {
  confirm.require({
    message: `Delete group "${group.name}"? Its ${group.cardCount} cards stay tracked, without a group.`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: () => void run(() => api.del(`/api/groups/${group.id}`)),
  });
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Groups" :style="{ width: '32rem' }">
    <p v-if="groups.length === 0" class="muted">No groups yet.</p>
    <div v-for="group in groups" :key="group.id" class="group-row">
      <InputText v-model="names[group.id]" fluid :disabled="busy" @keyup.enter="rename(group)" />
      <span class="muted count">{{ group.cardCount }} cards</span>
      <Button
        v-tooltip.top="'Rename'"
        icon="pi pi-check"
        text
        rounded
        :disabled="busy || !names[group.id]?.trim() || names[group.id]?.trim() === group.name"
        @click="rename(group)"
      />
      <Button v-tooltip.top="'Delete'" icon="pi pi-trash" text rounded severity="danger" :disabled="busy" @click="remove(group)" />
    </div>
    <div class="group-row new">
      <InputText v-model="newName" placeholder="New group name" fluid :disabled="busy" @keyup.enter="create" />
      <Button label="Add" icon="pi pi-plus" :disabled="busy || !newName.trim()" @click="create" />
    </div>
    <Message v-if="error" severity="error">{{ error }}</Message>
    <template #footer>
      <Button label="Close" severity="secondary" text @click="visible = false" />
    </template>
  </Dialog>
</template>

<style scoped>
.group-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.group-row.new {
  margin-top: 1rem;
}
.count {
  white-space: nowrap;
}
</style>
```

- [ ] **Step 2: `CardDialog.vue`: group field**

- Add `type CardGroup` to the `@ctzero/shared` import.
- Props: `const props = defineProps<{ card: TrackedCard | null; groups: CardGroup[]; defaultGroupId: number | null }>();`
- State: `const groupId = ref<number | null>(null);`
- In `reset()`: `groupId.value = c ? c.groupId : props.defaultGroupId;`
- In `save()`: `const payload = { ...filters(), thresholdCents: euroToCents(thresholdEuro.value), groupId: groupId.value };`
- Template, inside `<div v-if="lookup" class="pricing">` right before the threshold field:

```vue
      <div class="field">
        <label for="group">Group</label>
        <Select
          v-model="groupId"
          input-id="group"
          :options="groups"
          option-label="name"
          option-value="id"
          placeholder="No group"
          show-clear
          fluid
        />
      </div>
```

- [ ] **Step 3: `CardsPage.vue`: groups, selector, summary**

Script changes:

```ts
import { CONDITION_ABBR, LANGUAGE_LABELS, formatEuro, type CardGroup, type TrackedCard } from '@ctzero/shared';
import Select from 'primevue/select';
import { useRoute, useRouter } from 'vue-router';
import GroupsDialog from '../components/GroupsDialog.vue';
import { filterByGroup, groupFilterQuery, parseGroupFilter, summarize, type GroupFilter } from '../group-summary';

const route = useRoute();
const router = useRouter();
const groups = ref<CardGroup[]>([]);
const groupsDialogVisible = ref(false);

const groupFilter = computed(() => parseGroupFilter(route.query.group, groups.value.map((g) => g.id)));
const groupOptions = computed(() => [
  { label: 'All cards', value: 'all' as GroupFilter },
  { label: 'No group', value: 'none' as GroupFilter },
  ...groups.value.map((g) => ({ label: `${g.name} (${g.cardCount})`, value: g.id as GroupFilter })),
]);
const groupNames = computed(() => new Map(groups.value.map((g) => [g.id, g.name])));
const rows = computed(() => sortForDisplay(filterByGroup(cards.value, groupFilter.value)));
const summary = computed(() => summarize(rows.value));
const defaultGroupId = computed(() => (typeof groupFilter.value === 'number' ? groupFilter.value : null));

function setGroupFilter(value: GroupFilter) {
  void router.replace({ query: { ...route.query, group: groupFilterQuery(value) } });
}
```

(remove the old `const rows = computed(() => sortForDisplay(cards.value));`.)

Replace `load()`:

```ts
async function load() {
  loading.value = true;
  try {
    [cards.value, groups.value] = await Promise.all([
      api.get<TrackedCard[]>('/api/cards'),
      api.get<CardGroup[]>('/api/groups'),
    ]);
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  } finally {
    loading.value = false;
  }
}
```

In `filterChips(card)`, add the group as first chip when all cards are shown:

```ts
function filterChips(card: TrackedCard): string[] {
  const group = groupFilter.value === 'all' && card.groupId !== null ? groupNames.value.get(card.groupId) : undefined;
  return [
    ...(group ? [`📁 ${group}`] : []),
    card.expansionNames.length > 0 ? card.expansionNames.join(', ') : 'Any expansion',
    card.languages.length > 0 ? card.languages.map((l) => LANGUAGE_LABELS[l]).join(', ') : 'Any language',
    `≥ ${CONDITION_ABBR[card.minCondition]}`,
    card.foil ? 'Foil' : 'Non-foil',
  ];
}
```

Template: replace the page header and add the toolbar + summary between `<SyncHeader>` and `<DataTable>`:

```vue
  <div class="page-header">
    <h1>Tracked cards</h1>
    <div class="header-actions">
      <Button label="Import list" icon="pi pi-upload" severity="secondary" outlined @click="router.push('/import')" />
      <Button label="Add card" icon="pi pi-plus" @click="openNew" />
    </div>
  </div>

  <SyncHeader @finished="load" />

  <div class="group-toolbar">
    <Select
      :model-value="groupFilter"
      :options="groupOptions"
      option-label="label"
      option-value="value"
      aria-label="Group"
      class="group-select"
      @update:model-value="setGroupFilter"
    />
    <Button label="Manage groups" icon="pi pi-folder" severity="secondary" text @click="groupsDialogVisible = true" />
  </div>

  <div class="summary">
    <span><strong>{{ summary.count }}</strong> cards</span>
    <span><strong>{{ summary.below }}</strong> below threshold</span>
    <span v-if="summary.problems > 0"><strong>{{ summary.problems }}</strong> no offers / error</span>
    <span>
      Current total <strong>{{ formatEuro(summary.totalPriceCents) }}</strong>
      <span v-if="summary.missingPrice > 0" class="muted">({{ summary.missingPrice }} without price)</span>
    </span>
    <span>Threshold total <strong>{{ formatEuro(summary.totalThresholdCents) }}</strong></span>
  </div>
```

Pass the new props to `CardDialog` and add `GroupsDialog`:

```vue
  <CardDialog
    v-model:visible="dialogVisible"
    :card="editing"
    :groups="groups"
    :default-group-id="defaultGroupId"
    @saved="onSaved"
  />
  <GroupsDialog v-model:visible="groupsDialogVisible" :groups="groups" @changed="load" />
```

Scoped styles, add:

```css
.header-actions {
  display: flex;
  gap: 0.5rem;
}
.group-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.group-select {
  min-width: 16rem;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  margin-bottom: 1rem;
}
```

Note: the "Import list" button navigates to `/import`, whose page is built in Task 12; until then that route shows an empty view.

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → PASS. Then `npm run dev:server` and `npm run dev:web`, open http://localhost:5173 and check by hand:
- "Manage groups": create "Deck", rename it to "Atraxa", try "atraxa" again → error message shown in the dialog.
- Edit a card, set Group = Atraxa, save → the 📁 chip appears; the selector shows "Atraxa (1)".
- Select "Atraxa" → URL becomes `/?group=<id>`, only that card is shown, summary counts 1; refresh keeps the filter.
- "Add card" while filtered on Atraxa → Group pre-filled with Atraxa.
- Delete the group → card stays, chip disappears, URL `?group=<id>` now shows "All cards".

- [ ] **Step 5: Checkpoint**

`npm test` green. No commit.

---

### Task 10: Selection and bulk dialogs

**Files:**
- Create: `web/src/components/BulkThresholdDialog.vue`, `web/src/components/BulkGroupDialog.vue`, `web/src/components/BulkFiltersDialog.vue`
- Modify: `web/src/pages/CardsPage.vue`, `web/src/style.css`

**Interfaces:**
- Consumes: `POST /api/cards/bulk` (Task 7), `BulkAction`, `BulkResult` (Task 1), `runBatch`, `BatchOutcome`, `filterUpdate`, `FilterChange` (Task 8), `groups`, `rows`, `load` in `CardsPage` (Task 9).
- Produces: three dialogs, each with `v-model:visible` and prop `cards: TrackedCard[]`; `BulkThresholdDialog` and `BulkGroupDialog` emit `done: [result: BulkResult]`; `BulkGroupDialog` also takes `groups: CardGroup[]` and emits `groupsChanged: []`; `BulkFiltersDialog` emits `done: []`.

- [ ] **Step 1: Shared error list style**

Append to `web/src/style.css`:

```css
.error-list {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  max-height: 14rem;
  overflow-y: auto;
  font-size: 0.875rem;
}
```

- [ ] **Step 2: `BulkThresholdDialog.vue`**

```vue
<script setup lang="ts">
import { euroToCents, type BulkAction, type BulkResult, type TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import SelectButton from 'primevue/selectbutton';
import { computed, ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ cards: TrackedCard[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [result: BulkResult] }>();

const modeOptions = [
  { label: '% below current price', value: 'percent' },
  { label: 'Fixed amount', value: 'fixed' },
];
const mode = ref<'percent' | 'fixed'>('percent');
const percent = ref<number | null>(10);
const euro = ref<number | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);

watch(visible, (open) => {
  if (open) error.value = null;
});

const action = computed<BulkAction | null>(() => {
  if (mode.value === 'percent') {
    return percent.value !== null && percent.value >= 1 && percent.value <= 90
      ? { type: 'threshold', mode: 'percent', percent: percent.value }
      : null;
  }
  return euro.value !== null && euro.value > 0 ? { type: 'threshold', mode: 'fixed', cents: euroToCents(euro.value) } : null;
});

async function apply() {
  if (!action.value) return;
  saving.value = true;
  error.value = null;
  try {
    const result = await api.post<BulkResult>('/api/cards/bulk', { ids: props.cards.map((c) => c.id), action: action.value });
    emit('done', result);
    visible.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Change threshold" :style="{ width: '30rem' }">
    <p class="muted">Applies to {{ cards.length }} cards.</p>
    <div class="field">
      <SelectButton v-model="mode" :options="modeOptions" option-label="label" option-value="value" :allow-empty="false" />
    </div>
    <div v-if="mode === 'percent'" class="field">
      <label for="bulk-percent">Percent below the current price</label>
      <InputNumber v-model="percent" input-id="bulk-percent" suffix=" %" :min="1" :max="90" />
      <small class="muted">Cards without a current price are skipped.</small>
    </div>
    <div v-else class="field">
      <label for="bulk-euro">Threshold</label>
      <InputNumber v-model="euro" input-id="bulk-euro" mode="currency" currency="EUR" locale="en-US" :min="0.01" />
    </div>
    <Message v-if="error" severity="error">{{ error }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Apply" icon="pi pi-check" :disabled="!action" :loading="saving" @click="apply" />
    </template>
  </Dialog>
</template>
```

- [ ] **Step 3: `BulkGroupDialog.vue`**

```vue
<script setup lang="ts">
import type { BulkResult, CardGroup, TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ cards: TrackedCard[]; groups: CardGroup[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [result: BulkResult]; groupsChanged: [] }>();

/** null = remove from any group. */
const groupId = ref<number | null>(null);
const newName = ref('');
const error = ref<string | null>(null);
const saving = ref(false);

watch(visible, (open) => {
  if (open) {
    groupId.value = null;
    newName.value = '';
    error.value = null;
  }
});

async function createGroup() {
  const name = newName.value.trim();
  if (!name) return;
  error.value = null;
  try {
    const group = await api.post<CardGroup>('/api/groups', { name });
    newName.value = '';
    groupId.value = group.id;
    emit('groupsChanged');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function apply() {
  saving.value = true;
  error.value = null;
  try {
    const result = await api.post<BulkResult>('/api/cards/bulk', {
      ids: props.cards.map((c) => c.id),
      action: { type: 'group', groupId: groupId.value },
    });
    emit('done', result);
    visible.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Move to group" :style="{ width: '30rem' }">
    <p class="muted">Applies to {{ cards.length }} cards.</p>
    <div class="field">
      <label for="bulk-group">Group</label>
      <Select
        v-model="groupId"
        input-id="bulk-group"
        :options="groups"
        option-label="name"
        option-value="id"
        placeholder="No group (remove from group)"
        show-clear
        fluid
      />
    </div>
    <div class="field">
      <label for="bulk-new-group">Or create a new group</label>
      <div class="new-group">
        <InputText v-model="newName" input-id="bulk-new-group" placeholder="Group name" fluid @keyup.enter="createGroup" />
        <Button label="Create" icon="pi pi-plus" severity="secondary" :disabled="!newName.trim()" @click="createGroup" />
      </div>
    </div>
    <Message v-if="error" severity="error">{{ error }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Move" icon="pi pi-check" :loading="saving" @click="apply" />
    </template>
  </Dialog>
</template>

<style scoped>
.new-group {
  display: flex;
  gap: 0.5rem;
}
</style>
```

- [ ] **Step 4: `BulkFiltersDialog.vue`**

```vue
<script setup lang="ts">
import {
  CONDITIONS,
  LANGUAGES,
  LANGUAGE_LABELS,
  type Condition,
  type Language,
  type TrackedCard,
} from '@ctzero/shared';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import ProgressBar from 'primevue/progressbar';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { runBatch, type BatchOutcome } from '../batch-runner';
import { filterUpdate, type FilterChange } from '../bulk-filters';

const props = defineProps<{ cards: TrackedCard[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [] }>();

const conditionOptions = [...CONDITIONS];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));

const changeLanguages = ref(false);
const changeCondition = ref(false);
const changeFoil = ref(false);
const languages = ref<Language[]>([]);
const minCondition = ref<Condition>('Near Mint');
const foil = ref(false);
const running = ref(false);
const progress = ref({ done: 0, total: 0 });
const outcome = ref<BatchOutcome<TrackedCard, TrackedCard> | null>(null);
let controller: AbortController | null = null;

watch(visible, (open) => {
  if (!open) return;
  changeLanguages.value = false;
  changeCondition.value = false;
  changeFoil.value = false;
  outcome.value = null;
  progress.value = { done: 0, total: 0 };
});

const change = computed<FilterChange>(() => ({
  ...(changeLanguages.value ? { languages: languages.value } : {}),
  ...(changeCondition.value ? { minCondition: minCondition.value } : {}),
  ...(changeFoil.value ? { foil: foil.value } : {}),
}));
const canApply = computed(() => Object.keys(change.value).length > 0);
const percentDone = computed(() =>
  progress.value.total === 0 ? 0 : Math.round((progress.value.done / progress.value.total) * 100),
);

async function apply() {
  const c = change.value;
  const cards = [...props.cards];
  controller = new AbortController();
  running.value = true;
  try {
    outcome.value = await runBatch(
      cards,
      (card) => api.put<TrackedCard>(`/api/cards/${card.id}`, filterUpdate(card, c)),
      { signal: controller.signal, onProgress: (done, total) => (progress.value = { done, total }) },
    );
  } finally {
    running.value = false;
    controller = null;
    emit('done');
  }
}

function abort() {
  controller?.abort();
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Change filters" :closable="!running" :style="{ width: '34rem' }">
    <template v-if="!running && !outcome">
      <p class="muted">
        Applies to {{ cards.length }} cards. Unchecked fields keep each card's own value; expansions never change.
        Every card is re-priced, so this can take a few minutes: keep this tab open.
      </p>
      <div class="field inline">
        <Checkbox v-model="changeLanguages" binary input-id="chg-languages" />
        <label for="chg-languages">Languages</label>
      </div>
      <div v-if="changeLanguages" class="field">
        <MultiSelect
          v-model="languages"
          :options="languageOptions"
          option-label="label"
          option-value="code"
          placeholder="Any language"
          display="chip"
          fluid
        />
      </div>
      <div class="field inline">
        <Checkbox v-model="changeCondition" binary input-id="chg-condition" />
        <label for="chg-condition">Minimum condition</label>
      </div>
      <div v-if="changeCondition" class="field">
        <Select v-model="minCondition" :options="conditionOptions" fluid />
      </div>
      <div class="field inline">
        <Checkbox v-model="changeFoil" binary input-id="chg-foil" />
        <label for="chg-foil">Foil</label>
        <ToggleSwitch v-if="changeFoil" v-model="foil" />
      </div>
    </template>
    <template v-else>
      <ProgressBar :value="percentDone">{{ progress.done }}/{{ progress.total }}</ProgressBar>
      <template v-if="outcome">
        <p>
          {{ outcome.results.length }} updated<span v-if="outcome.errors.length">, {{ outcome.errors.length }} failed</span>.
        </p>
        <Message v-if="outcome.stopped === 'fatal'" severity="error">Stopped: {{ outcome.fatalMessage }}</Message>
        <Message v-else-if="outcome.stopped === 'aborted'" severity="warn">Stopped before the end.</Message>
        <ul v-if="outcome.errors.length" class="error-list">
          <li v-for="e in outcome.errors" :key="e.item.id"><strong>{{ e.item.name }}</strong>: {{ e.message }}</li>
        </ul>
      </template>
    </template>
    <template #footer>
      <Button v-if="running" label="Stop" severity="danger" text @click="abort" />
      <Button v-else-if="outcome" label="Close" @click="visible = false" />
      <template v-else>
        <Button label="Cancel" severity="secondary" text @click="visible = false" />
        <Button label="Apply" icon="pi pi-check" :disabled="!canApply" @click="apply" />
      </template>
    </template>
  </Dialog>
</template>
```

- [ ] **Step 5: `CardsPage.vue`: selection, toolbar, dialogs**

Script additions:

```ts
import type { BulkResult } from '@ctzero/shared';
import BulkFiltersDialog from '../components/BulkFiltersDialog.vue';
import BulkGroupDialog from '../components/BulkGroupDialog.vue';
import BulkThresholdDialog from '../components/BulkThresholdDialog.vue';
import { watch } from 'vue';

const selected = ref<TrackedCard[]>([]);
const bulkDialog = ref<'threshold' | 'group' | 'filters' | null>(null);
const bulkVisible = (kind: 'threshold' | 'group' | 'filters') =>
  computed({
    get: () => bulkDialog.value === kind,
    set: (open: boolean) => (bulkDialog.value = open ? kind : null),
  });
const thresholdVisible = bulkVisible('threshold');
const groupVisible = bulkVisible('group');
const filtersVisible = bulkVisible('filters');

// The selection only makes sense within the group being shown.
watch(groupFilter, () => (selected.value = []));

async function loadGroups() {
  try {
    groups.value = await api.get<CardGroup[]>('/api/groups');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  }
}

function onBulkDone(result: BulkResult) {
  const skipped = result.skipped.length > 0 ? `, ${result.skipped.length} skipped (${result.skipped[0]!.reason})` : '';
  toast.add({ severity: 'success', summary: `${result.updated.length} cards updated${skipped}`, life: 4000 });
  selected.value = [];
  void load();
}

function onFiltersDone() {
  selected.value = [];
  void load();
}

function confirmBulkDelete() {
  const ids = selected.value.map((c) => c.id);
  confirm.require({
    message: `Stop tracking ${ids.length} cards?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        onBulkDone(await api.post<BulkResult>('/api/cards/bulk', { ids, action: { type: 'delete' } }));
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
      }
    },
  });
}
```

(merge the `vue` import into the existing one: `import { computed, onMounted, ref, watch } from 'vue';`, and `BulkResult` into the existing `@ctzero/shared` import.)

Template: right before `<DataTable>`:

```vue
  <div v-if="selected.length > 0" class="bulk-bar">
    <strong>{{ selected.length }} selected</strong>
    <Button label="Threshold…" icon="pi pi-euro" size="small" outlined @click="bulkDialog = 'threshold'" />
    <Button label="Filters…" icon="pi pi-filter" size="small" outlined @click="bulkDialog = 'filters'" />
    <Button label="Move to group…" icon="pi pi-folder" size="small" outlined @click="bulkDialog = 'group'" />
    <Button label="Delete" icon="pi pi-trash" size="small" severity="danger" outlined @click="confirmBulkDelete" />
    <Button label="Clear selection" size="small" text @click="selected = []" />
  </div>
```

`DataTable`: add `v-model:selection="selected"` and as first column:

```vue
    <Column selection-mode="multiple" header-style="width: 3rem" />
```

After the other dialogs:

```vue
  <BulkThresholdDialog v-model:visible="thresholdVisible" :cards="selected" @done="onBulkDone" />
  <BulkGroupDialog
    v-model:visible="groupVisible"
    :cards="selected"
    :groups="groups"
    @done="onBulkDone"
    @groups-changed="loadGroups"
  />
  <BulkFiltersDialog v-model:visible="filtersVisible" :cards="selected" @done="onFiltersDone" />
```

Scoped style:

```css
.bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 8px;
}
```

Note: `BulkFiltersDialog` copies `props.cards` at start and keeps its outcome after `done` clears the parent selection, so the result stays visible until "Close".

- [ ] **Step 6: Verify**

`npm run typecheck` → PASS. Manual check with dev servers:
- Select 2 cards → toolbar shows "2 selected"; header checkbox selects all rows of the current group only.
- Threshold… → 10% → toast "2 cards updated"; thresholds = price −10%. With a card without price → "1 skipped (no current price)".
- Move to group… → create "Wishlist" inside the dialog → Move → cards moved; selector shows the new group.
- Filters… → check Foil, toggle on → Apply → progress bar advances, "Stop" stops after the current card; closing is disabled while running; errors listed per card.
- Delete → confirm → cards gone.

- [ ] **Step 7: Checkpoint**

`npm test` green. No commit.

---

### Task 11: Import review module

**Files:**
- Create: `web/src/import-review.ts`
- Test: `web/src/import-review.test.ts`

**Interfaces:**
- Consumes: `DecklistLine`, `ImportResolveResult`, `CardInput`, `percentBelow`, `Language`, `Condition` (shared), `BatchOutcome` (Task 8).
- Produces:
  - `type ThresholdDefault = { mode: 'percent'; percent: number } | { mode: 'fixed'; cents: number }`
  - `type RowStatus = 'ok' | 'tracked' | 'no_offers' | 'not_found' | 'error'`
  - `interface ReviewRow { line: DecklistLine; foil: boolean; result: ImportResolveResult | null; error: string | null; status: RowStatus; include: boolean; thresholdCents: number | null }`
  - `proposeThreshold(priceCents: number | null, def: ThresholdDefault): number | null`
  - `buildReviewRows(lines: DecklistLine[], outcome: Pick<BatchOutcome<DecklistLine, ImportResolveResult>, 'results' | 'errors'>, def: ThresholdDefault, defaultFoil: boolean): ReviewRow[]`
  - `canInclude(row: ReviewRow): boolean`
  - `setRowThreshold(row: ReviewRow, cents: number | null): void`
  - `rowsToCreate(rows: ReviewRow[]): ReviewRow[]`
  - `createPayload(row: ReviewRow, opts: { languages: Language[]; minCondition: Condition; groupId: number | null }): CardInput`

- [ ] **Step 1: Write the failing test**

`web/src/import-review.test.ts`:

```ts
import type { DecklistLine, ImportResolveResult } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import {
  buildReviewRows,
  canInclude,
  createPayload,
  proposeThreshold,
  rowsToCreate,
  setRowThreshold,
} from './import-review';

const line = (name: string, lineNo: number, foil = false): DecklistLine => ({ name, setCode: null, foil, lineNo });
const result = (over: Partial<ImportResolveResult> = {}): ImportResolveResult => ({
  name: 'Sol Ring',
  imageUrl: null,
  expansionIds: [],
  priceCents: 1000,
  listing: null,
  alreadyTracked: false,
  ...over,
});
const percent = { mode: 'percent' as const, percent: 10 };

describe('proposeThreshold', () => {
  it('percent of the current price, or the fixed amount', () => {
    expect(proposeThreshold(1000, percent)).toBe(900);
    expect(proposeThreshold(null, percent)).toBeNull();
    expect(proposeThreshold(null, { mode: 'fixed', cents: 500 })).toBe(500);
  });
});

describe('buildReviewRows', () => {
  const a = line('sol ring', 1);
  const b = line('Bolt', 2, true);
  const c = line('Xyz', 3);
  const d = line('Signet', 4);
  const e = line('Tower', 5);
  const f = line('Unresolved', 6);
  const outcome = {
    results: [
      { item: a, value: result() },
      { item: b, value: result({ name: 'Lightning Bolt', priceCents: null }) },
      { item: d, value: result({ name: 'Arcane Signet', alreadyTracked: true }) },
    ],
    errors: [
      { item: c, message: 'Card "Xyz" not found', status: 404 },
      { item: e, message: 'HTTP 502', status: 502 },
    ],
  };
  const rows = buildReviewRows([a, b, c, d, e, f], outcome, percent, false);

  it('keeps list order and drops lines never resolved (aborted)', () => {
    expect(rows.map((r) => r.line.lineNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it('sets status, default inclusion and proposed threshold', () => {
    expect(rows.map((r) => [r.status, r.include, r.thresholdCents])).toEqual([
      ['ok', true, 900],
      ['no_offers', false, null],
      ['not_found', false, null],
      ['tracked', false, 900],
      ['error', false, null],
    ]);
    expect(rows[2]!.error).toBe('Card "Xyz" not found');
  });

  it('foil comes from the line or the default', () => {
    expect(rows[1]!.foil).toBe(true);
    expect(buildReviewRows([a], outcome, percent, true)[0]!.foil).toBe(true);
  });

  it('fixed mode includes no-offer cards with the fixed threshold', () => {
    const fixed = buildReviewRows([b], outcome, { mode: 'fixed', cents: 300 }, false);
    expect(fixed[0]).toMatchObject({ status: 'no_offers', include: true, thresholdCents: 300 });
  });
});

describe('inclusion and threshold edits', () => {
  it('matches lines by identity: an equal but different line object is treated as unresolved', () => {
    const rows = buildReviewRows(
      [line('Bolt', 1)],
      { results: [{ item: line('Bolt', 1), value: result({ priceCents: null }) }], errors: [] },
      percent,
      false,
    );
    expect(rows).toEqual([]);
  });

  it('setRowThreshold: a manual threshold includes a no-offer row; clearing it excludes the row', () => {
    const l = line('Bolt', 1);
    const [row] = buildReviewRows([l], { results: [{ item: l, value: result({ priceCents: null }) }], errors: [] }, percent, false);
    expect(canInclude(row!)).toBe(false);
    setRowThreshold(row!, 250);
    expect(row).toMatchObject({ thresholdCents: 250, include: true });
    setRowThreshold(row!, null);
    expect(row).toMatchObject({ thresholdCents: null, include: false });
  });

  it('rowsToCreate keeps only included rows with a result and a threshold', () => {
    const l1 = line('A', 1);
    const l2 = line('B', 2);
    const rows = buildReviewRows(
      [l1, l2],
      { results: [{ item: l1, value: result() }, { item: l2, value: result({ alreadyTracked: true }) }], errors: [] },
      percent,
      false,
    );
    expect(rowsToCreate(rows).map((r) => r.line.name)).toEqual(['A']);
    rows[1]!.include = true;
    expect(rowsToCreate(rows)).toHaveLength(2);
  });
});

describe('createPayload', () => {
  it('builds the card input with the resolved name and expansions', () => {
    const l = line('sol ring', 1, true);
    const [row] = buildReviewRows([l], { results: [{ item: l, value: result({ expansionIds: [7] }) }], errors: [] }, percent, false);
    expect(createPayload(row!, { languages: ['en'], minCondition: 'Near Mint', groupId: 4 })).toEqual({
      name: 'Sol Ring',
      expansionIds: [7],
      languages: ['en'],
      minCondition: 'Near Mint',
      foil: true,
      thresholdCents: 900,
      groupId: 4,
    });
  });
});
```

Note on the identity test: rows are matched to batch results **by line object identity** (the same `DecklistLine` instances are passed to `runBatch` and to `buildReviewRows`), so a result for a different object with equal content is not matched and that line is dropped as unresolved. The test pins that contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/import-review.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`web/src/import-review.ts`:

```ts
import {
  percentBelow,
  type CardInput,
  type Condition,
  type DecklistLine,
  type ImportResolveResult,
  type Language,
} from '@ctzero/shared';
import type { BatchOutcome } from './batch-runner';

export type ThresholdDefault = { mode: 'percent'; percent: number } | { mode: 'fixed'; cents: number };

export type RowStatus = 'ok' | 'tracked' | 'no_offers' | 'not_found' | 'error';

export interface ReviewRow {
  line: DecklistLine;
  /** Foil used to resolve the line: the line's marker or the import default. */
  foil: boolean;
  result: ImportResolveResult | null;
  error: string | null;
  status: RowStatus;
  include: boolean;
  thresholdCents: number | null;
}

export function proposeThreshold(priceCents: number | null, def: ThresholdDefault): number | null {
  if (def.mode === 'fixed') return def.cents;
  return priceCents === null ? null : percentBelow(priceCents, def.percent);
}

/**
 * One row per resolved line, in list order. Lines are matched by identity with the batch items;
 * lines never reached (batch stopped) are left out.
 */
export function buildReviewRows(
  lines: DecklistLine[],
  outcome: Pick<BatchOutcome<DecklistLine, ImportResolveResult>, 'results' | 'errors'>,
  def: ThresholdDefault,
  defaultFoil: boolean,
): ReviewRow[] {
  const results = new Map(outcome.results.map((r) => [r.item, r.value]));
  const errors = new Map(outcome.errors.map((e) => [e.item, e]));
  const rows: ReviewRow[] = [];
  for (const line of lines) {
    const foil = line.foil || defaultFoil;
    const result = results.get(line);
    if (result) {
      const status: RowStatus = result.alreadyTracked ? 'tracked' : result.priceCents === null ? 'no_offers' : 'ok';
      const thresholdCents = proposeThreshold(result.priceCents, def);
      rows.push({ line, foil, result, error: null, status, thresholdCents, include: status !== 'tracked' && thresholdCents !== null });
      continue;
    }
    const error = errors.get(line);
    if (error) {
      rows.push({
        line,
        foil,
        result: null,
        error: error.message,
        status: error.status === 404 ? 'not_found' : 'error',
        include: false,
        thresholdCents: null,
      });
    }
  }
  return rows;
}

export function canInclude(row: ReviewRow): boolean {
  return row.result !== null && row.thresholdCents !== null && row.thresholdCents > 0;
}

/** Entering a threshold includes the row; clearing it excludes the row. */
export function setRowThreshold(row: ReviewRow, cents: number | null): void {
  row.thresholdCents = cents !== null && cents > 0 ? cents : null;
  row.include = row.thresholdCents !== null && row.result !== null;
}

export function rowsToCreate(rows: ReviewRow[]): ReviewRow[] {
  return rows.filter((r) => r.include && canInclude(r));
}

export function createPayload(
  row: ReviewRow,
  opts: { languages: Language[]; minCondition: Condition; groupId: number | null },
): CardInput {
  return {
    name: row.result!.name,
    expansionIds: row.result!.expansionIds,
    languages: opts.languages,
    minCondition: opts.minCondition,
    foil: row.foil,
    thresholdCents: row.thresholdCents!,
    groupId: opts.groupId,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/import-review.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

`npm run typecheck` green. No commit.

---

### Task 12: Import page

**Files:**
- Create: `web/src/pages/ImportPage.vue`
- Modify: `web/src/router.ts`

**Interfaces:**
- Consumes: `parseDecklist`, `MAX_IMPORT_CARDS` (Task 2), `/api/import/resolve`, `/api/groups`, `/api/cards` (Task 7), `runBatch` (Task 8), everything from `import-review.ts` (Task 11).
- Produces: route `/import`.

- [ ] **Step 1: Route**

`web/src/router.ts`: `import ImportPage from './pages/ImportPage.vue';` and add `{ path: '/import', component: ImportPage },` after the `/` route.

- [ ] **Step 2: `ImportPage.vue`**

```vue
<script setup lang="ts">
import {
  CONDITIONS,
  LANGUAGES,
  LANGUAGE_LABELS,
  MAX_IMPORT_CARDS,
  euroToCents,
  formatEuro,
  parseDecklist,
  type CardGroup,
  type Condition,
  type ImportResolveResult,
  type Language,
  type TrackedCard,
} from '@ctzero/shared';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import ProgressBar from 'primevue/progressbar';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { runBatch } from '../batch-runner';
import {
  buildReviewRows,
  canInclude,
  createPayload,
  rowsToCreate,
  setRowThreshold,
  type ReviewRow,
  type RowStatus,
  type ThresholdDefault,
} from '../import-review';

type Step = 'input' | 'resolving' | 'review' | 'creating' | 'done';

const toast = useToast();
const conditionOptions = [...CONDITIONS];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));
const thresholdModeOptions = [
  { label: '% below current price', value: 'percent' },
  { label: 'Fixed amount', value: 'fixed' },
];
const groupModeOptions = [
  { label: 'New group', value: 'new' },
  { label: 'Existing group', value: 'existing' },
  { label: 'No group', value: 'none' },
];
const STATUS_TAGS: Record<RowStatus, { label: string; severity: 'success' | 'info' | 'warn' | 'danger' }> = {
  ok: { label: 'Ready', severity: 'success' },
  tracked: { label: 'Already tracked', severity: 'info' },
  no_offers: { label: 'No offers', severity: 'warn' },
  not_found: { label: 'Not found', severity: 'danger' },
  error: { label: 'Error', severity: 'danger' },
};

const text = ref('');
const languages = ref<Language[]>([]);
const minCondition = ref<Condition>('Near Mint');
const foil = ref(false);
const respectSet = ref(false);
const thresholdMode = ref<'percent' | 'fixed'>('percent');
const percent = ref<number | null>(10);
const fixedEuro = ref<number | null>(null);
const groupMode = ref<'new' | 'existing' | 'none'>('new');
const newGroupName = ref('');
const existingGroupId = ref<number | null>(null);
const groups = ref<CardGroup[]>([]);

const step = ref<Step>('input');
const progress = ref({ done: 0, total: 0 });
const rows = ref<ReviewRow[]>([]);
const resolveNotice = ref<string | null>(null);
const result = ref<{
  created: number;
  errors: { name: string; message: string }[];
  groupId: number | null;
  notice: string | null;
} | null>(null);
let controller: AbortController | null = null;

const parsed = computed(() => parseDecklist(text.value));
const tooMany = computed(() => parsed.value.lines.length > MAX_IMPORT_CARDS);
const thresholdDefault = computed<ThresholdDefault | null>(() => {
  if (thresholdMode.value === 'percent') {
    return percent.value !== null && percent.value >= 1 && percent.value <= 90 ? { mode: 'percent', percent: percent.value } : null;
  }
  return fixedEuro.value !== null && fixedEuro.value > 0 ? { mode: 'fixed', cents: euroToCents(fixedEuro.value) } : null;
});
const groupError = computed(() => {
  if (groupMode.value === 'new') {
    const name = newGroupName.value.trim();
    if (!name) return 'Enter a name for the new group';
    if (groups.value.some((g) => g.name.toLowerCase() === name.toLowerCase())) return 'A group with this name already exists';
  }
  if (groupMode.value === 'existing' && existingGroupId.value === null) return 'Choose a group';
  return null;
});
const canResolve = computed(
  () => parsed.value.lines.length > 0 && !tooMany.value && thresholdDefault.value !== null && groupError.value === null,
);
const toCreate = computed(() => rowsToCreate(rows.value));
const percentDone = computed(() =>
  progress.value.total === 0 ? 0 : Math.round((progress.value.done / progress.value.total) * 100),
);

onMounted(async () => {
  try {
    groups.value = await api.get<CardGroup[]>('/api/groups');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  }
});

function onProgress(done: number, total: number) {
  progress.value = { done, total };
}

async function resolveLines() {
  const def = thresholdDefault.value;
  if (!def) return;
  const lines = parsed.value.lines;
  const defaultFoil = foil.value;
  controller = new AbortController();
  step.value = 'resolving';
  resolveNotice.value = null;
  const outcome = await runBatch(
    lines,
    (line) =>
      api.post<ImportResolveResult>('/api/import/resolve', {
        name: line.name,
        setCode: line.setCode,
        respectSet: respectSet.value,
        languages: languages.value,
        minCondition: minCondition.value,
        foil: line.foil || defaultFoil,
      }),
    { signal: controller.signal, onProgress },
  );
  controller = null;
  rows.value = buildReviewRows(lines, outcome, def, defaultFoil);
  if (outcome.stopped === 'fatal') resolveNotice.value = `Stopped: ${outcome.fatalMessage}`;
  else if (outcome.stopped === 'aborted') resolveNotice.value = `Stopped: ${lines.length - rows.value.length} cards were not checked.`;
  step.value = 'review';
}

async function confirmImport() {
  const selection = toCreate.value;
  if (selection.length === 0) return;
  step.value = 'creating';
  progress.value = { done: 0, total: selection.length };
  let groupId: number | null = null;
  try {
    if (groupMode.value === 'new') {
      groupId = (await api.post<CardGroup>('/api/groups', { name: newGroupName.value.trim() })).id;
    } else if (groupMode.value === 'existing') {
      groupId = existingGroupId.value;
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Could not create the group', detail: (e as Error).message, life: 6000 });
    step.value = 'review';
    return;
  }
  controller = new AbortController();
  const opts = { languages: languages.value, minCondition: minCondition.value, groupId };
  const outcome = await runBatch(selection, (row) => api.post<TrackedCard>('/api/cards', createPayload(row, opts)), {
    signal: controller.signal,
    onProgress,
  });
  controller = null;
  result.value = {
    created: outcome.results.length,
    errors: outcome.errors.map((e) => ({ name: e.item.result!.name, message: e.message })),
    groupId,
    notice:
      outcome.stopped === 'fatal'
        ? `Stopped: ${outcome.fatalMessage}`
        : outcome.stopped === 'aborted'
          ? 'Stopped before the end.'
          : null,
  };
  step.value = 'done';
}

function abort() {
  controller?.abort();
}

function thresholdEuro(row: ReviewRow): number | null {
  return row.thresholdCents === null ? null : row.thresholdCents / 100;
}

function onThresholdInput(row: ReviewRow, value: number | null) {
  setRowThreshold(row, value === null ? null : euroToCents(value));
}

function startOver() {
  text.value = '';
  rows.value = [];
  result.value = null;
  newGroupName.value = '';
  step.value = 'input';
}
</script>

<template>
  <div class="page-header">
    <h1>Import list</h1>
    <RouterLink to="/"><Button label="Back to cards" icon="pi pi-arrow-left" severity="secondary" text /></RouterLink>
  </div>

  <!-- Step 1: list and options -->
  <section v-if="step === 'input'" class="panel">
    <div class="field">
      <label for="decklist">Decklist</label>
      <Textarea
        id="decklist"
        v-model="text"
        rows="12"
        placeholder="1 Sol Ring (C21) 263&#10;4x Lightning Bolt&#10;Arcane Signet"
        fluid
      />
      <small class="muted">
        One card per line, as exported by Moxfield, Archidekt or MTG Arena. Quantities are ignored.
        {{ parsed.lines.length }} cards<template v-if="parsed.errors.length">, {{ parsed.errors.length }} lines not recognized</template>.
      </small>
      <ul v-if="parsed.errors.length" class="error-list">
        <li v-for="e in parsed.errors" :key="e.lineNo">Line {{ e.lineNo }}: {{ e.text }}</li>
      </ul>
      <Message v-if="tooMany" severity="error">At most {{ MAX_IMPORT_CARDS }} cards per import.</Message>
    </div>

    <div class="options">
      <div>
        <div class="field">
          <label for="imp-languages">Languages</label>
          <MultiSelect
            v-model="languages"
            input-id="imp-languages"
            :options="languageOptions"
            option-label="label"
            option-value="code"
            placeholder="Any language"
            display="chip"
            fluid
          />
        </div>
        <div class="field">
          <label for="imp-condition">Minimum condition</label>
          <Select v-model="minCondition" input-id="imp-condition" :options="conditionOptions" fluid />
        </div>
        <div class="field inline">
          <ToggleSwitch v-model="foil" input-id="imp-foil" />
          <label for="imp-foil">Foil (lines marked *F* are always foil)</label>
        </div>
        <div class="field inline">
          <ToggleSwitch v-model="respectSet" input-id="imp-set" />
          <label for="imp-set">Only the set written in the list</label>
        </div>
      </div>

      <div>
        <div class="field">
          <label>Default threshold</label>
          <SelectButton
            v-model="thresholdMode"
            :options="thresholdModeOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
          />
          <InputNumber v-if="thresholdMode === 'percent'" v-model="percent" suffix=" %" :min="1" :max="90" aria-label="Percent" />
          <InputNumber
            v-else
            v-model="fixedEuro"
            mode="currency"
            currency="EUR"
            locale="en-US"
            :min="0.01"
            aria-label="Threshold"
          />
        </div>
        <div class="field">
          <label>Group</label>
          <SelectButton
            v-model="groupMode"
            :options="groupModeOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
          />
          <InputText v-if="groupMode === 'new'" v-model="newGroupName" placeholder="New group name" fluid />
          <Select
            v-else-if="groupMode === 'existing'"
            v-model="existingGroupId"
            :options="groups"
            option-label="name"
            option-value="id"
            placeholder="Choose a group"
            fluid
          />
          <small v-if="groupError && parsed.lines.length > 0" class="muted">{{ groupError }}</small>
        </div>
      </div>
    </div>

    <Button label="Check prices" icon="pi pi-search" :disabled="!canResolve" @click="resolveLines" />
  </section>

  <!-- Steps 2 and 4: progress -->
  <section v-else-if="step === 'resolving' || step === 'creating'" class="panel">
    <p>{{ step === 'resolving' ? 'Checking cards on CardTrader…' : 'Adding cards…' }} Keep this tab open.</p>
    <ProgressBar :value="percentDone">{{ progress.done }}/{{ progress.total }}</ProgressBar>
    <Button label="Stop" severity="danger" text class="stop" @click="abort" />
  </section>

  <!-- Step 3: review -->
  <section v-else-if="step === 'review'">
    <Message v-if="resolveNotice" severity="warn">{{ resolveNotice }}</Message>
    <div class="review-header">
      <span><strong>{{ toCreate.length }}</strong> of {{ rows.length }} cards will be tracked</span>
      <div class="review-actions">
        <Button label="Back" severity="secondary" text @click="step = 'input'" />
        <Button
          :label="`Track ${toCreate.length} cards`"
          icon="pi pi-check"
          :disabled="toCreate.length === 0"
          @click="confirmImport"
        />
      </div>
    </div>
    <DataTable :value="rows" data-key="line.lineNo" striped-rows>
      <Column header="" style="width: 3rem">
        <template #body="{ data }">
          <Checkbox v-model="data.include" binary :disabled="!canInclude(data)" />
        </template>
      </Column>
      <Column header="" style="width: 64px">
        <template #body="{ data }">
          <img v-if="data.result?.imageUrl" :src="data.result.imageUrl" :alt="data.result.name" class="row-thumb" />
        </template>
      </Column>
      <Column header="Card">
        <template #body="{ data }">
          <strong>{{ data.result?.name ?? data.line.name }}</strong>
          <div class="muted">
            Line {{ data.line.lineNo }}<template v-if="data.foil"> · Foil</template
            ><template v-if="data.line.setCode && respectSet"> · {{ data.line.setCode.toUpperCase() }}</template>
          </div>
        </template>
      </Column>
      <Column header="CT Zero price">
        <template #body="{ data }">
          <template v-if="data.result?.priceCents != null">
            <strong>{{ formatEuro(data.result.priceCents) }}</strong>
            <div v-if="data.result.listing" class="muted">{{ data.result.listing.expansionName }}</div>
          </template>
          <span v-else>—</span>
        </template>
      </Column>
      <Column header="Threshold">
        <template #body="{ data }">
          <InputNumber
            v-if="data.result"
            :model-value="thresholdEuro(data)"
            mode="currency"
            currency="EUR"
            locale="en-US"
            :min="0.01"
            input-class="threshold-input"
            aria-label="Threshold"
            @update:model-value="(v: number | null) => onThresholdInput(data, v)"
          />
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }">
          <Tag
            v-tooltip.top="data.error ?? undefined"
            :value="STATUS_TAGS[data.status as RowStatus].label"
            :severity="STATUS_TAGS[data.status as RowStatus].severity"
          />
        </template>
      </Column>
    </DataTable>
  </section>

  <!-- Step 5: done -->
  <section v-else-if="step === 'done' && result" class="panel">
    <h2>{{ result.created }} cards added</h2>
    <Message v-if="result.notice" severity="warn">{{ result.notice }}</Message>
    <template v-if="result.errors.length">
      <p>{{ result.errors.length }} cards could not be added:</p>
      <ul class="error-list">
        <li v-for="e in result.errors" :key="e.name"><strong>{{ e.name }}</strong>: {{ e.message }}</li>
      </ul>
    </template>
    <div class="review-actions">
      <RouterLink :to="result.groupId !== null ? `/?group=${result.groupId}` : '/'">
        <Button :label="result.groupId !== null ? 'Open the group' : 'Open cards'" icon="pi pi-arrow-right" />
      </RouterLink>
      <Button label="Import another list" severity="secondary" text @click="startOver" />
    </div>
  </section>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.25rem;
}
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1rem;
}
.options .field > .p-inputnumber,
.options .field > .p-inputtext,
.options .field > .p-select {
  margin-top: 0.5rem;
}
.review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.review-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.stop {
  margin-top: 0.75rem;
}
:deep(.threshold-input) {
  width: 7rem;
}
</style>
```

- [ ] **Step 3: Verify**

`npm run typecheck` → PASS. Manual check with dev servers (needs a real `CARDTRADER_TOKEN`):
- Paste:
  ```
  Commander
  1 Sol Ring (C21) 263
  1 Arcane Signet *F*
  1 Notacard Atall
  ```
  → "3 cards". Group = New group "Test import", threshold 10% → "Check prices": progress 0/3 → 3/3.
- Review: Sol Ring "Ready" with threshold = price −10%; Arcane Signet foil; "Notacard Atall" "Not found" with tooltip and disabled checkbox. A card already tracked shows "Already tracked", unchecked.
- A "No offers" row: checkbox disabled; type a threshold → it gets checked.
- "Track N cards" → progress → "N cards added" → "Open the group" opens `/?group=<id>` with exactly those cards.
- Run again with "Stop" pressed during "Checking cards" → review shows only checked rows and the "Stopped: X cards were not checked." notice.
- Try "New group" with an existing name → hint "A group with this name already exists", "Check prices" disabled.

- [ ] **Step 4: Checkpoint**

`npm test` green. No commit.

---

### Task 13: README and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

In `## Usage`, after the Settings bullet, add:

```markdown
- **Groups**: on the Cards page, "Manage groups" creates, renames and deletes groups (deleting a group keeps its cards). Pick a group from the selector to see only its cards with totals; tick cards to change threshold, filters or group, or delete them, all at once.
- **Import list**: "Import list" on the Cards page accepts a pasted decklist (Moxfield, Archidekt, MTG Arena or one name per line, up to 250 cards). Prices are checked one card at a time, then you review thresholds and add the cards to a new group, an existing one or no group. Keep the tab open while it runs.
```

In `## Known limitations`, add:

```markdown
- Bulk filter changes and imports run from the browser one card at a time: closing the tab stops them (what was done stays done).
```

- [ ] **Step 2: Full verification**

Run:
```bash
npm test
npm run typecheck
npm run build
```
Expected: all tests PASS, typecheck clean, web build succeeds.

Then `npm start` on a copy of the real database (`DB_PATH=data/test-copy.db` after `cp data/ctzero.db data/test-copy.db`) and confirm the app starts, migration 3 is applied (existing cards appear under "No group"), and a scheduled/manual sync still completes.

- [ ] **Step 3: Checkpoint**

Report to the user that the branch is ready for their commit. No commit.
