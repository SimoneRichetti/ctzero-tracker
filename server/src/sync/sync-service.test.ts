import { DEFAULT_SETTINGS, type CardBlueprint, type SyncTrigger, type TrackedCard, type TrackedSealed } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CardLookup } from '../catalog/catalog';
import { HttpError } from '../clients/http';
import {
  deleteCard,
  getBlueprints,
  getCard,
  insertCard,
  listSnapshots,
  replaceBlueprints,
  updateCard,
  type NewCard,
} from '../db/cards-repo';
import { openDb, type Db } from '../db/db';
import { getRun } from '../db/runs-repo';
import { deleteSealed, getSealed, insertSealed, listSealedSnapshots, updateSealed } from '../db/sealed-repo';
import { saveSettings } from '../db/settings-repo';
import { makeProduct } from '../test-utils';
import { SyncService } from './sync-service';

type Fn = Mock<(...args: any[]) => any>;

const t0 = new Date('2026-10-02T16:00:00.000Z');
const DAY = 24 * 3600 * 1000;

let db: Db;
let prices: Map<number, number | Error>;
let ct: { products: Fn };
let telegram: { sendMessage: Fn };
let catalog: { lookup: Fn; resolveBlueprints: Fn };
let service: SyncService;

beforeEach(() => {
  db = openDb(':memory:');
  prices = new Map();
  ct = {
    products: vi.fn(async (blueprintId: number) => {
      const p = prices.get(blueprintId);
      if (p instanceof Error) throw p;
      return p === undefined ? [] : [makeProduct({ blueprint_id: blueprintId, price: { cents: p, currency: 'EUR' } })];
    }),
  };
  telegram = { sendMessage: vi.fn(async () => {}) };
  catalog = { lookup: vi.fn(), resolveBlueprints: vi.fn() };
  service = new SyncService({ db, catalog, ct, telegram, now: () => t0 });
});

function addCard(name: string, blueprintId: number, thresholdCents: number, extra: Partial<NewCard> = {}): TrackedCard {
  const card = insertCard(
    db,
    {
      name,
      scryfallOracleId: name,
      imageUrl: null,
      expansionIds: [1],
      languages: [],
      minCondition: 'Near Mint',
      foil: false,
      thresholdCents,
      ...extra,
    },
    t0,
  );
  replaceBlueprints(db, card.id, [{ blueprintId, expansionId: 1, expansionName: 'MH2' }]);
  return updateCard(db, card.id, { blueprintsResolvedAt: t0.toISOString(), alertState: 'above' }, t0);
}

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

async function run(trigger: SyncTrigger = 'manual') {
  const { run: started } = service.start(trigger);
  await service.waitForIdle();
  return getRun(db, started.id)!;
}

