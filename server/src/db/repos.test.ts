import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Listing, type TrackedCard } from '@ctzero/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors';
import {
  cardExistsByOracleId,
  deleteCard,
  getBlueprints,
  getCard,
  insertCard,
  insertSnapshot,
  listCards,
  listRecentSnapshotsByCard,
  listSnapshots,
  replaceBlueprints,
  updateCard,
  type NewCard,
} from './cards-repo';
import { MIGRATIONS, openDb, type Db } from './db';
import {
  deletePurchase,
  getPurchaseDetail,
  linkPurchase,
  listPurchases,
  recordPurchase,
  type FrozenItem,
} from './purchases-repo';
import { getSealed } from './sealed-repo';
import {
  failOrphanRuns,
  finishRun,
  getLastFinishedRun,
  getRun,
  getRunningRun,
  startRun,
  updateRunProgress,
} from './runs-repo';
import { getSettings, saveSettings } from './settings-repo';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const t0 = new Date('2026-10-02T10:00:00.000Z');
const t1 = new Date('2026-10-02T11:00:00.000Z');
const t2 = new Date('2026-10-02T12:00:00.000Z');
const newCard: NewCard = {
  name: 'Lightning Bolt',
  scryfallOracleId: 'oid',
  imageUrl: null,
  expansionIds: [1, 2],
  languages: ['en'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 150,
};
const listing: Listing = {
  productId: 1,
  blueprintId: 10,
  expansionName: 'Alpha',
  condition: 'Near Mint',
  language: 'en',
  foil: false,
  priceCents: 120,
  url: 'https://www.cardtrader.com/cards/10',
};

describe('openDb', () => {
  it('applies migrations only once on a file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ctzero-')), 'test.db');
    openDb(path).close();
    const again = openDb(path);
    const { user_version } = again.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(user_version).toBe(MIGRATIONS.length);
    again.close();
  });

  it('makes the foil filter nullable, keeping existing values and related rows', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ctzero-')), 'test.db');
    const old = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 3)) old.exec(m);
    old.exec('PRAGMA user_version = 3');
    old.exec(`INSERT INTO tracked_cards (id, name, scryfall_oracle_id, min_condition, foil, threshold_cents, created_at, updated_at)
      VALUES (1, 'A', 'oa', 'Near Mint', 1, 100, 'x', 'x'), (2, 'B', 'ob', 'Near Mint', 0, 100, 'x', 'x')`);
    old.exec(`INSERT INTO card_blueprints VALUES (1, 10, 5, 'Alpha')`);
    old.close();
    const migrated = openDb(path);
    expect(getCard(migrated, 1)!.foil).toBe(true);
    expect(getCard(migrated, 2)!.foil).toBe(false);
    expect(getBlueprints(migrated, 1)).toHaveLength(1);
    expect(updateCard(migrated, 2, { foil: null }).foil).toBeNull();
    migrated.close();
  });

  it('backfills the start price from the first priced snapshot', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ctzero-')), 'test.db');
    const old = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 4)) old.exec(m);
    old.exec('PRAGMA user_version = 4');
    old.exec(`INSERT INTO tracked_cards (id, name, scryfall_oracle_id, min_condition, foil, threshold_cents, created_at, updated_at)
      VALUES (1, 'A', 'oa', 'Near Mint', 0, 100, 'x', 'x'), (2, 'B', 'ob', 'Near Mint', 0, 100, 'x', 'x')`);
    old.exec(`INSERT INTO price_snapshots (tracked_card_id, config_version, synced_at, price_cents) VALUES
      (1, 1, 't0', NULL), (1, 1, 't1', 500), (1, 2, 't2', 300), (2, 1, 't0', NULL)`);
    old.exec(`INSERT INTO tracked_sealed (id, name, blueprint_id, expansion_id, expansion_name, category_name, threshold_cents, created_at, updated_at)
      VALUES (1, 'Box', 10, 5, 'Alpha', 'Booster Box', 100, 'x', 'x')`);
    old.exec(`INSERT INTO sealed_price_snapshots (tracked_sealed_id, config_version, synced_at, price_cents) VALUES (1, 1, 't3', 9000), (1, 1, 't4', 8000)`);
    old.close();
    const migrated = openDb(path);
    expect(getCard(migrated, 1)).toMatchObject({ startPriceCents: 500, startPriceAt: 't1' });
    expect(getCard(migrated, 2)).toMatchObject({ startPriceCents: null, startPriceAt: null });
    expect(getSealed(migrated, 1)).toMatchObject({ startPriceCents: 9000, startPriceAt: 't3' });
    migrated.close();
  });
});

