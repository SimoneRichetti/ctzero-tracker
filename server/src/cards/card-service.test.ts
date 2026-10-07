import type { CardBlueprint, CardInput } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CardLookup } from '../catalog/catalog';
import { getBlueprints, getCard, listCards, listSnapshots } from '../db/cards-repo';
import { openDb, type Db } from '../db/db';
import { NotFoundError, ValidationError } from '../errors';
import { makeProduct } from '../test-utils';
import { CardService } from './card-service';

const t0 = new Date('2026-10-02T10:00:00.000Z');
const lookup: CardLookup = {
  name: 'Ragavan, Nimble Pilferer',
  oracleId: 'o1',
  imageUrl: 'img',
  printings: [{ expansionId: 1, expansionName: 'MH2', code: 'mh2' }],
  scryfallIdsByExpansion: new Map([[1, new Set(['s1'])]]),
};
const blueprints: CardBlueprint[] = [{ blueprintId: 100, expansionId: 1, expansionName: 'MH2' }];
const input: CardInput = {
  name: 'ragavan',
  expansionIds: [1],
  languages: ['en'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 4000,
};
const { name: _name, ...update } = input;

type Fn = Mock<(...args: any[]) => any>;

let db: Db;
let price: number;
let catalog: { lookup: Fn; resolveBlueprints: Fn };
let ct: { products: Fn };
let service: CardService;

beforeEach(() => {
  db = openDb(':memory:');
  price = 3800;
  catalog = { lookup: vi.fn(async () => lookup), resolveBlueprints: vi.fn(async () => blueprints) };
  ct = {
    products: vi.fn(async (_id: number, q: { foil: boolean }) => [
      makeProduct({ blueprint_id: 100, price: { cents: price, currency: 'EUR' }, props: { mtg_foil: q.foil } }),
    ]),
  };
  service = new CardService({ db, catalog, ct, now: () => t0 });
});

describe('create', () => {
  it('saves, refreshes immediately and evaluates silently (below threshold)', async () => {
    const card = await service.create(input);
    expect(catalog.lookup).toHaveBeenCalledWith('ragavan');
    expect(card).toMatchObject({
      name: 'Ragavan, Nimble Pilferer',
      imageUrl: 'img',
      scryfallOracleId: 'o1',
      lastPriceCents: 3800,
      lastSyncStatus: 'ok',
      alertState: 'below',
      lastNotifiedPriceCents: 3800,
      blueprintsResolvedAt: t0.toISOString(),
      lastSyncedAt: t0.toISOString(),
    });
    expect(card.lastListing?.expansionName).toBe('MH2');
    expect(getBlueprints(db, card.id)).toEqual(blueprints);
    expect(listSnapshots(db, card.id)).toEqual([{ configVersion: 1, syncedAt: t0.toISOString(), priceCents: 3800 }]);
  });

  it('above threshold → above', async () => {
    price = 4500;
    const card = await service.create(input);
    expect(card).toMatchObject({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('if pricing fails the card stays saved with an error', async () => {
    ct.products.mockRejectedValueOnce(new Error('timeout'));
    const card = await service.create(input);
    expect(card).toMatchObject({ lastSyncStatus: 'error', lastError: 'timeout', alertState: null });
    expect(listCards(db)).toHaveLength(1);
  });

  it('without blueprints saves nothing', async () => {
    catalog.resolveBlueprints.mockRejectedValueOnce(new ValidationError('no printings'));
    await expect(service.create(input)).rejects.toBeInstanceOf(ValidationError);
    expect(listCards(db)).toEqual([]);
  });
});

describe('update', () => {
  it('threshold only: no external calls, state recomputed', async () => {
    const card = await service.create(input);
    const updated = await service.update(card.id, { ...update, thresholdCents: 3000 });
    expect(updated).toMatchObject({ thresholdCents: 3000, alertState: 'above', lastNotifiedPriceCents: null, configVersion: 1 });
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
    expect(ct.products).toHaveBeenCalledTimes(1);
  });

  it('same set of languages in a different order does not count as a filter change', async () => {
    const card = await service.create({ ...input, languages: ['en', 'it'] });
    await service.update(card.id, { ...update, languages: ['it', 'en'] });
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
  });

  it('filter change: state reset, new version, blueprints recomputed and new price', async () => {
    const card = await service.create(input);
    price = 5000;
    const updated = await service.update(card.id, { ...update, foil: true });
    expect(catalog.lookup).toHaveBeenLastCalledWith('Ragavan, Nimble Pilferer');
    expect(updated).toMatchObject({ foil: true, configVersion: 2, lastPriceCents: 5000, alertState: 'above' });
    expect(listSnapshots(db, card.id).map((s) => s.configVersion)).toEqual([1, 2]);
  });

  it('filter change without blueprints: the card stays as it was', async () => {
    const card = await service.create(input);
    catalog.resolveBlueprints.mockRejectedValueOnce(new ValidationError('no printings'));
    await expect(service.update(card.id, { ...update, expansionIds: [99] })).rejects.toBeInstanceOf(ValidationError);
    expect(getCard(db, card.id)).toMatchObject({ expansionIds: [1], configVersion: 1, alertState: 'below' });
  });

  it('nonexistent id → NotFoundError', async () => {
    await expect(service.update(999, update)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('changes during the immediate refresh', () => {
  /** Makes the next CardTrader call hang until the returned function is called. */
  function holdNextCall(): (outcome?: Error) => void {
    let release!: (outcome?: Error) => void;
    const gate = new Promise<Error | undefined>((resolve) => (release = resolve));
    const original = ct.products.getMockImplementation()!;
    ct.products.mockImplementationOnce(async (...args: any[]) => {
      const outcome = await gate;
      if (outcome) throw outcome;
      return original(...args);
    });
    return release;
  }

  it('a card deleted while being priced: create still succeeds and nothing is written', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    service.delete(listCards(db)[0]!.id);
    release();
    await expect(pending).resolves.toMatchObject({ name: 'Ragavan, Nimble Pilferer' });
    expect(listCards(db)).toEqual([]);
  });

  it('a card deleted while a failing price call is pending: create still succeeds', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    service.delete(listCards(db)[0]!.id);
    release(new Error('timeout'));
    await expect(pending).resolves.toMatchObject({ name: 'Ragavan, Nimble Pilferer' });
  });

  it('a stale refresh does not overwrite newer filters', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    const id = listCards(db)[0]!.id;
    price = 5000;
    await service.update(id, { ...update, foil: true });
    price = 1000;
    release();
    await pending;
    expect(getCard(db, id)).toMatchObject({ foil: true, configVersion: 2, lastPriceCents: 5000, alertState: 'above' });
    expect(listSnapshots(db, id).map((s) => s.configVersion)).toEqual([2]);
  });

  it('a threshold changed during the refresh is used for the evaluation', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    await service.update(listCards(db)[0]!.id, { ...update, thresholdCents: 3000 });
    release();
    expect(await pending).toMatchObject({ thresholdCents: 3000, lastPriceCents: 3800, alertState: 'above' });
  });
});

describe('delete', () => {
  it('nonexistent id → NotFoundError', () => {
    expect(() => service.delete(999)).toThrow(NotFoundError);
  });
});

describe('preview', () => {
  it('computes price and presets without saving', async () => {
    const result = await service.preview({ name: 'ragavan', expansionIds: [], languages: [], minCondition: 'Near Mint', foil: false });
    expect(result.priceCents).toBe(3800);
    expect(result.blueprintCount).toBe(1);
    expect(result.presets[0]).toEqual({ label: '-10%', cents: 3420 });
    expect(result.listing?.expansionName).toBe('MH2');
    expect(listCards(db)).toEqual([]);
  });
});
