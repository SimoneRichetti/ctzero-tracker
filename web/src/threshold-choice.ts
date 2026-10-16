import { MIN_THRESHOLD_CENTS, euroToCents } from '@ctzero/shared';

/** How a target (threshold) is set for several items at once: below each card's current price, or one amount for all. */
export type ThresholdChoice = { mode: 'percent'; percent: number } | { mode: 'fixed'; cents: number };

export const THRESHOLD_MODE_OPTIONS: { label: string; value: ThresholdChoice['mode'] }[] = [
  { label: '% under current price', value: 'percent' },
  { label: 'Fixed amount', value: 'fixed' },
];

export const MIN_PERCENT = 1;
export const MAX_PERCENT = 90;

/** The choice from the form fields, or null if the value for the selected mode is missing or out of range. */
export function thresholdChoice(mode: 'percent' | 'fixed', percent: number | null, euro: number | null): ThresholdChoice | null {
  if (mode === 'percent') {
    return percent !== null && percent >= MIN_PERCENT && percent <= MAX_PERCENT ? { mode, percent } : null;
  }
  if (euro === null) return null;
  const cents = euroToCents(euro);
  return cents >= MIN_THRESHOLD_CENTS ? { mode, cents } : null;
}
