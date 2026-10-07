import type { SealedInput, SealedProduct } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HttpError } from '../clients/http';
import { openDb, type Db } from '../db/db';
import { getSealed, listSealedSnapshots } from '../db/sealed-repo';
import { NotFoundError, ValidationError } from '../errors';
import { makeProduct } from '../test-utils';
import { SealedService } from './sealed-service';

const t0 = new Date('2026-10-07T10:00:00.000Z');
const product: SealedProduct = {
  blueprintId: 279368,
  name: 'Modern Horizons 3: Play Booster Box',
  expansionId: 3627,
  expansionName: 'Modern Horizons 3',
  categoryName: 'Booster Box',
  imageUrl: 'img',
};
const input: SealedInput = { blueprintId: 279368, languages: ['en'], thresholdCents: 20000 };

type Fn = Mock<(...args: any[]) => any>;

let db: Db;
let price: number | Error;
let catalog: { sealedProduct: Fn };
let ct: { products: Fn };
let service: SealedService;

beforeEach(() => {
  db = openDb(':memory:');
  price = 19000;
  catalog = { sealedProduct: vi.fn(async () => product) };
  ct = {
    products: vi.fn(async (_id: number, q: { language?: string }) => {
      if (price instanceof Error) throw price;
      const props = { condition: undefined, mtg_foil: undefined, mtg_language: q.language ?? 'en' };
      return [makeProduct({ blueprint_id: 279368, price: { cents: price, currency: 'EUR' }, props })];
    }),
  };
  service = new SealedService({ db, catalog, ct, now: () => t0 });
});

describe('create', () => {
  it('stores catalog data, refreshes immediately and evaluates silently', async () => {
    const s = await service.create(input);
    expect(catalog.sealedProduct).toHaveBeenCalledWith(279368, undefined);
    expect(s).toMatchObject({
      ...product,
      languages: ['en'],
      thresholdCents: 20000,
      lastPriceCents: 19000,
      lastSyncStatus: 'ok',
      alertState: 'below',
      lastNotifiedPriceCents: 19000,
      lastSyncedAt: t0.toISOString(),
    });
    expect(listSealedSnapshots(db, s.id)).toHaveLength(1);
  });

  it('passes the expansion id to the catalog, so products without listings can be tracked', async () => {
    price = new HttpError(500, 'unused');
    ct.products.mockResolvedValue([]);
    const s = await service.create({ ...input, expansionId: 3627 });
    expect(catalog.sealedProduct).toHaveBeenCalledWith(279368, 3627);
    expect(s).toMatchObject({ lastSyncStatus: 'no_offers', lastPriceCents: null, alertState: 'above' });
    await service.preview({ blueprintId: 279368, languages: [], expansionId: 3627 });
    expect(catalog.sealedProduct).toHaveBeenLastCalledWith(279368, 3627);
  });

  it('above threshold → above', async () => {
    price = 25000;
    expect(await service.create(input)).toMatchObject({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('a CardTrader error saves the product in error state', async () => {
    price = new HttpError(500, 'HTTP 500 from api.cardtrader.com');
    expect(await service.create(input)).toMatchObject({ lastSyncStatus: 'error', lastError: 'HTTP 500 from api.cardtrader.com' });
  });

  it('a catalog error saves nothing', async () => {
    catalog.sealedProduct.mockRejectedValueOnce(new ValidationError('not a sealed product'));
    await expect(service.create(input)).rejects.toThrow(ValidationError);
    expect(service.list()).toEqual([]);
  });
});

describe('update', () => {
  it('threshold only: no CardTrader call, silent re-evaluation', async () => {
    const s = await service.create(input);
    ct.products.mockClear();
    const u = await service.update(s.id, { languages: ['en'], thresholdCents: 18000 });
    expect(ct.products).not.toHaveBeenCalled();
    expect(u).toMatchObject({ thresholdCents: 18000, alertState: 'above', configVersion: 1, lastPriceCents: 19000 });
  });

  it('languages changed: bumps config version, resets and refreshes', async () => {
    const s = await service.create(input);
    price = 17000;
    const u = await service.update(s.id, { languages: ['jp'], thresholdCents: 20000 });
    expect(u).toMatchObject({ languages: ['jp'], configVersion: 2, lastPriceCents: 17000, alertState: 'below', lastNotifiedPriceCents: 17000 });
    expect(ct.products).toHaveBeenLastCalledWith(279368, { language: 'jp' });
  });

  it('missing product → NotFoundError', async () => {
    await expect(service.update(99, { languages: [], thresholdCents: 1 })).rejects.toThrow(NotFoundError);
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

  it('a product deleted while being priced: create still succeeds and nothing is written', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    service.delete(service.list()[0]!.id);
    release();
    await expect(pending).resolves.toMatchObject({ name: product.name });
    expect(service.list()).toEqual([]);
  });

  it('a product deleted while a failing price call is pending: create still succeeds', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    service.delete(service.list()[0]!.id);
    release(new HttpError(500, 'HTTP 500'));
    await expect(pending).resolves.toMatchObject({ name: product.name });
  });

  it('a stale refresh does not overwrite a newer configuration', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    const id = service.list()[0]!.id;
    price = 17000;
    await service.update(id, { languages: ['it'], thresholdCents: 20000 });
    price = 25000;
    release();
    await pending;
    expect(getSealed(db, id)).toMatchObject({ languages: ['it'], configVersion: 2, lastPriceCents: 17000, alertState: 'below' });
    expect(listSealedSnapshots(db, id).map((s) => s.configVersion)).toEqual([2]);
  });

  it('a threshold changed during the refresh is used for the evaluation', async () => {
    const release = holdNextCall();
    const pending = service.create(input);
    await vi.waitFor(() => expect(ct.products).toHaveBeenCalled());
    const id = service.list()[0]!.id;
    await service.update(id, { languages: ['en'], thresholdCents: 18000 });
    release();
    expect(await pending).toMatchObject({ thresholdCents: 18000, lastPriceCents: 19000, alertState: 'above' });
  });
});

describe('preview and delete', () => {
  it('preview returns price, listing and presets without saving', async () => {
    const p = await service.preview({ blueprintId: 279368, languages: [] });
    expect(p).toMatchObject({ priceCents: 19000, blueprintCount: 1, listing: { productId: 1 } });
    expect(p.presets.map((x) => x.label)).toEqual(['-10%', '-20%', '-30%', '€1']);
    expect(service.list()).toEqual([]);
  });

  it('delete', async () => {
    const s = await service.create(input);
    service.delete(s.id);
    expect(getSealed(db, s.id)).toBeNull();
    expect(() => service.delete(s.id)).toThrow(NotFoundError);
  });
});
