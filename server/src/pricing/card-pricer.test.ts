import type { CardBlueprint } from '@ctzero/shared';
import { describe, expect, it, vi } from 'vitest';
import type { CtProduct } from '../clients/cardtrader-types';
import { makeProduct } from '../test-utils';
import { priceCard } from './card-pricer';
import type { ListingFilter } from './listings';

const blueprints: CardBlueprint[] = [
  { blueprintId: 100, expansionId: 1, expansionName: 'MH2' },
  { blueprintId: 200, expansionId: 2, expansionName: 'M10' },
];
const anyLang: ListingFilter = { minCondition: 'Near Mint', foil: false, languages: [] };

function fakeCt(byBlueprint: Record<number, CtProduct[]>) {
  return { products: vi.fn(async (id: number) => byBlueprint[id] ?? []) };
}

describe('priceCard', () => {
  it('takes the cheapest across all blueprints', async () => {
    const ct = fakeCt({
      100: [makeProduct({ id: 1, blueprint_id: 100, price: { cents: 1500, currency: 'EUR' } })],
      200: [makeProduct({ id: 2, blueprint_id: 200, price: { cents: 1200, currency: 'EUR' } })],
    });
    const result = await priceCard(ct, blueprints, anyLang);
    expect(result).toMatchObject({ status: 'ok', priceCents: 1200, listing: { productId: 2, expansionName: 'M10' } });
    expect(ct.products).toHaveBeenCalledWith(100, { foil: false, language: undefined });
    expect(ct.products).toHaveBeenCalledTimes(2);
  });

  it('with multiple languages makes one call per language', async () => {
    const ct = fakeCt({});
    await priceCard(ct, blueprints, { ...anyLang, foil: true, languages: ['en', 'it'] });
    expect(ct.products).toHaveBeenCalledTimes(4);
    expect(ct.products).toHaveBeenCalledWith(200, { foil: true, language: 'it' });
  });

  it('no valid listings → no_offers', async () => {
    const ct = fakeCt({ 100: [makeProduct({ blueprint_id: 100, hub: false })] });
    await expect(priceCard(ct, blueprints, anyLang)).resolves.toEqual({ status: 'no_offers' });
  });

  it('without blueprints does not hit the network', async () => {
    const ct = fakeCt({});
    await expect(priceCard(ct, [], anyLang)).resolves.toEqual({ status: 'no_offers' });
    expect(ct.products).not.toHaveBeenCalled();
  });
});
