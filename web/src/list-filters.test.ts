import type { PriceTrend } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import type { PricedItem } from './card-status';
import { filterByTab, matchesSearch, parseSort, parseTab, sortItems, tabCounts, tabOf } from './list-filters';

type Item = PricedItem & { trend: PriceTrend };

function item(name: string, overrides: Partial<Item> = {}): Item {
  return {
    name,
    thresholdCents: 1000,
    lastPriceCents: 1200,
    lastSyncStatus: 'ok',
    alertState: 'above',
    trend: { sparkline: [], change7dPct: null },
    ...overrides,
  };
}

const below = item('Below', { lastPriceCents: 900, alertState: 'below' });
const above = item('Above');
const noOffers = item('NoOffers', { lastPriceCents: null, lastSyncStatus: 'no_offers' });
const failed = item('Failed', { lastSyncStatus: 'error' });
const pending = item('Pending', { lastSyncStatus: null, lastPriceCents: null, alertState: null });

describe('tabs', () => {
  it('maps every status', () => {
    expect(tabOf('below')).toBe('below');
    expect(tabOf('above')).toBe('watching');
    expect(tabOf('no_offers')).toBe('attention');
    expect(tabOf('error')).toBe('attention');
    expect(tabOf('pending')).toBeNull();
  });

  it('counts, with pending only under all', () => {
    expect(tabCounts([below, above, noOffers, failed, pending])).toEqual({ all: 5, below: 1, watching: 1, attention: 2 });
  });

  it('filters', () => {
    const all = [below, above, noOffers, failed, pending];
    expect(filterByTab(all, 'all')).toHaveLength(5);
    expect(filterByTab(all, 'attention').map((i) => i.name)).toEqual(['NoOffers', 'Failed']);
  });

  it('parses the query, falling back to the defaults', () => {
    expect(parseTab('below')).toBe('below');
    expect(parseTab('junk')).toBe('all');
    expect(parseTab(undefined)).toBe('all');
    expect(parseSort('drop')).toBe('drop');
    expect(parseSort(['drop'])).toBe('status');
  });
});

describe('matchesSearch', () => {
  it('ignores case, accents and surrounding spaces', () => {
    expect(matchesSearch('Séance', 'seance')).toBe(true);
    expect(matchesSearch('Lightning Bolt', '  BOLT ')).toBe(true);
    expect(matchesSearch('Lightning Bolt', 'ring')).toBe(false);
    expect(matchesSearch('Anything', '')).toBe(true);
  });
});

describe('sortItems', () => {
  const a = item('A', { lastPriceCents: 1500, trend: { sparkline: [], change7dPct: 3 } });
  const b = item('B', { lastPriceCents: 800, alertState: 'below', trend: { sparkline: [], change7dPct: -9 } });
  const c = item('C', { lastPriceCents: null, lastSyncStatus: 'no_offers' });
  const d = item('D', { lastPriceCents: 1100, trend: { sparkline: [], change7dPct: -1 } });

  it('status: below first, then by name', () => {
    expect(sortItems([a, c, d, b], 'status').map((i) => i.name)).toEqual(['B', 'A', 'D', 'C']);
  });

  it('closest: furthest under first, no price last', () => {
    expect(sortItems([a, c, d, b], 'closest').map((i) => i.name)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('drop: biggest fall first, unknown last', () => {
    expect(sortItems([a, c, d, b], 'drop').map((i) => i.name)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('price: most expensive first, no price last', () => {
    expect(sortItems([b, c, d, a], 'price').map((i) => i.name)).toEqual(['A', 'D', 'B', 'C']);
  });

  it('name', () => {
    expect(sortItems([d, b, c, a], 'name').map((i) => i.name)).toEqual(['A', 'B', 'C', 'D']);
  });
});
