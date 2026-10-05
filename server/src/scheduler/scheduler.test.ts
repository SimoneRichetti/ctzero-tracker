import { DEFAULT_SETTINGS, type SyncRun } from '@ctzero/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { openDb, type Db } from '../db/db';
import { failOrphanRuns, finishRun, getRun, startRun } from '../db/runs-repo';
import { saveSettings } from '../db/settings-repo';
import { Scheduler } from './scheduler';

type Fn = Mock<(...args: any[]) => any>;

const HOUR = 3600 * 1000;
let db: Db;
let listeners: ((run: SyncRun) => void)[];
let sync: { start: Fn; onFinished: Fn };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, 12, 0));
  db = openDb(':memory:');
  listeners = [];
  sync = {
    start: vi.fn(() => ({ started: true, run: {} as SyncRun })),
    onFinished: vi.fn((l: (run: SyncRun) => void) => listeners.push(l)),
  };
});
afterEach(() => vi.useRealTimers());

const make = () => new Scheduler({ db, sync, catchupDelayMs: 30_000 });

function finishedRunAt(d: Date): SyncRun {
  const r = startRun(db, 'scheduled', 0, d);
  finishRun(db, r.id, { status: 'ok' }, d);
  return getRun(db, r.id)!;
}

describe('Scheduler', () => {
  it('al primo avvio fa un recupero dopo 30 secondi', () => {
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 30_000));
    vi.advanceTimersByTime(29_999);
    expect(sync.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sync.start).toHaveBeenCalledWith('catchup');
  });

  it('con un giro recente pianifica il prossimo intervallo', () => {
    finishedRunAt(new Date(Date.now() - HOUR));
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 5 * HOUR));
    vi.advanceTimersByTime(5 * HOUR);
    expect(sync.start).toHaveBeenCalledWith('scheduled');
  });

  it('a fine giro ripianifica dal giro appena concluso', () => {
    const s = make();
    s.start();
    vi.advanceTimersByTime(30_000);
    const run = finishedRunAt(new Date());
    listeners[0]!(run);
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 6 * HOUR));
  });

  it('reschedule applica le nuove impostazioni', () => {
    finishedRunAt(new Date(Date.now() - HOUR));
    const s = make();
    s.start();
    saveSettings(db, { ...DEFAULT_SETTINGS, scheduleMode: 'daily', dailyTime: '13:00' });
    s.reschedule();
    expect(s.getNextRunAt()).toEqual(new Date(2026, 9, 2, 13, 0));
  });

  it('stop annulla il timer', () => {
    const s = make();
    s.start();
    s.stop();
    vi.advanceTimersByTime(24 * HOUR);
    expect(sync.start).not.toHaveBeenCalled();
    expect(s.getNextRunAt()).toBeNull();
  });

  it('un giro orfano non impedisce il recupero all’avvio', () => {
    startRun(db, 'scheduled', 3, new Date(Date.now() - 7 * HOUR));
    failOrphanRuns(db);
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 30_000));
  });

  it('dopo un giro interrotto da poco, l’avvio con catchup forza il recupero', () => {
    startRun(db, 'scheduled', 3, new Date(Date.now() - 2 * 60 * 1000));
    expect(failOrphanRuns(db)).toBe(1);
    const s = make();
    s.start({ catchup: true });
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 30_000));
    vi.advanceTimersByTime(30_000);
    expect(sync.start).toHaveBeenCalledWith('catchup');
  });

  it('un giro fallito adesso non provoca giri a ripetizione', () => {
    const r = startRun(db, 'scheduled', 0, new Date());
    finishRun(db, r.id, { status: 'failed', error: 'HTTP 401' }, new Date());
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 6 * HOUR));
  });
});
