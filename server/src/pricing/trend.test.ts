import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../db/cards-repo';
import { computeTrend, trendSince } from './trend';

const now = new Date('2026-10-16T09:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const snap = (d: number, priceCents: number | null, configVersion = 1): Snapshot => ({
  configVersion,
  syncedAt: daysAgo(d),
  priceCents,
});

describe('computeTrend', () => {
  it('empty history', () => {
    expect(computeTrend([], 1, now)).toEqual({ sparkline: [], change7dPct: null });
  });

  it('sparkline keeps the last 30 days of the current configuration with a price, oldest first', () => {
    const trend = computeTrend([snap(40, 500), snap(30, 480), snap(20, null), snap(10, 450), snap(5, 400)], 1, now);
    expect(trend.sparkline).toEqual([
      { t: daysAgo(30), priceCents: 480 },
      { t: daysAgo(10), priceCents: 450 },
      { t: daysAgo(5), priceCents: 400 },
    ]);
  });

  it('ignores snapshots of other configurations', () => {
    const trend = computeTrend([snap(20, 100, 1), snap(10, 900, 2), snap(1, 1000, 2)], 2, now);
    expect(trend.sparkline.map((p) => p.priceCents)).toEqual([900, 1000]);
    expect(trend.change7dPct).toBe(11.1);
  });

  it('change compares the latest snapshot with the most recent one at least 7 days old', () => {
    expect(computeTrend([snap(14, 1000), snap(9, 800), snap(3, 700), snap(0, 600)], 1, now).change7dPct).toBe(-25);
  });

  it('a snapshot exactly 7 days old is a valid reference', () => {
    expect(computeTrend([snap(7, 1000), snap(0, 1100)], 1, now).change7dPct).toBe(10);
  });

  it('irregular gaps: the reference can be much older than 7 days', () => {
    expect(computeTrend([snap(25, 1000), snap(1, 900)], 1, now).change7dPct).toBe(-10);
  });

  it('the reference skips snapshots without offers', () => {
    expect(computeTrend([snap(12, 1000), snap(8, null), snap(0, 900)], 1, now).change7dPct).toBe(-10);
  });

  it('null when the current configuration has less than 7 days of history', () => {
    expect(computeTrend([snap(20, 1000, 1), snap(5, 800, 2), snap(0, 700, 2)], 2, now).change7dPct).toBeNull();
  });

  it('null when the latest snapshot is itself older than 7 days (stale data, not a stable price)', () => {
    expect(computeTrend([snap(10, 1000)], 1, now).change7dPct).toBeNull();
    expect(computeTrend([snap(20, 1000), snap(8, 900)], 1, now).change7dPct).toBeNull();
  });

  it('null when the latest snapshot has no offers', () => {
    const trend = computeTrend([snap(10, 1000), snap(0, null)], 1, now);
    expect(trend.change7dPct).toBeNull();
    expect(trend.sparkline).toEqual([{ t: daysAgo(10), priceCents: 1000 }]);
  });

  it('rounds to one decimal and never returns -0', () => {
    expect(computeTrend([snap(8, 300), snap(0, 299)], 1, now).change7dPct).toBe(-0.3);
    // -0.001% rounds to -0: toBe uses Object.is, so this fails on -0.
    expect(computeTrend([snap(8, 100000), snap(0, 99999)], 1, now).change7dPct).toBe(0);
  });
});

describe('trendSince', () => {
  it('is 30 days before now', () => {
    expect(trendSince(now)).toBe(daysAgo(30));
  });
});
