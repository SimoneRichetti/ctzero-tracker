import { describe, expect, it } from 'vitest';
import { makeProduct } from '../test-utils';
import { cheapestListing, isValidListing, isValidSealedListing, type ListingFilter } from './listings';

const filter: ListingFilter = { minCondition: 'Near Mint', foil: false, languages: [] };
const names = new Map([[10, 'Modern Horizons 2']]);

describe('isValidListing', () => {
  it('accepts a valid CT Zero listing', () => {
    expect(isValidListing(makeProduct(), filter)).toBe(true);
  });

  it('rejects non-CT Zero listings', () => {
    expect(isValidListing(makeProduct({ hub: false }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ user: undefined }), filter)).toBe(false);
  });

  it('respects the minimum condition', () => {
    expect(isValidListing(makeProduct({ props: { condition: 'Mint' } }), filter)).toBe(true);
    expect(isValidListing(makeProduct({ props: { condition: 'Slightly Played' } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { condition: 'Ottima' } }), filter)).toBe(false);
    expect(
      isValidListing(makeProduct({ props: { condition: 'Played' } }), { ...filter, minCondition: 'Played' }),
    ).toBe(true);
  });

  it('respects foil', () => {
    expect(isValidListing(makeProduct({ props: { mtg_foil: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { mtg_foil: true } }), { ...filter, foil: true })).toBe(true);
    expect(isValidListing(makeProduct({ props: { mtg_foil: undefined } }), filter)).toBe(true);
  });

  it('filters by language only when specified', () => {
    const it_ = { ...filter, languages: ['it' as const] };
    expect(isValidListing(makeProduct({ props: { mtg_language: 'en' } }), it_)).toBe(false);
    expect(isValidListing(makeProduct({ props: { mtg_language: 'it' } }), it_)).toBe(true);
    expect(isValidListing(makeProduct({ props: { mtg_language: 'jp' } }), filter)).toBe(true);
  });

  it('rejects zero quantity, on vacation, altered, signed, graded and non-EUR currencies', () => {
    expect(isValidListing(makeProduct({ quantity: 0 }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ on_vacation: true }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { altered: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { signed: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ graded: true }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ price: { cents: 100, currency: 'USD' } }), filter)).toBe(false);
  });
});

describe('cheapestListing', () => {
  it('picks the cheapest among the valid ones', () => {
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

  it('returns null when no listing is valid', () => {
    expect(cheapestListing([makeProduct({ hub: false })], filter, names)).toBeNull();
    expect(cheapestListing([], filter, names)).toBeNull();
  });
});

describe('isValidSealedListing', () => {
  const sealed = (props: Parameters<typeof makeProduct>[0] = {}) =>
    makeProduct({ ...props, props: { condition: undefined, mtg_foil: undefined, ...props.props } });

  it('accepts a CT Zero listing without condition or foil', () => {
    expect(isValidSealedListing(sealed(), [])).toBe(true);
    expect(isValidSealedListing(sealed({ props: { sealed: true } }), [])).toBe(true);
  });

  it('rejects opened products (sealed: false)', () => {
    expect(isValidSealedListing(sealed({ props: { sealed: false } }), [])).toBe(false);
  });

  it('applies the common rules', () => {
    expect(isValidSealedListing(sealed({ hub: false }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ quantity: 0 }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ on_vacation: true }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ graded: true }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ price: { cents: 100, currency: 'USD' } }), [])).toBe(false);
    expect(isValidSealedListing(sealed({ props: { mtg_language: 'jp' } }), ['en'])).toBe(false);
    expect(isValidSealedListing(sealed({ props: { mtg_language: 'jp' } }), ['en', 'jp'])).toBe(true);
  });
});
