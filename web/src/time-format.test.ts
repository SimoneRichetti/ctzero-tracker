import { describe, expect, it } from 'vitest';
import { formatAt, formatClock, formatDay, formatWhen } from './time-format';

// Local times, so the tests do not depend on the machine's time zone.
const now = new Date(2026, 9, 16, 15, 30);
const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).toISOString();

describe('time formatting', () => {
  it('clock in 24h', () => {
    expect(formatClock(at(16, 9, 5))).toBe('09:05');
  });

  it('relative day names, then a short date', () => {
    expect(formatDay(at(16, 0, 1), now)).toBe('Today');
    expect(formatDay(at(15, 23, 59), now)).toBe('Yesterday');
    expect(formatDay(at(17, 8, 0), now)).toBe('Tomorrow');
    expect(formatDay(at(12, 8, 0), now)).toBe('Oct 12');
  });

  it('only the clock for today', () => {
    expect(formatWhen(at(16, 14, 2), now)).toBe('14:02');
    expect(formatWhen(at(15, 14, 2), now)).toBe('Yesterday, 14:02');
  });

  it('sentences with a day only when it is not today', () => {
    expect(formatAt('Updated', at(16, 14, 2), now)).toBe('Updated at 14:02');
    expect(formatAt('next', at(17, 9, 0), now)).toBe('next tomorrow at 09:00');
    expect(formatAt('Updated', at(12, 9, 0), now)).toBe('Updated Oct 12 at 09:00');
  });
});
