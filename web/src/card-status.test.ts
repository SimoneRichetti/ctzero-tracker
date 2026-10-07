import type { TrackedCard, TrackedSealed } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { cardStatus, deltaPercent, formatDateTime, sortForDisplay } from './card-status';

function card(overrides: Partial<TrackedCard>): TrackedCard {
  return {
    id: 1,
    name: 'X',
    scryfallOracleId: 'o',
    imageUrl: null,
    expansionIds: [],
    expansionNames: [],
    languages: [],
    minCondition: 'Near Mint',
    foil: false,
    thresholdCents: 1000,
    configVersion: 1,
    lastPriceCents: null,
    lastListing: null,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastError: null,
    alertState: null,
    lastNotifiedPriceCents: null,
    blueprintsResolvedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('cardStatus', () => {
  it('covers all cases', () => {
    expect(cardStatus(card({}))).toBe('pending');
    expect(cardStatus(card({ lastSyncStatus: 'error', alertState: 'below' }))).toBe('error');
    expect(cardStatus(card({ lastSyncStatus: 'ok', alertState: 'below' }))).toBe('below');
    expect(cardStatus(card({ lastSyncStatus: 'no_offers', alertState: 'above' }))).toBe('no_offers');
    expect(cardStatus(card({ lastSyncStatus: 'ok', alertState: 'above' }))).toBe('above');
  });
});

describe('deltaPercent', () => {
  it('percentage difference from the threshold, one decimal', () => {
    expect(deltaPercent(card({ lastPriceCents: 1100 }))).toBe(10);
    expect(deltaPercent(card({ lastPriceCents: 875 }))).toBe(-12.5);
    expect(deltaPercent(card({ lastPriceCents: null }))).toBeNull();
  });
});

describe('sortForDisplay', () => {
  it('below threshold first, then by name', () => {
    const sorted = sortForDisplay([
      card({ id: 1, name: 'Zeta', lastSyncStatus: 'ok', alertState: 'above' }),
      card({ id: 2, name: 'Beta', lastSyncStatus: 'ok', alertState: 'below' }),
      card({ id: 3, name: 'Alfa', lastSyncStatus: 'ok', alertState: 'above' }),
      card({ id: 4, name: 'Gamma', lastSyncStatus: 'error' }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual([2, 3, 1, 4]);
  });
});

describe('formatDateTime', () => {
  it('dash when missing', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('2026-10-02T16:05:00.000Z')).toMatch(/10\/02\/2026/);
  });
});

describe('sealed products', () => {
  it('status, delta and sort work on TrackedSealed too', () => {
    const base: TrackedSealed = {
      id: 1,
      name: 'Box',
      blueprintId: 1,
      expansionId: 1,
      expansionName: 'MH3',
      categoryName: 'Booster Box',
      imageUrl: null,
      languages: [],
      thresholdCents: 20000,
      configVersion: 1,
      lastPriceCents: 19000,
      lastListing: null,
      lastSyncedAt: null,
      lastSyncStatus: 'ok',
      lastError: null,
      alertState: 'below',
      lastNotifiedPriceCents: 19000,
      createdAt: '',
      updatedAt: '',
    };
    const other: TrackedSealed = { ...base, id: 2, name: 'Another', alertState: 'above', lastPriceCents: 25000 };
    expect(cardStatus(base)).toBe('below');
    expect(deltaPercent(base)).toBe(-5);
    const sorted: TrackedSealed[] = sortForDisplay([other, base]);
    expect(sorted.map((s) => s.id)).toEqual([1, 2]);
  });
});
