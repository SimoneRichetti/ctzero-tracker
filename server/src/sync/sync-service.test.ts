import { DEFAULT_SETTINGS, type CardBlueprint, type SyncTrigger, type TrackedCard } from '@ctzero/shared';
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

async function run(trigger: SyncTrigger = 'manual') {
  const { run: started } = service.start(trigger);
  await service.waitForIdle();
  return getRun(db, started.id)!;
}

describe('SyncService', () => {
  it('notifica le carte scese sotto soglia', async () => {
    const ragavan = addCard('Ragavan', 100, 4000);
    addCard('Bolt', 200, 100);
    prices.set(100, 3800).set(200, 500);
    const result = await run();
    expect(result).toMatchObject({ status: 'ok', cardsDone: 2, cardsError: 0, reportSent: true });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const text = telegram.sendMessage.mock.calls[0]![0] as string;
    expect(text).toContain('Sotto soglia');
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

  it('nessun evento → nessun messaggio', async () => {
    addCard('Bolt', 200, 100);
    prices.set(200, 500);
    expect(await run()).toMatchObject({ status: 'ok', reportSent: false });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('errore su una carta → partial, il giro continua e il report ha la sezione Errori', async () => {
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
    expect(text).toContain('Sotto soglia');
  });

  it('errore 401 → giro fallito, un solo avviso, carte successive non toccate', async () => {
    addCard('A', 100, 4000);
    const b = addCard('B', 200, 100);
    prices.set(100, new HttpError(401, 'HTTP 401 da api.cardtrader.com'));
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('401');
    expect(result.reportSent).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('Aggiornamento prezzi fallito');
    expect(ct.products).toHaveBeenCalledTimes(1);
    expect(getCard(db, b.id)!.lastSyncedAt).toBeNull();
  });

  it('un solo giro alla volta', async () => {
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

  it('una carta eliminata durante il giro viene saltata', async () => {
    addCard('A', 100, 4000);
    const b = addCard('B', 200, 100);
    ct.products.mockImplementationOnce(async () => {
      deleteCard(db, b.id);
      return [];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsDone: 2, cardsError: 0 });
    expect(ct.products).toHaveBeenCalledTimes(1);
  });

  it('una carta eliminata mentre viene prezzata non genera errori', async () => {
    const a = addCard('A', 100, 4000);
    ct.products.mockImplementationOnce(async () => {
      deleteCard(db, a.id);
      return [makeProduct({ blueprint_id: 100, price: { cents: 3000, currency: 'EUR' } })];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsError: 0 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('errore Telegram → reportError salvato, il giro resta ok', async () => {
    addCard('A', 100, 4000);
    prices.set(100, 3000);
    telegram.sendMessage.mockRejectedValueOnce(new Error('Telegram giù'));
    expect(await run()).toMatchObject({ status: 'ok', reportSent: false, reportError: 'Telegram giù' });
  });

  it('ri-risolve i blueprint delle carte "qualsiasi" dopo 7 giorni', async () => {
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

  it('se la ri-risoluzione fallisce usa i blueprint esistenti', async () => {
    const card = addCard('Bolt', 100, 4000, { expansionIds: [] });
    updateCard(db, card.id, { blueprintsResolvedAt: new Date(t0.getTime() - 8 * DAY).toISOString() }, t0);
    catalog.lookup.mockRejectedValueOnce(new HttpError(0, 'Errore di rete verso api.scryfall.com'));
    prices.set(100, 4500);
    expect(await run()).toMatchObject({ status: 'ok' });
    expect(getCard(db, card.id)!.lastPriceCents).toBe(4500);
  });

  it('usa furtherDropPercent dalle impostazioni', async () => {
    saveSettings(db, { ...DEFAULT_SETTINGS, furtherDropPercent: 10 });
    const card = addCard('A', 100, 5000);
    updateCard(db, card.id, { alertState: 'below', lastNotifiedPriceCents: 4000 }, t0);
    prices.set(100, 3700); // -7,5%: sotto il 10%
    await run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    prices.set(100, 3600); // -10%
    await run();
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('Ulteriore calo');
  });

  it('una modifica della soglia durante il prezzaggio non viene sovrascritta', async () => {
    const card = addCard('A', 100, 3000);
    ct.products.mockImplementationOnce(async () => {
      updateCard(db, card.id, { thresholdCents: 4000, alertState: 'below', lastNotifiedPriceCents: 3500 }, t0);
      return [makeProduct({ blueprint_id: 100, price: { cents: 3500, currency: 'EUR' } })];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsError: 0 });
    expect(getCard(db, card.id)).toMatchObject({ thresholdCents: 4000, alertState: 'below', lastNotifiedPriceCents: 3500 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('un cambio filtri durante il prezzaggio scarta il prezzo calcolato con i filtri vecchi', async () => {
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

  it('la ri-risoluzione dei blueprint non sovrascrive un cambio filtri concorrente', async () => {
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

  it('avvisa i listener a fine giro', async () => {
    const listener = vi.fn();
    service.onFinished(listener);
    await run();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });
});
