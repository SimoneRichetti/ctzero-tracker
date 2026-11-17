import type { CardUpdate, Condition, Language, TrackedCard } from '@ctzero/shared';

/** Fields chosen in the bulk filters dialog; missing ones keep each card's own value. */
export interface FilterChange {
  languages?: Language[];
  minCondition?: Condition;
  foil?: boolean | null;
  /** Expansions to add to / remove from each card's exclusions. */
  excluded?: { mode: 'add' | 'remove'; expansionIds: number[] };
}

/** Exclusions only apply to "any expansion" cards: the others keep theirs (always none). */
function excludedAfter(card: TrackedCard, change: FilterChange['excluded']): number[] {
  const current = card.excludedExpansions.map((e) => e.expansionId);
  if (!change || card.expansionIds.length > 0) return current;
  if (change.mode === 'add') return [...new Set([...current, ...change.expansionIds])];
  return current.filter((id) => !change.expansionIds.includes(id));
}

/** Full update for one card: expansions and threshold are always the card's own; the group is left untouched. */
export function filterUpdate(card: TrackedCard, change: FilterChange): CardUpdate {
  return {
    expansionIds: card.expansionIds,
    excludedExpansionIds: excludedAfter(card, change.excluded),
    languages: change.languages ?? card.languages,
    minCondition: change.minCondition ?? card.minCondition,
    foil: change.foil !== undefined ? change.foil : card.foil,
    thresholdCents: card.thresholdCents,
  };
}
