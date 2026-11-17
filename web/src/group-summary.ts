import { cardStatus, type PricedItem } from './card-status';

/** Group shown in the cards page: every card, cards without a group, or one group. */
export type GroupFilter = 'all' | 'none' | number;

/** Reads a group from the route (`/groups/:id`, or the legacy `?group=`); unknown ids (e.g. a deleted group) and junk fall back to 'all'. */
export function parseGroupFilter(raw: unknown, groupIds: number[]): GroupFilter {
  if (raw === 'none') return 'none';
  if (typeof raw !== 'string') return 'all';
  const id = Number(raw);
  return Number.isInteger(id) && groupIds.includes(id) ? id : 'all';
}

/** Route of a group view. */
export function groupFilterPath(f: GroupFilter): string {
  return f === 'all' ? '/cards' : f === 'none' ? '/cards/ungrouped' : `/groups/${f}`;
}

export function filterByGroup<T extends { groupId: number | null }>(cards: T[], f: GroupFilter): T[] {
  if (f === 'all') return cards;
  if (f === 'none') return cards.filter((c) => c.groupId === null);
  return cards.filter((c) => c.groupId === f);
}

export interface GroupSummary {
  count: number;
  below: number;
  /** No offers or last update failed. */
  problems: number;
  totalPriceCents: number;
  totalThresholdCents: number;
  /** Cards not counted in `totalPriceCents`. */
  missingPrice: number;
}

export function summarize(cards: PricedItem[]): GroupSummary {
  const s: GroupSummary = { count: 0, below: 0, problems: 0, totalPriceCents: 0, totalThresholdCents: 0, missingPrice: 0 };
  for (const c of cards) {
    const status = cardStatus(c);
    s.count++;
    if (status === 'below') s.below++;
    if (status === 'no_offers' || status === 'error') s.problems++;
    if (c.lastPriceCents === null) s.missingPrice++;
    else s.totalPriceCents += c.lastPriceCents;
    s.totalThresholdCents += c.thresholdCents;
  }
  return s;
}
