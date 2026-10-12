import { describe, expect, it } from 'vitest';
import { euroToCents, formatEuro, percentBelow } from './money';

describe('formatEuro', () => {
  it('formats cents in US style', () => {
    expect(formatEuro(3850)).toBe('€38.50');
    expect(formatEuro(5)).toBe('€0.05');
    expect(formatEuro(123456)).toBe('€1,234.56');
    expect(formatEuro(123456789)).toBe('€1,234,567.89');
  });

  it('handles negatives', () => {
    expect(formatEuro(-150)).toBe('-€1.50');
  });
});

describe('euroToCents', () => {
  it('rounds to the nearest cent', () => {
    expect(euroToCents(38.5)).toBe(3850);
    expect(euroToCents(0.1 + 0.2)).toBe(30);
    expect(euroToCents(19.999)).toBe(2000);
  });
});

describe('percentBelow', () => {
  it('takes the given percent off and rounds to the cent', () => {
    expect(percentBelow(3800, 10)).toBe(3420);
    expect(percentBelow(999, 15)).toBe(849);
    expect(percentBelow(45, 30)).toBe(32);
  });

  it('never goes below the minimum threshold', () => {
    expect(percentBelow(11, 10)).toBe(11);
    expect(percentBelow(5, 90)).toBe(11);
    expect(percentBelow(20, 30)).toBe(14);
  });
});
