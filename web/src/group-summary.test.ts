import { describe, expect, it } from 'vitest';
import { filterByGroup, groupFilterQuery, parseGroupFilter, summarize } from './group-summary';

describe('parseGroupFilter', () => {
  it('reads all / none / existing ids', () => {
    expect(parseGroupFilter(undefined, [1])).toBe('all');
    expect(parseGroupFilter('none', [1])).toBe('none');
    expect(parseGroupFilter('1', [1])).toBe(1);
  });

  it('falls back to all for stale or junk values', () => {
    expect(parseGroupFilter('7', [1])).toBe('all');
    expect(parseGroupFilter('abc', [1])).toBe('all');
    expect(parseGroupFilter(['1'], [1])).toBe('all');
  });

  it('round-trips through the query', () => {
    expect(groupFilterQuery('all')).toBeUndefined();
    expect(groupFilterQuery('none')).toBe('none');
    expect(groupFilterQuery(3)).toBe('3');
  });
});

describe('filterByGroup', () => {
  const cards = [{ groupId: 1 }, { groupId: null }, { groupId: 2 }];
  it('filters', () => {
    expect(filterByGroup(cards, 'all')).toHaveLength(3);
    expect(filterByGroup(cards, 'none')).toEqual([{ groupId: null }]);
    expect(filterByGroup(cards, 2)).toEqual([{ groupId: 2 }]);
  });
});

describe('summarize', () => {
  const base = { name: 'x', lastSyncStatus: 'ok' as const, alertState: 'above' as const };
  it('counts statuses and sums prices and thresholds', () => {
    const s = summarize([
      { ...base, thresholdCents: 1000, lastPriceCents: 900, alertState: 'below' },
      { ...base, thresholdCents: 500, lastPriceCents: 700 },
      { ...base, thresholdCents: 300, lastPriceCents: null, lastSyncStatus: 'no_offers' },
      { ...base, thresholdCents: 200, lastPriceCents: null, lastSyncStatus: 'error' },
    ]);
    expect(s).toEqual({ count: 4, below: 1, problems: 2, totalPriceCents: 1600, totalThresholdCents: 2000, missingPrice: 2 });
  });

  it('empty', () => {
    expect(summarize([])).toEqual({ count: 0, below: 0, problems: 0, totalPriceCents: 0, totalThresholdCents: 0, missingPrice: 0 });
  });
});
