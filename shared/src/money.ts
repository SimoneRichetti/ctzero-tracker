import { MIN_THRESHOLD_CENTS } from './constants';

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}€${euros}.${rest}`;
}

export function euroToCents(euro: number): number {
  return Math.round(euro * 100);
}

/** Price lowered by `percent`%, rounded to the cent and never below the minimum threshold. */
export function percentBelow(priceCents: number, percent: number): number {
  // Integer arithmetic: `1 - percent / 100` is inexact (0.7 → 0.6999…) and would round half-cents down.
  return Math.max(MIN_THRESHOLD_CENTS, Math.round((priceCents * (100 - percent)) / 100));
}
