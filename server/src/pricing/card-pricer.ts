import type { CardBlueprint, Listing } from '@ctzero/shared';
import type { CardTraderClient } from '../clients/cardtrader';
import type { CtProduct } from '../clients/cardtrader-types';
import { cheapestListing, type ListingFilter } from './listings';

export type PriceResult = { status: 'ok'; priceCents: number; listing: Listing } | { status: 'no_offers' };

export async function priceCard(
  ct: Pick<CardTraderClient, 'products'>,
  blueprints: CardBlueprint[],
  filter: ListingFilter,
): Promise<PriceResult> {
  // Una chiamata per lingua: il marketplace restituisce solo le 25 inserzioni più economiche.
  const languages: (string | undefined)[] = filter.languages.length > 0 ? filter.languages : [undefined];
  const products: CtProduct[] = [];
  for (const bp of blueprints) {
    for (const language of languages) {
      products.push(...(await ct.products(bp.blueprintId, { foil: filter.foil, language })));
    }
  }
  const names = new Map(blueprints.map((b) => [b.blueprintId, b.expansionName]));
  const listing = cheapestListing(products, filter, names);
  return listing ? { status: 'ok', priceCents: listing.priceCents, listing } : { status: 'no_offers' };
}
