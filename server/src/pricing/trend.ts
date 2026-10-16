import type { PriceTrend } from '@ctzero/shared';
import type { Snapshot } from '../db/cards-repo';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SPARKLINE_DAYS = 30;
export const CHANGE_DAYS = 7;

/** Start (ISO) of the window the trend looks at. */
export function trendSince(now: Date): string {
  return new Date(now.getTime() - SPARKLINE_DAYS * DAY_MS).toISOString();
}

/**
 * Trend of one item from its snapshots (oldest first). Only the current filter configuration
 * counts: older configurations priced a different set of listings.
 */
export function computeTrend(snapshots: Snapshot[], currentConfigVersion: number, now: Date): PriceTrend {
  const since = Date.parse(trendSince(now));
  const current = snapshots.filter((s) => s.configVersion === currentConfigVersion && Date.parse(s.syncedAt) >= since);
  const sparkline = current.flatMap((s) => (s.priceCents === null ? [] : [{ t: s.syncedAt, priceCents: s.priceCents }]));
  return { sparkline, change7dPct: changePct(current, now) };
}

function changePct(current: Snapshot[], now: Date): number | null {
  const latest = current.at(-1);
  if (!latest || latest.priceCents === null) return null;
  const refTime = now.getTime() - CHANGE_DAYS * DAY_MS;
  // No recent price (sync failing, app off): a change between two stale prices would read as "stable".
  if (Date.parse(latest.syncedAt) <= refTime) return null;
  const ref = current.findLast((s) => s.priceCents !== null && Date.parse(s.syncedAt) <= refTime);
  if (!ref || ref.priceCents === null) return null;
  const pct = Math.round(((latest.priceCents - ref.priceCents) / ref.priceCents) * 1000) / 10;
  // Math.round(-0.01) is -0, which would print as "-0.0%".
  return pct === 0 ? 0 : pct;
}
