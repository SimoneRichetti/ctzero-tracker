import type { TrackedCard } from '@ctzero/shared';

export type CardStatus = 'below' | 'above' | 'no_offers' | 'error' | 'pending';

export const STATUS_META: Record<
  CardStatus,
  { label: string; severity: 'success' | 'secondary' | 'warn' | 'danger' | 'info' }
> = {
  below: { label: 'Sotto soglia', severity: 'success' },
  above: { label: 'Sopra soglia', severity: 'secondary' },
  no_offers: { label: 'Nessuna offerta', severity: 'warn' },
  error: { label: 'Errore', severity: 'danger' },
  pending: { label: 'In attesa', severity: 'info' },
};

const ORDER: Record<CardStatus, number> = { below: 0, above: 1, no_offers: 2, pending: 3, error: 4 };

export function cardStatus(c: TrackedCard): CardStatus {
  if (c.lastSyncStatus === 'error') return 'error';
  if (c.lastSyncStatus === null) return 'pending';
  if (c.alertState === 'below') return 'below';
  if (c.lastSyncStatus === 'no_offers') return 'no_offers';
  return 'above';
}

/** Differenza % del prezzo rispetto alla soglia (negativa = sotto soglia). */
export function deltaPercent(c: TrackedCard): number | null {
  if (c.lastPriceCents === null) return null;
  return Math.round(((c.lastPriceCents - c.thresholdCents) / c.thresholdCents) * 1000) / 10;
}

export function sortForDisplay(cards: TrackedCard[]): TrackedCard[] {
  return [...cards].sort(
    (a, b) => ORDER[cardStatus(a)] - ORDER[cardStatus(b)] || a.name.localeCompare(b.name, 'it'),
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