describe('migration 6', () => {
  it('moves card purchases to the generic purchases table', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ctzero-')), 'test.db');
    const old = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 5)) old.exec(m);
    old.exec('PRAGMA user_version = 5');
    old.exec(`INSERT INTO tracked_cards (id, name, scryfall_oracle_id, min_condition, foil, threshold_cents, start_price_cents, created_at, updated_at)
      VALUES (1, 'A', 'oa', 'Near Mint', 0, 100, 633, 'x', 'x')`);
    old.exec(`INSERT INTO card_purchases (id, tracked_card_id, name, image_url, start_price_cents, price_paid_cents, purchased_at)
      VALUES (1, 1, 'A', 'img', 633, 415, 't1'), (2, NULL, 'Gone', NULL, NULL, 200, 't0')`);
    old.close();
    const migrated = openDb(path);
    expect(listPurchases(migrated).map((p) => [p.kind, p.itemId, p.name, p.savedCents])).toEqual([
      ['card', 1, 'A', 218],
      ['card', null, 'Gone', null],
    ]);
    migrated.close();
  });
});

describe('migration 7', () => {
  it('turns the purchases into frozen copies and tracks the bought items again', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ctzero-')), 'test.db');
    const old = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 6)) old.exec(m);
    old.exec('PRAGMA user_version = 6');
    old.exec(`INSERT INTO card_groups (id, name, created_at) VALUES (1, 'Pauper', 'x')`);
    old.exec(`INSERT INTO tracked_cards (id, name, scryfall_oracle_id, group_id, expansion_ids, languages, min_condition, foil,
        threshold_cents, config_version, last_price_cents, start_price_cents, start_price_at, created_at, updated_at)
      VALUES (1, 'A', 'oa', 1, '[5]', '["en"]', 'Near Mint', 1, 300, 2, 350, 400, 't1', 'x', 'x')`);
    old.exec(`INSERT INTO card_blueprints VALUES (1, 10, 5, 'Alpha')`);
    old.exec(`INSERT INTO price_snapshots (tracked_card_id, config_version, synced_at, price_cents) VALUES
      (1, 1, 't0', 900), (1, 2, 't1', 400), (1, 2, 't2', 350), (1, 2, 't9', 330)`);
    old.exec(`INSERT INTO tracked_sealed (id, name, blueprint_id, expansion_id, expansion_name, category_name, languages,
        threshold_cents, created_at, updated_at) VALUES (1, 'Box', 20, 6, 'Beta', 'Booster Box', '[]', 9000, 'x', 'x')`);
    old.exec(`INSERT INTO purchases (id, kind, tracked_card_id, tracked_sealed_id, name, image_url, start_price_cents, price_paid_cents, purchased_at)
      VALUES (1, 'card', 1, NULL, 'A', 'img', 400, 350, 't5'), (2, 'sealed', NULL, 1, 'Box', NULL, NULL, 8500, 't6'),
             (3, 'card', NULL, NULL, 'Gone', NULL, NULL, 200, 't0')`);
    old.close();

    const migrated = openDb(path);
    expect(getPurchaseDetail(migrated, 1)).toMatchObject({
      itemId: 1,
      groupName: 'Pauper',
      rules: { kind: 'card', expansionIds: [5], expansionNames: ['Alpha'], languages: ['en'], minCondition: 'Near Mint', foil: true },
      thresholdCents: 300,
      marketPriceCents: 350,
      startPriceCents: 400,
      startPriceAt: 't1',
      quantity: 1,
      savedCents: 50,
      // Only the current configuration, up to the purchase.
      points: [
        { syncedAt: 't1', priceCents: 400 },
        { syncedAt: 't2', priceCents: 350 },
      ],
    });
    expect(getPurchaseDetail(migrated, 2)).toMatchObject({
      itemId: 1,
      rules: { kind: 'sealed', blueprintId: 20, expansionId: 6, expansionName: 'Beta', categoryName: 'Booster Box', languages: [] },
      points: [],
    });
    expect(getPurchaseDetail(migrated, 3)).toMatchObject({ itemId: null, rules: null, points: [] });
    expect(getCard(migrated, 1)).toMatchObject({ boughtQuantity: 1, quantityNeeded: null, startPriceCents: 400 });
    expect(getSealed(migrated, 1)).toMatchObject({ boughtQuantity: 1, quantityNeeded: null });
    migrated.close();
  });
});

