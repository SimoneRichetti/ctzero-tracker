import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Listing } from '@ctzero/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors';
import {
  deleteCard,
  getBlueprints,
  getCard,
  insertCard,
  insertSnapshot,
  listCards,
  listSnapshots,
  replaceBlueprints,
  updateCard,
  type NewCard,
} from './cards-repo';
import { MIGRATIONS, openDb, type Db } from './db';
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
});

describe('cards-repo', () => {
  it('insert + get with defaults', () => {
    const card = insertCard(db, newCard, t0);
    expect(card).toMatchObject({
      name: 'Lightning Bolt',
      expansionIds: [1, 2],
      expansionNames: [],
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
