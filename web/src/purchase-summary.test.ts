import type { PurchaseRecord } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { copiesProgress, filterPurchases, purchaseTotals, purchasesOfView, suggestStopTracking } from './purchase-summary';

function p(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    id: 1,
    kind: 'card',
    itemId: null,
    name: 'x',
    imageUrl: null,
    groupName: null,
    rules: null,
    thresholdCents: null,
    marketPriceCents: null,
    listing: null,
    startPriceCents: null,
    startPriceAt: null,
    pricePaidCents: 100,
    quantity: 1,
    savedCents: null,
    purchasedAt: '',
    ...overrides,
  };
}

describe('purchaseTotals', () => {
  it('sums savings (unknown as 0), spending and copies', () => {
    const items = [p({ savedCents: 300, quantity: 2 }), p({ savedCents: -50, pricePaidCents: 250 }), p({ kind: 'sealed', savedCents: null })];
    expect(purchaseTotals(items)).toEqual({ savedCents: 250, spentCents: 550, copies: 4, count: 3 });
    expect(purchaseTotals([])).toEqual({ savedCents: 0, spentCents: 0, copies: 0, count: 0 });
  });
});

describe('purchasesOfView', () => {
  const items = [p({ id: 1, groupName: 'Pauper' }), p({ id: 2 }), p({ id: 3, kind: 'sealed' })];
  const ids = (list: PurchaseRecord[]) => list.map((i) => i.id);

  it('the home counts every purchase, sealed included', () => {
    expect(ids(purchasesOfView(items, 'card'))).toEqual([1, 2, 3]);
  });

  it('a group counts the cards bought in it, ungrouped the cards bought without one', () => {
    expect(ids(purchasesOfView(items, 'card', 7, 'Pauper'))).toEqual([1]);
    expect(ids(purchasesOfView(items, 'card', 'none'))).toEqual([2]);
    expect(ids(purchasesOfView(items, 'sealed'))).toEqual([3]);
  });
});

describe('filterPurchases', () => {
  it('by kind and by whether the item is still tracked', () => {
    const items = [p({ id: 1, itemId: 5 }), p({ id: 2 }), p({ id: 3, kind: 'sealed', itemId: 6 })];
    expect(filterPurchases(items, 'all', 'any').map((i) => i.id)).toEqual([1, 2, 3]);
    expect(filterPurchases(items, 'card', 'any').map((i) => i.id)).toEqual([1, 2]);
    expect(filterPurchases(items, 'all', 'tracked').map((i) => i.id)).toEqual([1, 3]);
    expect(filterPurchases(items, 'all', 'archived').map((i) => i.id)).toEqual([2]);
  });
});

describe('copies', () => {
  it('progress only when a quantity is set', () => {
    expect(copiesProgress({ quantityNeeded: null, boughtQuantity: 2 })).toBeNull();
    expect(copiesProgress({ quantityNeeded: 4, boughtQuantity: 1 })).toEqual({ text: '1/4', pct: 25, done: false });
    expect(copiesProgress({ quantityNeeded: 3, boughtQuantity: 5 })).toEqual({ text: '5/3', pct: 100, done: true });
  });

  it('stopping the tracking is suggested when the purchase completes the copies, or none are set', () => {
    expect(suggestStopTracking({ quantityNeeded: null, boughtQuantity: 0 }, 1)).toBe(true);
    expect(suggestStopTracking({ quantityNeeded: 4, boughtQuantity: 1 }, 1)).toBe(false);
    expect(suggestStopTracking({ quantityNeeded: 4, boughtQuantity: 1 }, 3)).toBe(true);
  });
});