describe('start price and purchases', () => {
  const frozen = (card: TrackedCard): FrozenItem => ({
    ...card,
    groupName: null,
    rules: { kind: 'card', expansionIds: [], expansionNames: [], languages: [], minCondition: 'Near Mint', foil: null },
  });

  it('the first priced snapshot sets the start price, later ones do not change it', () => {
    const card = insertCard(db, newCard, t0);
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: null });
    expect(getCard(db, card.id)!.startPriceCents).toBeNull();
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: t1.toISOString(), priceCents: 400 });
    insertSnapshot(db, { cardId: card.id, configVersion: 2, syncedAt: t2.toISOString(), priceCents: 250 });
    expect(getCard(db, card.id)).toMatchObject({ startPriceCents: 400, startPriceAt: t1.toISOString() });
  });

  it('a purchase freezes the item and its history so far; several add up on the item', () => {
    const card = insertCard(db, newCard, t0);
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 400 });
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: t1.toISOString(), priceCents: 350 });
    const first = recordPurchase(db, 'card', frozen(getCard(db, card.id)!), { pricePaidCents: 300, quantity: 2 }, t1);
    insertSnapshot(db, { cardId: card.id, configVersion: 1, syncedAt: t2.toISOString(), priceCents: 320 });
    recordPurchase(db, 'card', frozen(getCard(db, card.id)!), { pricePaidCents: 450, quantity: 1 }, t2);

    expect(getPurchaseDetail(db, first.id)).toMatchObject({
      itemId: card.id,
      startPriceCents: 400,
      pricePaidCents: 300,
      quantity: 2,
      savedCents: 200,
      points: [
        { syncedAt: t0.toISOString(), priceCents: 400 },
        { syncedAt: t1.toISOString(), priceCents: 350 },
      ],
    });
    expect(getCard(db, card.id)!.boughtQuantity).toBe(3);
    expect(listCards(db)[0]!.boughtQuantity).toBe(3);
    expect(listPurchases(db).map((p) => p.savedCents)).toEqual([-50, 200]);

    deleteCard(db, card.id);
    expect(listPurchases(db).map((p) => p.itemId)).toEqual([null, null]);
    expect(getPurchaseDetail(db, first.id)!.points).toHaveLength(2);
  });

  it('a card never priced has an unknown saving; deleting a purchase removes its history', () => {
    const card = insertCard(db, newCard, t0);
    const p = recordPurchase(db, 'card', frozen(card), { pricePaidCents: 300, quantity: 1 }, t1);
    expect(p).toMatchObject({ startPriceCents: null, savedCents: null });
    expect(deletePurchase(db, p.id)).toBe(true);
    expect(deletePurchase(db, p.id)).toBe(false);
    expect(getCard(db, card.id)!.boughtQuantity).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchase_snapshots').get()).toEqual({ n: 0 });
  });

  it('only an archived purchase can be linked to a new item', () => {
    const card = insertCard(db, newCard, t0);
    const p = recordPurchase(db, 'card', frozen(card), { pricePaidCents: 300, quantity: 1 }, t1);
    const other = insertCard(db, { ...newCard, scryfallOracleId: 'o2' }, t0);
    expect(linkPurchase(db, p.id, 'card', other.id)).toBe(false);
    deleteCard(db, card.id);
    expect(linkPurchase(db, p.id, 'card', other.id)).toBe(true);
    expect(getCard(db, other.id)!.boughtQuantity).toBe(1);
  });
});

