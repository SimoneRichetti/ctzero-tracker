import { describe, expect, it } from 'vitest';
import { cardNavCounts, countItems } from './nav-summary';

const base = { name: 'x', thresholdCents: 1000, lastPriceCents: 1200, lastSyncStatus: 'ok' as const, alertState: 'above' as const };
const below = { ...base, lastPriceCents: 900, alertState: 'below' as const };

describe('countItems', () => {
  it('counts items and the ones below target', () => {
    expect(countItems([base, below, below])).toEqual({ count: 3, below: 2 });
    expect(countItems([])).toEqual({ count: 0, below: 0 });
  });
});

describe('cardNavCounts', () => {
  it('splits by group, keeps empty groups and counts cards without a group', () => {
    const counts = cardNavCounts(
      [
        { ...below, groupId: 1 },
        { ...base, groupId: 1 },
        { ...below, groupId: null },
      ],
      [1, 2],
    );
    expect(counts.all).toEqual({ count: 3, below: 2 });
    expect(counts.ungrouped).toEqual({ count: 1, below: 1 });
    expect(counts.byGroup.get(1)).toEqual({ count: 2, below: 1 });
    expect(counts.byGroup.get(2)).toEqual({ count: 0, below: 0 });
  });

  it('ignores cards of a group it does not know (stale list)', () => {
    const counts = cardNavCounts([{ ...base, groupId: 9 }], [1]);
    expect(counts.all.count).toBe(1);
    expect(counts.byGroup.get(1)).toEqual({ count: 0, below: 0 });
    expect(counts.ungrouped.count).toBe(0);
  });
});
