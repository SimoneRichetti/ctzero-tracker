import { percentBelow, type Preset } from '@ctzero/shared';

const DISCOUNTS = [10, 20, 30];
const ONE_EURO_CENTS = 100;

/** Presets collapsing onto an earlier one (cheap cards, minimum threshold, a discount landing on €1) are dropped. */
export function thresholdPresets(priceCents: number | null): Preset[] {
  const oneEuro: Preset = { label: '€1', cents: ONE_EURO_CENTS };
  if (priceCents === null) return [oneEuro];
  const presets: Preset[] = [];
  const add = (p: Preset) => {
    if (!presets.some((q) => q.cents === p.cents)) presets.push(p);
  };
  for (const d of DISCOUNTS) add({ label: `-${d}%`, cents: percentBelow(priceCents, d) });
  if (priceCents > ONE_EURO_CENTS) add(oneEuro);
  return presets;
}