describe('cards-repo', () => {
  it('insert + get with defaults', () => {
    const card = insertCard(db, newCard, t0);
    expect(card).toMatchObject({
      name: 'Lightning Bolt',
      expansionIds: [1, 2],
      expansionNames: [],
      excludedExpansions: [],
      languages: ['en'],
      foil: false,
      configVersion: 1,
      lastPriceCents: null,
      lastListing: null,
      alertState: null,
      createdAt: t0.toISOString(),
      updatedAt: t0.toISOString(),
    });
    expect(getCard(db, card.id)).toEqual(card);
  });

  it('updateCard updates only the given fields and accepts null', () => {
    const { id } = insertCard(db, newCard, t0);
    const updated = updateCard(db, id, { lastPriceCents: 120, lastListing: listing, alertState: 'below', foil: true }, t1);
    expect(updated).toMatchObject({ lastPriceCents: 120, lastListing: listing, alertState: 'below', foil: true });
    expect(updated.updatedAt).toBe(t1.toISOString());
    const cleared = updateCard(db, id, { lastPriceCents: null }, t2);
    expect(cleared.lastPriceCents).toBeNull();
    expect(cleared.alertState).toBe('below');
  });

  it('stores foil = null (any finish)', () => {
    const card = insertCard(db, { ...newCard, foil: null }, t0);
    expect(getCard(db, card.id)!.foil).toBeNull();
  });

  it('updateCard on a nonexistent id throws NotFoundError', () => {
    expect(() => updateCard(db, 999, { thresholdCents: 1 })).toThrow(NotFoundError);
  });

  it('replaceBlueprints replaces and populates expansionNames', () => {
    const { id } = insertCard(db, newCard, t0);
    replaceBlueprints(db, id, [
      { blueprintId: 10, expansionId: 1, expansionName: 'Alpha' },
      { blueprintId: 11, expansionId: 1, expansionName: 'Alpha' },
      { blueprintId: 12, expansionId: 2, expansionName: 'Beta' },
    ]);
    expect(getBlueprints(db, id)).toHaveLength(3);
    expect(getCard(db, id)!.expansionNames).toEqual(['Alpha', 'Beta']);
    replaceBlueprints(db, id, [{ blueprintId: 12, expansionId: 2, expansionName: 'Beta' }]);
    expect(getBlueprints(db, id)).toEqual([{ blueprintId: 12, expansionId: 2, expansionName: 'Beta' }]);
  });

  it('expansionNames is empty for cards with "any" expansion', () => {
    const { id } = insertCard(db, { ...newCard, expansionIds: [] }, t0);
    replaceBlueprints(db, id, [{ blueprintId: 10, expansionId: 1, expansionName: 'Alpha' }]);
    expect(getCard(db, id)!.expansionNames).toEqual([]);
  });

  it('deleteCard cascades to blueprints and snapshots', () => {
    const { id } = insertCard(db, newCard, t0);
    replaceBlueprints(db, id, [{ blueprintId: 10, expansionId: 1, expansionName: 'Alpha' }]);
    insertSnapshot(db, { cardId: id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 100 });
    expect(deleteCard(db, id)).toBe(true);
    expect(getCard(db, id)).toBeNull();
    expect(getBlueprints(db, id)).toEqual([]);
    expect(listSnapshots(db, id)).toEqual([]);
    expect(deleteCard(db, id)).toBe(false);
  });

  it('listCards sorts by name', () => {
    insertCard(db, { ...newCard, name: 'Zur' }, t0);
    insertCard(db, { ...newCard, name: 'Abrade' }, t0);
    expect(listCards(db).map((c) => c.name)).toEqual(['Abrade', 'Zur']);
  });

  it('snapshot with null price', () => {
    const { id } = insertCard(db, newCard, t0);
    insertSnapshot(db, { cardId: id, configVersion: 2, syncedAt: t0.toISOString(), priceCents: null });
    expect(listSnapshots(db, id)).toEqual([{ configVersion: 2, syncedAt: t0.toISOString(), priceCents: null }]);
  });

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

  it('cardExistsByOracleId', () => {
    expect(cardExistsByOracleId(db, 'oid')).toBe(false);
    insertCard(db, newCard, t0);
    expect(cardExistsByOracleId(db, 'oid')).toBe(true);
  });
});

describe('runs-repo', () => {
  it('run lifecycle', () => {
    const run = startRun(db, 'manual', 3, t0);
    expect(run).toMatchObject({ trigger: 'manual', status: 'running', cardsTotal: 3, cardsDone: 0, finishedAt: null });
    expect(getRunningRun(db)?.id).toBe(run.id);
    updateRunProgress(db, run.id, 2, 1);
    finishRun(db, run.id, { status: 'partial', reportSent: true }, t1);
    expect(getRun(db, run.id)).toMatchObject({
      status: 'partial',
      cardsDone: 2,
      cardsError: 1,
      reportSent: true,
      reportError: null,
      finishedAt: t1.toISOString(),
    });
    expect(getRunningRun(db)).toBeNull();
    expect(getLastFinishedRun(db)?.id).toBe(run.id);
  });

  it('failOrphanRuns closes interrupted runs with finished_at = started_at', () => {
    const run = startRun(db, 'scheduled', 1, t0);
    expect(failOrphanRuns(db)).toBe(1);
    const orphan = getRun(db, run.id)!;
    expect(orphan.status).toBe('failed');
    expect(orphan.finishedAt).toBe(t0.toISOString());
    expect(orphan.error).toContain('Interrupted');
  });

  it('getLastFinishedRun takes the most recent, whatever the outcome', () => {
    const a = startRun(db, 'manual', 0, t0);
    finishRun(db, a.id, { status: 'failed', error: 'x' }, t2);
    const b = startRun(db, 'manual', 0, t0);
    finishRun(db, b.id, { status: 'ok' }, t1);
    expect(getLastFinishedRun(db)?.id).toBe(a.id);
  });
});

describe('settings-repo', () => {
  it('returns defaults when empty', () => {
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('save + get', () => {
    const s = { ...DEFAULT_SETTINGS, scheduleMode: 'daily' as const, dailyTime: '07:30' };
    saveSettings(db, s);
    expect(getSettings(db)).toEqual(s);
  });

  it('corrupted values → defaults', () => {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('intervalHours', '"abc"')`).run();
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
