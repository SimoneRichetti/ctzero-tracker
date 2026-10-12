import { percentBelow, type Preset } from '@ctzero/shared';

const DISCOUNTS = [10, 20, 30];
const ONE_EURO_CENTS = 100;

/** Discount presets collapsing onto an earlier one (cheap cards, minimum threshold) are dropped. */
export function thresholdPresets(priceCents: number | null): Preset[] {
  const oneEuro: Preset = { label: '€1', cents: ONE_EURO_CENTS };
  if (priceCents === null) return [oneEuro];
  const presets: Preset[] = [];
  for (const d of DISCOUNTS) {
    const cents = percentBelow(priceCents, d);
    if (!presets.some((p) => p.cents === cents)) presets.push({ label: `-${d}%`, cents });
  }
  if (priceCents > ONE_EURO_CENTS) presets.push(oneEuro);
  return presets;
}
