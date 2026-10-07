import type { TrackedCard } from '@ctzero/shared';

/** Fields shared by tracked cards and tracked sealed products. */
export type PricedItem = Pick<TrackedCard, 'name' | 'thresholdCents' | 'lastPriceCents' | 'lastSyncStatus' | 'alertState'>;

export type CardStatus = 'below' | 'above' | 'no_offers' | 'error' | 'pending';

export const STATUS_META: Record<
  CardStatus,
  { label: string; severity: 'success' | 'secondary' | 'warn' | 'danger' | 'info' }
> = {
  below: { label: 'Below threshold', severity: 'success' },
  above: { label: 'Above threshold', severity: 'secondary' },
  no_offers: { label: 'No offers', severity: 'warn' },
  error: { label: 'Error', severity: 'danger' },
  pending: { label: 'Pending', severity: 'info' },
};

const ORDER: Record<CardStatus, number> = { below: 0, above: 1, no_offers: 2, pending: 3, error: 4 };

export function cardStatus(c: PricedItem): CardStatus {
  if (c.lastSyncStatus === 'error') return 'error';
  if (c.lastSyncStatus === null) return 'pending';
  if (c.alertState === 'below') return 'below';
  if (c.lastSyncStatus === 'no_offers') return 'no_offers';
  return 'above';
}

/** Price difference in % from the threshold (negative = below threshold). */
export function deltaPercent(c: PricedItem): number | null {
  if (c.lastPriceCents === null) return null;
  return Math.round(((c.lastPriceCents - c.thresholdCents) / c.thresholdCents) * 1000) / 10;
}

export function sortForDisplay<T extends PricedItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => ORDER[cardStatus(a)] - ORDER[cardStatus(b)] || a.name.localeCompare(b.name, 'en'),
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
