import { describe, expect, it, vi } from 'vitest';
import type { CtProduct } from '../clients/cardtrader-types';
import { makeProduct } from '../test-utils';
import { priceSealed } from './sealed-pricer';

const box = { blueprintId: 279368, expansionName: 'Modern Horizons 3' };

function offer(id: number, cents: number, props: Partial<CtProduct['properties_hash']> = {}, hub = true): CtProduct {
  return makeProduct({
    id,
    blueprint_id: 279368,
    hub,
    price: { cents, currency: 'EUR' },
    props: { condition: undefined, mtg_foil: undefined, ...props },
  });
}

describe('priceSealed', () => {
  it('takes the cheapest valid CT Zero listing, without the foil parameter', async () => {
    const ct = {
      products: vi.fn(async (_id: number, _q: { language?: string }) => [
        offer(1, 18000, {}, false),
        offer(2, 21000),
        offer(3, 19500, { mtg_language: 'jp' }),
      ]),
    };
    const result = await priceSealed(ct, box, []);
    expect(result).toEqual({
      status: 'ok',
      priceCents: 19500,
      listing: {
        productId: 3,
        blueprintId: 279368,
        expansionName: 'Modern Horizons 3',
        condition: '',
        language: 'jp',
        foil: false,
        priceCents: 19500,
        url: 'https://www.cardtrader.com/cards/279368',
      },
    });
    expect(ct.products).toHaveBeenCalledTimes(1);
    expect(ct.products.mock.calls[0]).toEqual([279368, { language: undefined }]);
    expect(ct.products.mock.calls[0]![1]).not.toHaveProperty('foil');
  });

  it('a cheaper opened Secret Lair does not win', async () => {
    const ct = {
      products: vi.fn(async (_id: number, _q: { language?: string }) => [
        offer(1, 9000, { sealed: false }),
        offer(2, 12000, { sealed: true }),
      ]),
    };
    await expect(priceSealed(ct, box, [])).resolves.toMatchObject({ status: 'ok', priceCents: 12000 });
  });

  it('one call per selected language', async () => {
    const ct = { products: vi.fn(async (_id: number, _q: { language?: string }): Promise<CtProduct[]> => []) };
    await expect(priceSealed(ct, box, ['en', 'it'])).resolves.toEqual({ status: 'no_offers' });
    expect(ct.products.mock.calls).toEqual([
      [279368, { language: 'en' }],
      [279368, { language: 'it' }],
    ]);
  });
});