describe('SyncService', () => {
  it('notifies cards that dropped below threshold', async () => {
    const ragavan = addCard('Ragavan', 100, 4000);
    addCard('Bolt', 200, 100);
    prices.set(100, 3800).set(200, 500);
    const result = await run();
    expect(result).toMatchObject({ status: 'ok', cardsDone: 2, cardsError: 0, reportSent: true });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const text = telegram.sendMessage.mock.calls[0]![0] as string;
    expect(text).toContain('Below threshold');
    expect(text).toContain('Ragavan');
    expect(text).not.toContain('Bolt');
    expect(getCard(db, ragavan.id)).toMatchObject({
      alertState: 'below',
      lastNotifiedPriceCents: 3800,
      lastPriceCents: 3800,
      lastSyncStatus: 'ok',
      lastSyncedAt: t0.toISOString(),
    });
    expect(listSnapshots(db, ragavan.id)).toHaveLength(1);
    expect(catalog.lookup).not.toHaveBeenCalled();
  });

  it('no events → no message', async () => {
    addCard('Bolt', 200, 100);
    prices.set(200, 500);
    expect(await run()).toMatchObject({ status: 'ok', reportSent: false });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('error on one card → partial, the run continues and the report has the Errors section', async () => {
    const a = addCard('A', 100, 4000);
    addCard('B', 200, 100);
    prices.set(100, new HttpError(500, 'HTTP 500 da api.cardtrader.com')).set(200, 50);
    expect(await run()).toMatchObject({ status: 'partial', cardsDone: 2, cardsError: 1 });
    expect(getCard(db, a.id)).toMatchObject({
      lastSyncStatus: 'error',
      lastError: 'HTTP 500 da api.cardtrader.com',
      alertState: 'above',
    });
    const text = telegram.sendMessage.mock.calls[0]![0] as string;
    expect(text).toContain('❌');
    expect(text).toContain('HTTP 500');
    expect(text).toContain('Below threshold');
  });

  it('401 error → run failed, a single alert, subsequent cards untouched', async () => {
    addCard('A', 100, 4000);
    const b = addCard('B', 200, 100);
    prices.set(100, new HttpError(401, 'HTTP 401 da api.cardtrader.com'));
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('401');
    expect(result.reportSent).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('Price update failed');
    expect(ct.products).toHaveBeenCalledTimes(1);
    expect(getCard(db, b.id)!.lastSyncedAt).toBeNull();
  });

  it('only one run at a time', async () => {
    addCard('A', 100, 4000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    ct.products.mockImplementationOnce(async () => {
      await gate;
      return [];
    });
    const first = service.start('manual');
    const second = service.start('scheduled');
    expect(first.started).toBe(true);
    expect(second).toEqual({ started: false, run: expect.objectContaining({ id: first.run.id }) });
    release();
    await service.waitForIdle();
    expect(getRun(db, first.run.id)!.status).toBe('ok');
  });

  it('a card deleted during the run is skipped', async () => {
    addCard('A', 100, 4000);
    const b = addCard('B', 200, 100);
    ct.products.mockImplementationOnce(async () => {
      deleteCard(db, b.id);
      return [];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsDone: 2, cardsError: 0 });
    expect(ct.products).toHaveBeenCalledTimes(1);
  });

  it('a card deleted while being priced causes no errors', async () => {
    const a = addCard('A', 100, 4000);
    ct.products.mockImplementationOnce(async () => {
      deleteCard(db, a.id);
      return [makeProduct({ blueprint_id: 100, price: { cents: 3000, currency: 'EUR' } })];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsError: 0 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('Telegram error → reportError saved, the run stays ok', async () => {
    addCard('A', 100, 4000);
    prices.set(100, 3000);
    telegram.sendMessage.mockRejectedValueOnce(new Error('Telegram down'));
    expect(await run()).toMatchObject({ status: 'ok', reportSent: false, reportError: 'Telegram down' });
  });

  it('re-resolves blueprints of "any" cards after 7 days', async () => {
    const card = addCard('Bolt', 100, 4000, { expansionIds: [] });
    updateCard(db, card.id, { blueprintsResolvedAt: new Date(t0.getTime() - 8 * DAY).toISOString() }, t0);
    const lookup = { name: 'Bolt' } as CardLookup;
    const fresh: CardBlueprint[] = [{ blueprintId: 300, expansionId: 3, expansionName: 'M10' }];
    catalog.lookup.mockResolvedValueOnce(lookup);
    catalog.resolveBlueprints.mockResolvedValueOnce(fresh);
    prices.set(300, 3000);
    await run();
    expect(catalog.lookup).toHaveBeenCalledWith('Bolt');
    expect(catalog.resolveBlueprints).toHaveBeenCalledWith(lookup, []);
    expect(getBlueprints(db, card.id)).toEqual(fresh);
    expect(getCard(db, card.id)).toMatchObject({ blueprintsResolvedAt: t0.toISOString(), lastPriceCents: 3000 });
  });

  it('if re-resolution fails, uses the existing blueprints', async () => {
    const card = addCard('Bolt', 100, 4000, { expansionIds: [] });
    updateCard(db, card.id, { blueprintsResolvedAt: new Date(t0.getTime() - 8 * DAY).toISOString() }, t0);
    catalog.lookup.mockRejectedValueOnce(new HttpError(0, 'Network error contacting api.scryfall.com'));
    prices.set(100, 4500);
    expect(await run()).toMatchObject({ status: 'ok' });
    expect(getCard(db, card.id)!.lastPriceCents).toBe(4500);
  });

  it('uses furtherDropPercent from settings', async () => {
    saveSettings(db, { ...DEFAULT_SETTINGS, furtherDropPercent: 10 });
    const card = addCard('A', 100, 5000);
    updateCard(db, card.id, { alertState: 'below', lastNotifiedPriceCents: 4000 }, t0);
    prices.set(100, 3700); // -7.5%: below 10%
    await run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    prices.set(100, 3600); // -10%
    await run();
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('Further drop');
  });

  it('a threshold change during pricing is not overwritten', async () => {
    const card = addCard('A', 100, 3000);
    ct.products.mockImplementationOnce(async () => {
      updateCard(db, card.id, { thresholdCents: 4000, alertState: 'below', lastNotifiedPriceCents: 3500 }, t0);
      return [makeProduct({ blueprint_id: 100, price: { cents: 3500, currency: 'EUR' } })];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsError: 0 });
    expect(getCard(db, card.id)).toMatchObject({ thresholdCents: 4000, alertState: 'below', lastNotifiedPriceCents: 3500 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('a filter change during pricing discards the price computed with the old filters', async () => {
    const card = addCard('A', 100, 4000);
    ct.products.mockImplementationOnce(async () => {
      updateCard(db, card.id, { foil: true, configVersion: 2, alertState: null, lastPriceCents: null }, t0);
      return [makeProduct({ blueprint_id: 100, price: { cents: 3000, currency: 'EUR' } })];
    });
    await run();
    expect(getCard(db, card.id)).toMatchObject({ configVersion: 2, lastPriceCents: null, alertState: null });
    expect(listSnapshots(db, card.id)).toEqual([]);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('blueprint re-resolution does not overwrite a concurrent filter change', async () => {
    const card = addCard('Bolt', 100, 4000, { expansionIds: [] });
    updateCard(db, card.id, { blueprintsResolvedAt: new Date(t0.getTime() - 8 * DAY).toISOString() }, t0);
    const userChoice: CardBlueprint[] = [{ blueprintId: 500, expansionId: 5, expansionName: 'Alpha' }];
    catalog.lookup.mockResolvedValueOnce({ name: 'Bolt' } as CardLookup);
    catalog.resolveBlueprints.mockImplementationOnce(async () => {
      replaceBlueprints(db, card.id, userChoice);
      updateCard(db, card.id, { expansionIds: [5], configVersion: 2 }, t0);
      return [{ blueprintId: 300, expansionId: 3, expansionName: 'M10' }];
    });
    await run();
    expect(getBlueprints(db, card.id)).toEqual(userChoice);
    expect(getCard(db, card.id)).toMatchObject({ expansionIds: [5], configVersion: 2 });
  });

  it('notifies listeners at the end of the run', async () => {
    const listener = vi.fn();
    service.onFinished(listener);
    await run();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });
});

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

  it('401 on a sealed product → run failed, only the fatal alert is sent', async () => {
    addCard('A', 100, 4000);
    const box = addSealed('MH3 Play Booster Box', 500, 20000);
    addSealed('Zeta Box', 600, 20000);
    prices.set(100, 3800).set(500, new HttpError(401, 'HTTP 401 from api.cardtrader.com')).set(600, 100);
    const result = await run();
    expect(result).toMatchObject({ status: 'failed', cardsTotal: 3, cardsDone: 1, reportSent: true });
    expect(result.error).toContain('401');
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('Price update failed');
    expect(getSealed(db, box.id)!.lastSyncedAt).toBeNull();
    expect(ct.products).toHaveBeenCalledTimes(2);
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
