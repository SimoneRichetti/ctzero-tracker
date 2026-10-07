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
