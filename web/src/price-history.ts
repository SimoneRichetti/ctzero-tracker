import type { PricePoint, PriceTrend } from '@ctzero/shared';

export type HistoryRange = '30d' | '90d' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS = { '30d': 30, '90d': 90 } as const;

export function filterRange(points: PricePoint[], range: HistoryRange, now: Date): PricePoint[] {
  if (range === 'all') return points;
  const since = now.getTime() - RANGE_DAYS[range] * DAY_MS;
  return points.filter((p) => Date.parse(p.syncedAt) >= since);
}

export interface ChartSeries {
  /** Price line (x = epoch ms, y = cents); a null y breaks the line. */
  line: { x: number; y: number | null }[];
  /** Times where a new filter configuration starts. */
  filterChanges: number[];
  /** Times of snapshots without offers. */
  noOffers: number[];
}

export function buildSeries(points: PricePoint[]): ChartSeries {
  const series: ChartSeries = { line: [], filterChanges: [], noOffers: [] };
  points.forEach((p, i) => {
    const x = Date.parse(p.syncedAt);
    const prev = points[i - 1];
    if (prev && prev.configVersion !== p.configVersion) {
      series.filterChanges.push(x);
      // The two configurations priced different listings: do not join them.
      series.line.push({ x, y: null });
    }
    if (p.priceCents === null) {
      series.noOffers.push(x);
      series.line.push({ x, y: null });
    } else {
      series.line.push({ x, y: p.priceCents });
    }
  });
  return series;
}

export interface HistoryStats {
  current: number | null;
  min: number | null;
  max: number | null;
}

/** Stats over the current filter configuration only, like the table's trend. */
export function summarize(points: PricePoint[], currentConfigVersion: number): HistoryStats {
  const current = points.filter((p) => p.configVersion === currentConfigVersion);
  const prices = current.flatMap((p) => (p.priceCents === null ? [] : [p.priceCents]));
  return {
    current: current.at(-1)?.priceCents ?? null,
    min: prices.length > 0 ? Math.min(...prices) : null,
    max: prices.length > 0 ? Math.max(...prices) : null,
  };
}

/** Y axis range (cents) covering prices and threshold, padded so the threshold line and no-offer marks stay inside. */
export function axisBounds(points: PricePoint[], thresholdCents: number): { min: number; max: number } {
  const values = [thresholdCents, ...points.flatMap((p) => (p.priceCents === null ? [] : [p.priceCents]))];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.1, hi * 0.05, 1);
  return { min: Math.max(0, Math.floor(lo - pad)), max: Math.ceil(hi + pad) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** SVG polyline `points` for a width×height box (1px inset), x proportional to time. */
export function sparklinePoints(points: PriceTrend['sparkline'], width: number, height: number): string {
  if (points.length < 2) return '';
  const inset = 1;
  const times = points.map((p) => Date.parse(p.t));
  const prices = points.map((p) => p.priceCents);
  const t0 = times[0]!;
  const t1 = times[times.length - 1]!;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return points
    .map((p, i) => {
      const fx = t1 === t0 ? i / (points.length - 1) : (times[i]! - t0) / (t1 - t0);
      const x = inset + fx * (width - 2 * inset);
      const y = hi === lo ? height / 2 : inset + ((hi - p.priceCents) * (height - 2 * inset)) / (hi - lo);
      return `${round1(x)},${round1(y)}`;
    })
    .join(' ');
}

/** Axis label, month first like `formatDateTime` and the rest of the UI. */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
}

/** A line needs two prices; no-offer crosses and the threshold are worth drawing on their own. */
export function hasChartData(series: ChartSeries): boolean {
  return series.line.filter((p) => p.y !== null).length >= 2 || series.noOffers.length > 0;
}
