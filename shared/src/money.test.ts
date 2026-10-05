import { describe, expect, it } from 'vitest';
import { euroToCents, formatEuro } from './money';

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
