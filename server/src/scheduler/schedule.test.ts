import { DEFAULT_SETTINGS, type Settings } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { nextRunAt } from './schedule';

const interval: Settings = { ...DEFAULT_SETTINGS, scheduleMode: 'interval', intervalHours: 6 };
const daily: Settings = { ...DEFAULT_SETTINGS, scheduleMode: 'daily', dailyTime: '09:00' };
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m); // local time, October 2026

describe('nextRunAt — interval', () => {
  it('no previous runs → immediately', () => {
    expect(nextRunAt(null, interval, at(2, 12))).toEqual(at(2, 12));
  });

  it('last run + N hours', () => {
    expect(nextRunAt(at(2, 10), interval, at(2, 12))).toEqual(at(2, 16));
  });

  it('missed run → date in the past', () => {
    expect(nextRunAt(at(2, 5), interval, at(2, 12)).getTime()).toBeLessThanOrEqual(at(2, 12).getTime());
  });
});

describe('nextRunAt — daily', () => {
  it("before the scheduled time, with yesterday's run done → today at the scheduled time", () => {
    expect(nextRunAt(at(1, 9, 5), daily, at(2, 8))).toEqual(at(2, 9));
  });

  it("after the scheduled time, today's run not done → due (today 09:00)", () => {
    expect(nextRunAt(at(1, 9, 5), daily, at(2, 10))).toEqual(at(2, 9));
  });

  it("after the scheduled time, today's run done → tomorrow", () => {
    expect(nextRunAt(at(2, 9, 1), daily, at(2, 10))).toEqual(at(3, 9));
  });

  it('no previous runs → due (last scheduled time passed)', () => {
    expect(nextRunAt(null, daily, at(2, 8))).toEqual(at(1, 9));
  });
});
