import { CONDITIONS, type Condition, type Language, type Listing } from '@ctzero/shared';
import type { CtProduct } from '../clients/cardtrader-types';

export interface ListingFilter {
  minCondition: Condition;
  foil: boolean;
  /** [] = any language. */
  languages: Language[];
}

/** Index in the condition scale (0 = Mint); -1 if unknown. */
function conditionRank(condition: string | undefined): number {
  return CONDITIONS.indexOf(condition as Condition);
}

export function listingUrl(blueprintId: number): string {
  return `https://www.cardtrader.com/cards/${blueprintId}`;
}

/** Rules shared by cards and sealed products. */
export function isValidBaseListing(p: CtProduct, languages: Language[]): boolean {
  // Hard rule: only listings purchasable via CardTrader Zero.
  if (p.user?.can_sell_via_hub !== true) return false;
  if (languages.length > 0 && !languages.includes(p.properties_hash.mtg_language as Language)) return false;
  if (!(p.quantity > 0)) return false;
  if (p.on_vacation) return false;
  if (p.properties_hash.altered || p.properties_hash.signed || p.graded) return false;
  if (p.price.currency !== 'EUR') return false;
  return true;
}

export function isValidListing(p: CtProduct, f: ListingFilter): boolean {
  if (!isValidBaseListing(p, f.languages)) return false;
  const rank = conditionRank(p.properties_hash.condition);
  if (rank < 0 || rank > conditionRank(f.minCondition)) return false;
  if (Boolean(p.properties_hash.mtg_foil) !== f.foil) return false;
  return true;
}

/** Sealed products have no condition or foil; opened ones (sealed: false) are excluded. */
export function isValidSealedListing(p: CtProduct, languages: Language[]): boolean {
  return isValidBaseListing(p, languages) && p.properties_hash.sealed !== false;
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
