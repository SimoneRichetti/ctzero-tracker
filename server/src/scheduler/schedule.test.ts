import { DEFAULT_SETTINGS, type Settings } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { nextRunAt } from './schedule';

const interval: Settings = { ...DEFAULT_SETTINGS, scheduleMode: 'interval', intervalHours: 6 };
const daily: Settings = { ...DEFAULT_SETTINGS, scheduleMode: 'daily', dailyTime: '09:00' };
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m); // ora locale, ottobre 2026

describe('nextRunAt — intervallo', () => {
  it('senza giri precedenti → subito', () => {
    expect(nextRunAt(null, interval, at(2, 12))).toEqual(at(2, 12));
  });

  it('ultimo giro + N ore', () => {
    expect(nextRunAt(at(2, 10), interval, at(2, 12))).toEqual(at(2, 16));
  });

  it('giro mancato → data nel passato', () => {
    expect(nextRunAt(at(2, 5), interval, at(2, 12)).getTime()).toBeLessThanOrEqual(at(2, 12).getTime());
  });
});

describe('nextRunAt — giornaliero', () => {
  it("prima dell'orario, con il giro di ieri fatto → oggi all'orario", () => {
    expect(nextRunAt(at(1, 9, 5), daily, at(2, 8))).toEqual(at(2, 9));
  });

  it("dopo l'orario, giro di oggi non fatto → dovuto (oggi 09:00)", () => {
    expect(nextRunAt(at(1, 9, 5), daily, at(2, 10))).toEqual(at(2, 9));
  });

  it("dopo l'orario, giro di oggi fatto → domani", () => {
    expect(nextRunAt(at(2, 9, 1), daily, at(2, 10))).toEqual(at(3, 9));
  });

  it('senza giri precedenti → dovuto (ultimo orario passato)', () => {
    expect(nextRunAt(null, daily, at(2, 8))).toEqual(at(1, 9));
  });
});
