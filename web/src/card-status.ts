import type { CardPurchase, TrackedCard } from '@ctzero/shared';

/** Fields shared by tracked cards and tracked sealed products; only cards can be bought. */
export type PricedItem = Pick<TrackedCard, 'name' | 'thresholdCents' | 'lastPriceCents' | 'lastSyncStatus' | 'alertState'> & {
  purchase?: CardPurchase | null;
};

export type CardStatus = 'below' | 'above' | 'no_offers' | 'error' | 'pending' | 'bought';

/** `tone` picks the colours of StatusPill. */
export const STATUS_META: Record<CardStatus, { label: string; tone: 'accent' | 'neutral' | 'warn' | 'danger' | 'done' }> = {
  below: { label: 'Below target', tone: 'accent' },
  above: { label: 'Watching', tone: 'neutral' },
  no_offers: { label: 'No offers', tone: 'warn' },
  error: { label: 'Update failed', tone: 'danger' },
  pending: { label: 'Pending', tone: 'neutral' },
  bought: { label: 'Bought', tone: 'done' },
};

const ORDER: Record<CardStatus, number> = { below: 0, above: 1, no_offers: 2, pending: 3, error: 4, bought: 5 };

export function cardStatus(c: PricedItem): CardStatus {
  // A bought card is no longer updated: its last price and errors no longer matter.
  if (c.purchase) return 'bought';
  if (c.lastSyncStatus === 'error') return 'error';
  if (c.lastSyncStatus === null) return 'pending';
  if (c.alertState === 'below') return 'below';
  if (c.lastSyncStatus === 'no_offers') return 'no_offers';
  return 'above';
}

/** Price difference in % from the target (negative = below the target). */
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
