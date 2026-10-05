import { CONDITIONS, type Condition, type Language, type Listing } from '@ctzero/shared';
import type { CtProduct } from '../clients/cardtrader-types';

export interface ListingFilter {
  minCondition: Condition;
  foil: boolean;
  /** [] = qualsiasi lingua. */
  languages: Language[];
}

/** Indice nella scala delle condizioni (0 = Mint); -1 se sconosciuta. */
function conditionRank(condition: string | undefined): number {
  return CONDITIONS.indexOf(condition as Condition);
}

export function listingUrl(blueprintId: number): string {
  return `https://www.cardtrader.com/cards/${blueprintId}`;
}

export function isValidListing(p: CtProduct, f: ListingFilter): boolean {
  // Regola assoluta: solo inserzioni acquistabili tramite CardTrader Zero.
  if (p.user?.can_sell_via_hub !== true) return false;
  const rank = conditionRank(p.properties_hash.condition);
  if (rank < 0 || rank > conditionRank(f.minCondition)) return false;
  if (Boolean(p.properties_hash.mtg_foil) !== f.foil) return false;
  if (f.languages.length > 0 && !f.languages.includes(p.properties_hash.mtg_language as Language)) return false;
  if (!(p.quantity > 0)) return false;
  if (p.on_vacation) return false;
  if (p.properties_hash.altered || p.properties_hash.signed || p.graded) return false;
  if (p.price.currency !== 'EUR') return false;
  return true;
}

export function cheapestListing(
  products: CtProduct[],
  f: ListingFilter,
  expansionNames: Map<number, string>,
): Listing | null {
  let best: CtProduct | null = null;
  for (const p of products) {
    if (!isValidListing(p, f)) continue;
    if (!best || p.price.cents < best.price.cents) best = p;
  }
  if (!best) return null;
  return {
    productId: best.id,
    blueprintId: best.blueprint_id,
    expansionName: expansionNames.get(best.blueprint_id) ?? '',
    condition: best.properties_hash.condition ?? '',
    language: best.properties_hash.mtg_language ?? '',
    foil: Boolean(best.properties_hash.mtg_foil),
    priceCents: best.price.cents,
    url: listingUrl(best.blueprint_id),
  };
}
