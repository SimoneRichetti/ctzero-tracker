import type { PriceTrend } from '@ctzero/shared';
import { cardStatus, deltaPercent, sortForDisplay, type CardStatus, type PricedItem } from './card-status';

/** Status filter of the list views. "pending" items only show under "all". */
export type StatusTab = 'all' | 'below' | 'watching' | 'attention';

export const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'below', label: 'Below target' },
  { value: 'watching', label: 'Watching' },
  { value: 'attention', label: 'Needs attention' },
];

export function tabOf(status: CardStatus): Exclude<StatusTab, 'all'> | null {
  if (status === 'below') return 'below';
  if (status === 'above') return 'watching';
  if (status === 'no_offers' || status === 'error') return 'attention';
  return null;
}

export function tabCounts(items: PricedItem[]): Record<StatusTab, number> {
  const counts: Record<StatusTab, number> = { all: items.length, below: 0, watching: 0, attention: 0 };
  for (const item of items) {
    const tab = tabOf(cardStatus(item));
    if (tab) counts[tab]++;
  }
  return counts;
}

export function filterByTab<T extends PricedItem>(items: T[], tab: StatusTab): T[] {
  return tab === 'all' ? items : items.filter((i) => tabOf(cardStatus(i)) === tab);
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Case and accent insensitive substring match; an empty query matches everything. */
export function matchesSearch(name: string, query: string): boolean {
  const q = normalize(query.trim());
  return q === '' || normalize(name).includes(q);
}

export type SortKey = 'status' | 'closest' | 'drop' | 'price' | 'name';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'closest', label: 'Closest to target' },
  { value: 'drop', label: 'Biggest 7-day drop' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' },
];

/** Ascending by `key`, nulls last, ties by name. */
function byNumber<T extends PricedItem>(items: T[], key: (i: T) => number | null): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return ka === kb ? a.name.localeCompare(b.name, 'en') : ka === null ? 1 : -1;
    return ka - kb || a.name.localeCompare(b.name, 'en');
  });
}

export function sortItems<T extends PricedItem & { trend: PriceTrend }>(items: T[], key: SortKey): T[] {
  switch (key) {
    case 'status':
      return sortForDisplay(items);
    case 'closest':
      // Furthest under the target first, then the ones nearest to it.
      return byNumber(items, deltaPercent);
    case 'drop':
      return byNumber(items, (i) => i.trend.change7dPct);
    case 'price':
      // Most expensive first.
      return byNumber(items, (i) => (i.lastPriceCents === null ? null : -i.lastPriceCents));
    case 'name':
      return [...items].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }
}

export function parseTab(raw: unknown): StatusTab {
  return STATUS_TABS.some((t) => t.value === raw) ? (raw as StatusTab) : 'all';
}

export function parseSort(raw: unknown): SortKey {
  return SORT_OPTIONS.some((o) => o.value === raw) ? (raw as SortKey) : 'status';
}
