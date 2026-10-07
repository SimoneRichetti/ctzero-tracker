import type { Expansion, SealedProduct } from '@ctzero/shared';
import type { CardTraderClient, CtExpansion } from '../clients/cardtrader';
import { ValidationError } from '../errors';

/** CardTrader Magic categories that count as sealed products → display name. */
export const SEALED_CATEGORIES: Readonly<Record<number, string>> = {
  4: 'Booster Box',
  5: 'Booster',
  6: 'Complete Set',
  7: 'Starter Deck',
  10: 'Box Set',
  13: 'Boxed Set',
  17: 'Preconstructed Deck',
  23: 'Bundle',
  24: 'Prerelease Pack',
};

/** Expansion blueprint exports are large: reused while a product is being added. */
const PRODUCTS_TTL_MS = 10 * 60 * 1000;
/** An expansion missing from the cached list may be new: retry with a list at most this old. */
const MISSING_EXPANSION_MAX_AGE_MS = 10 * 60 * 1000;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

/** CardTrader returns some names HTML-escaped (e.g. "Beadle &amp; Grimm's"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|quot|#39|lt|gt);/g, (entity) => ENTITIES[entity]!);
}

/** Blueprint id from a numeric id or a product link (".../cards/389300-the-hobbit-..."). */
export function parseBlueprintRef(input: string): number {
  const text = input.trim();
  const match = /^\d+$/.test(text) ? text : /\/cards\/(\d+)(?:[-/?#]|$)/.exec(text)?.[1];
  const id = match ? Number(match) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ValidationError('Unrecognized CardTrader link: paste a product page link (…/cards/<id>-…) or its numeric id');
  }
  return id;
}

export class SealedCatalog {
  private readonly productsCache = new Map<number, { fetchedAt: number; products: SealedProduct[] }>();

  constructor(
    private readonly ct: Pick<CardTraderClient, 'blueprints' | 'products'>,
    /** Magic expansions, from a cache no older than `maxAgeMs` (default: the catalog's own TTL). */
    private readonly expansions: (maxAgeMs?: number) => Promise<CtExpansion[]>,
    private readonly now: () => number = Date.now,
  ) {}

  async listExpansions(): Promise<Expansion[]> {
    return (await this.expansions())
      .map((e) => ({ id: e.id, code: e.code, name: decodeEntities(e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  async sealedProducts(expansionId: number): Promise<SealedProduct[]> {
    const cached = this.productsCache.get(expansionId);
    if (cached && this.now() - cached.fetchedAt < PRODUCTS_TTL_MS) return cached.products;
    const products = await this.fetchSealedProducts(expansionId);
    this.productsCache.set(expansionId, { fetchedAt: this.now(), products });
    return products;
  }

  private async fetchSealedProducts(expansionId: number): Promise<SealedProduct[]> {
    const expansion =
      (await this.expansions()).find((e) => e.id === expansionId) ??
      (await this.expansions(MISSING_EXPANSION_MAX_AGE_MS)).find((e) => e.id === expansionId);
    if (!expansion) throw new ValidationError(`Expansion ${expansionId} is not a Magic expansion on CardTrader`);
    const out: SealedProduct[] = [];
    for (const bp of await this.ct.blueprints(expansionId)) {
      const categoryName = bp.category_id !== undefined ? SEALED_CATEGORIES[bp.category_id] : undefined;
      if (!categoryName || bp.scryfall_id) continue;
      out.push({
        blueprintId: bp.id,
        name: decodeEntities(bp.name),
        expansionId,
        expansionName: decodeEntities(expansion.name),
        categoryName,
        imageUrl: bp.image_url ?? null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }

  /**
   * There is no single-blueprint endpoint: the expansion is either given (product picked from
   * its expansion) or taken from the product's listings (link or bare id).
   */
  async sealedProduct(blueprintId: number, knownExpansionId?: number): Promise<SealedProduct> {
    const expansionId = knownExpansionId ?? (await this.expansionFromListings(blueprintId));
    const product = (await this.sealedProducts(expansionId)).find((p) => p.blueprintId === blueprintId);
    if (!product) throw new ValidationError(`CardTrader item ${blueprintId} is not a sealed product`);
    return product;
  }

  private async expansionFromListings(blueprintId: number): Promise<number> {
    const listings = await this.ct.products(blueprintId, {});
    const expansionId = listings.find((p) => p.expansion)?.expansion?.id;
    if (expansionId === undefined) {
      throw new ValidationError(
        `Product ${blueprintId} has no listings on CardTrader and cannot be identified: select it from its expansion`,
      );
    }
    return expansionId;
  }
}
