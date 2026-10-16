import type { PricePoint } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import {
  axisBounds,
  buildSeries,
  filterRange,
  formatChange,
  formatDay,
  hasChartData,
  sparklinePoints,
  summarize,
} from './price-history';

const now = new Date('2026-10-16T09:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const ms = (d: number) => Date.parse(daysAgo(d));
const pt = (d: number, priceCents: number | null, configVersion = 1): PricePoint => ({
  syncedAt: daysAgo(d),
  priceCents,
  configVersion,
});

describe('filterRange', () => {
  const points = [pt(100, 1), pt(60, 2), pt(20, 3)];
  it('30d / 90d / all', () => {
    expect(filterRange(points, '30d', now)).toEqual([pt(20, 3)]);
    expect(filterRange(points, '90d', now)).toEqual([pt(60, 2), pt(20, 3)]);
    expect(filterRange(points, 'all', now)).toEqual(points);
  });
});

describe('buildSeries', () => {
  it('breaks the line on no offers and records them', () => {
    expect(buildSeries([pt(3, 100), pt(2, null), pt(1, 120)])).toEqual({
      line: [
        { x: ms(3), y: 100 },
        { x: ms(2), y: null },
        { x: ms(1), y: 120 },
      ],
      filterChanges: [],
      noOffers: [ms(2)],
    });
  });

  it('breaks the line and marks a filter change where configVersion changes', () => {
    expect(buildSeries([pt(3, 100, 1), pt(2, 500, 2), pt(1, 510, 2)])).toEqual({
      line: [
        { x: ms(3), y: 100 },
        { x: ms(2), y: null },
        { x: ms(2), y: 500 },
        { x: ms(1), y: 510 },
      ],
      filterChanges: [ms(2)],
      noOffers: [],
    });
  });

  it('a range starting in the middle of a configuration has no marker at its left edge', () => {
    expect(buildSeries([pt(3, 500, 2), pt(1, 510, 2)]).filterChanges).toEqual([]);
  });
});

describe('summarize', () => {
  it('uses only the current configuration', () => {
    expect(summarize([pt(5, 50, 1), pt(4, 300, 2), pt(3, 200, 2), pt(2, 250, 2)], 2)).toEqual({
      current: 250,
      min: 200,
      max: 300,
    });
  });

  it('current is null when the latest point has no offers; all null without prices', () => {
    expect(summarize([pt(3, 300), pt(2, null)], 1)).toEqual({ current: null, min: 300, max: 300 });
    expect(summarize([pt(2, null)], 1)).toEqual({ current: null, min: null, max: null });
    expect(summarize([], 1)).toEqual({ current: null, min: null, max: null });
  });
});

describe('axisBounds', () => {
  it('covers prices and threshold with 10% padding', () => {
    expect(axisBounds([pt(2, 1000), pt(1, 2000)], 1500)).toEqual({ min: 900, max: 2100 });
  });

  it('keeps a far threshold visible', () => {
    expect(axisBounds([pt(1, 5000)], 100)).toEqual({ min: 0, max: 5490 });
  });

  it('flat prices or no prices at all still get a range', () => {
    expect(axisBounds([pt(2, 1000), pt(1, 1000)], 1000)).toEqual({ min: 950, max: 1050 });
    expect(axisBounds([pt(1, null)], 400)).toEqual({ min: 380, max: 420 });
  });
});

describe('sparklinePoints', () => {
  it('x follows time, y is scaled between min and max with a 1px inset', () => {
    const points = [
      { t: daysAgo(3), priceCents: 100 },
      { t: daysAgo(2), priceCents: 200 },
      { t: daysAgo(0), priceCents: 100 },
    ];
    expect(sparklinePoints(points, 80, 24)).toBe('1,23 27,1 79,23');
  });

  it('a flat price draws a centered flat line', () => {
    const points = [
      { t: daysAgo(1), priceCents: 100 },
      { t: daysAgo(0), priceCents: 100 },
    ];
    expect(sparklinePoints(points, 80, 24)).toBe('1,12 79,12');
  });

  it('fewer than 2 points → empty', () => {
    expect(sparklinePoints([{ t: daysAgo(0), priceCents: 100 }], 80, 24)).toBe('');
  });
});

describe('formatChange', () => {
  it('sign, one decimal and color class', () => {
    expect(formatChange(-12.3)).toEqual({ text: '-12.3%', cls: 'price-down' });
    expect(formatChange(5)).toEqual({ text: '+5.0%', cls: 'price-up' });
    expect(formatChange(0)).toEqual({ text: '0.0%', cls: '' });
    expect(formatChange(null)).toEqual({ text: '—', cls: '' });
  });
});

describe('formatDay', () => {
  it('MM/DD in local time, like the rest of the UI', () => {
    expect(formatDay(new Date(2026, 9, 5, 12).getTime())).toBe('10/05');
  });
});

describe('hasChartData', () => {
  it('a period with only no-offer points still draws the crosses and the threshold', () => {
    expect(hasChartData(buildSeries([pt(2, null), pt(1, null)]))).toBe(true);
    expect(hasChartData(buildSeries([pt(2, 100), pt(1, null)]))).toBe(true);
  });

  it('two priced points draw a line', () => {
    expect(hasChartData(buildSeries([pt(2, 100), pt(1, 120)]))).toBe(true);
  });

  it('nothing to draw: no points or a single price', () => {
    expect(hasChartData(buildSeries([]))).toBe(false);
    expect(hasChartData(buildSeries([pt(1, 100)]))).toBe(false);
  });
});
