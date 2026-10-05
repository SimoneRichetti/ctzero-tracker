import type { Preset } from '@ctzero/shared';

const DISCOUNTS = [10, 20, 30];
const ONE_EURO_CENTS = 100;

export function thresholdPresets(priceCents: number | null): Preset[] {
  const oneEuro: Preset = { label: '€1', cents: ONE_EURO_CENTS };
  if (priceCents === null) return [oneEuro];
  const presets: Preset[] = DISCOUNTS.map((d) => ({
    label: `-${d}%`,
    cents: Math.round((priceCents * (100 - d)) / 100),
  }));
  if (priceCents > ONE_EURO_CENTS) presets.push(oneEuro);
  return presets;
}
