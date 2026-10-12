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
