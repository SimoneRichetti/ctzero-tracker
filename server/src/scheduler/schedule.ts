import type { Settings } from '@ctzero/shared';

const HOUR_MS = 3600 * 1000;

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function slotOn(day: Date, dailyTime: string): Date {
  const [hours, minutes] = dailyTime.split(':').map(Number);
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Next scheduled run. A result ≤ `now` means a run was
 * missed (PC off) and must run immediately.
 */
export function nextRunAt(lastFinishedAt: Date | null, s: Settings, now: Date): Date {
  if (s.scheduleMode === 'interval') {
    return lastFinishedAt ? new Date(lastFinishedAt.getTime() + s.intervalHours * HOUR_MS) : now;
  }
  const today = slotOn(now, s.dailyTime);
  const latestSlot = today.getTime() <= now.getTime() ? today : addDays(today, -1);
  if (!lastFinishedAt || lastFinishedAt.getTime() < latestSlot.getTime()) return latestSlot;
  return addDays(latestSlot, 1);
}
