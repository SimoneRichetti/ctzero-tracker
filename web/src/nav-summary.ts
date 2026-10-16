import { cardStatus, type PricedItem } from './card-status';

export interface NavCount {
  count: number;
  /** Items at or under their target. */
  below: number;
}

export function countItems(items: PricedItem[]): NavCount {
  return { count: items.length, below: items.filter((i) => cardStatus(i) === 'below').length };
}

export interface CardNavCounts {
  all: NavCount;
  ungrouped: NavCount;
  /** Every group id passed in, empty groups included. */
  byGroup: Map<number, NavCount>;
}

/** Counts of the sidebar entries, from the card list already loaded for the pages. */
export function cardNavCounts(cards: (PricedItem & { groupId: number | null })[], groupIds: number[]): CardNavCounts {
  const byGroup = new Map(groupIds.map((id) => [id, { count: 0, below: 0 }]));
  const ungrouped = { count: 0, below: 0 };
  for (const card of cards) {
    const target = card.groupId === null ? ungrouped : byGroup.get(card.groupId);
    if (!target) continue;
    target.count++;
    if (cardStatus(card) === 'below') target.below++;
  }
  return { all: countItems(cards), ungrouped, byGroup };
}
