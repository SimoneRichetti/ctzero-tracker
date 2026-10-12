import type { CardUpdate, Condition, Language, TrackedCard } from '@ctzero/shared';

/** Fields chosen in the bulk filters dialog; missing ones keep each card's own value. */
export interface FilterChange {
  languages?: Language[];
  minCondition?: Condition;
  foil?: boolean;
}

/** Full update for one card: expansions and threshold are always the card's own; the group is left untouched. */
export function filterUpdate(card: TrackedCard, change: FilterChange): CardUpdate {
  return {
    expansionIds: card.expansionIds,
    languages: change.languages ?? card.languages,
    minCondition: change.minCondition ?? card.minCondition,
    foil: change.foil ?? card.foil,
    thresholdCents: card.thresholdCents,
  };
}
