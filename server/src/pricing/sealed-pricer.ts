import type { Language, SealedProduct } from '@ctzero/shared';
import type { CardTraderClient } from '../clients/cardtrader';
import type { CtProduct } from '../clients/cardtrader-types';
import type { PriceResult } from './card-pricer';
import { isValidSealedListing, listingUrl } from './listings';

export async function priceSealed(
  ct: Pick<CardTraderClient, 'products'>,
  product: Pick<SealedProduct, 'blueprintId' | 'expansionName'>,
  languages: Language[],
): Promise<PriceResult> {
  // One call per language: the marketplace returns only the 25 cheapest listings.
  const queries: (Language | undefined)[] = languages.length > 0 ? languages : [undefined];
  let best: CtProduct | null = null;
  for (const language of queries) {
    for (const p of await ct.products(product.blueprintId, { language })) {
      if (!isValidSealedListing(p, languages)) continue;
      if (!best || p.price.cents < best.price.cents) best = p;
    }
  }
  if (!best) return { status: 'no_offers' };
  return {
    status: 'ok',
    priceCents: best.price.cents,
    listing: {
      productId: best.id,
      blueprintId: best.blueprint_id,
      expansionName: product.expansionName,
      condition: '',
      language: best.properties_hash.mtg_language ?? '',
      foil: false,
      priceCents: best.price.cents,
      url: listingUrl(best.blueprint_id),
    },
  };
}
