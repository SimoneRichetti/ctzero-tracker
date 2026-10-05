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
  it('salva, aggiorna subito e valuta in silenzio (sotto soglia)', async () => {
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

  it('sopra soglia → above', async () => {
    price = 4500;
    const card = await service.create(input);
    expect(card).toMatchObject({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('se il prezzo fallisce la carta resta salvata con errore', async () => {
    ct.products.mockRejectedValueOnce(new Error('timeout'));
    const card = await service.create(input);
    expect(card).toMatchObject({ lastSyncStatus: 'error', lastError: 'timeout', alertState: null });
    expect(listCards(db)).toHaveLength(1);
  });

  it('senza blueprint non salva nulla', async () => {
    catalog.resolveBlueprints.mockRejectedValueOnce(new ValidationError('nessuna stampa'));
    await expect(service.create(input)).rejects.toBeInstanceOf(ValidationError);
    expect(listCards(db)).toEqual([]);
  });
});

describe('update', () => {
  it('solo soglia: nessuna chiamata esterna, stato ricalcolato', async () => {
    const card = await service.create(input);
    const updated = await service.update(card.id, { ...update, thresholdCents: 3000 });
    expect(updated).toMatchObject({ thresholdCents: 3000, alertState: 'above', lastNotifiedPriceCents: null, configVersion: 1 });
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
    expect(ct.products).toHaveBeenCalledTimes(1);
  });

  it("lingue nello stesso insieme ma in ordine diverso non contano come cambio filtri", async () => {
    const card = await service.create({ ...input, languages: ['en', 'it'] });
    await service.update(card.id, { ...update, languages: ['it', 'en'] });
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
  });

  it('cambio filtri: reset stato, nuova versione, blueprint ricalcolati e nuovo prezzo', async () => {
    const card = await service.create(input);
    price = 5000;
    const updated = await service.update(card.id, { ...update, foil: true });
    expect(catalog.lookup).toHaveBeenLastCalledWith('Ragavan, Nimble Pilferer');
    expect(updated).toMatchObject({ foil: true, configVersion: 2, lastPriceCents: 5000, alertState: 'above' });
    expect(listSnapshots(db, card.id).map((s) => s.configVersion)).toEqual([1, 2]);
  });

  it('cambio filtri senza blueprint: la carta resta com’era', async () => {
    const card = await service.create(input);
    catalog.resolveBlueprints.mockRejectedValueOnce(new ValidationError('nessuna stampa'));
    await expect(service.update(card.id, { ...update, expansionIds: [99] })).rejects.toBeInstanceOf(ValidationError);
    expect(getCard(db, card.id)).toMatchObject({ expansionIds: [1], configVersion: 1, alertState: 'below' });
  });

  it('id inesistente → NotFoundError', async () => {
    await expect(service.update(999, update)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('delete', () => {
  it('id inesistente → NotFoundError', () => {
    expect(() => service.delete(999)).toThrow(NotFoundError);
  });
});

describe('preview', () => {
  it('calcola prezzo e preset senza salvare', async () => {
    const result = await service.preview({ name: 'ragavan', expansionIds: [], languages: [], minCondition: 'Near Mint', foil: false });
    expect(result.priceCents).toBe(3800);
    expect(result.blueprintCount).toBe(1);
    expect(result.presets[0]).toEqual({ label: '-10%', cents: 3420 });
    expect(result.listing?.expansionName).toBe('MH2');
    expect(listCards(db)).toEqual([]);
  });
});
