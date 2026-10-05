import { describe, expect, it } from 'vitest';
import { makeProduct } from '../test-utils';
import { cheapestListing, isValidListing, type ListingFilter } from './listings';

const filter: ListingFilter = { minCondition: 'Near Mint', foil: false, languages: [] };
const names = new Map([[10, 'Modern Horizons 2']]);

describe('isValidListing', () => {
  it("accetta un'inserzione CT Zero valida", () => {
    expect(isValidListing(makeProduct(), filter)).toBe(true);
  });

  it('scarta le inserzioni non CT Zero', () => {
    expect(isValidListing(makeProduct({ hub: false }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ user: undefined }), filter)).toBe(false);
  });

  it('rispetta la condizione minima', () => {
    expect(isValidListing(makeProduct({ props: { condition: 'Mint' } }), filter)).toBe(true);
    expect(isValidListing(makeProduct({ props: { condition: 'Slightly Played' } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { condition: 'Ottima' } }), filter)).toBe(false);
    expect(
      isValidListing(makeProduct({ props: { condition: 'Played' } }), { ...filter, minCondition: 'Played' }),
    ).toBe(true);
  });

  it('rispetta foil', () => {
    expect(isValidListing(makeProduct({ props: { mtg_foil: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { mtg_foil: true } }), { ...filter, foil: true })).toBe(true);
    expect(isValidListing(makeProduct({ props: { mtg_foil: undefined } }), filter)).toBe(true);
  });

  it('filtra per lingua solo se specificata', () => {
    const it_ = { ...filter, languages: ['it' as const] };
    expect(isValidListing(makeProduct({ props: { mtg_language: 'en' } }), it_)).toBe(false);
    expect(isValidListing(makeProduct({ props: { mtg_language: 'it' } }), it_)).toBe(true);
    expect(isValidListing(makeProduct({ props: { mtg_language: 'jp' } }), filter)).toBe(true);
  });

  it('scarta quantità zero, vacanza, alterate, firmate, gradate e valute non EUR', () => {
    expect(isValidListing(makeProduct({ quantity: 0 }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ on_vacation: true }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { altered: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { signed: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ graded: true }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ price: { cents: 100, currency: 'USD' } }), filter)).toBe(false);
  });
});

describe('cheapestListing', () => {
  it('sceglie la più economica tra le valide', () => {
    const products = [
      makeProduct({ id: 1, price: { cents: 900, currency: 'EUR' }, hub: false }),
      makeProduct({ id: 2, price: { cents: 1200, currency: 'EUR' } }),
      makeProduct({ id: 3, price: { cents: 1100, currency: 'EUR' }, props: { mtg_language: 'it' } }),
    ];
    expect(cheapestListing(products, filter, names)).toEqual({
      productId: 3,
      blueprintId: 10,
      expansionName: 'Modern Horizons 2',
      condition: 'Near Mint',
      language: 'it',
      foil: false,
      priceCents: 1100,
      url: 'https://www.cardtrader.com/cards/10',
    });
  });

  it('restituisce null se nessuna inserzione è valida', () => {
    expect(cheapestListing([makeProduct({ hub: false })], filter, names)).toBeNull();
    expect(cheapestListing([], filter, names)).toBeNull();
  });
});
