import type { CardBlueprint, Printing } from '@ctzero/shared';
import { MTG_GAME_ID, type CardTraderClient, type CtBlueprint, type CtExpansion } from '../clients/cardtrader';
import { HttpError } from '../clients/http';
import { cardImage, type ScryfallCard, type ScryfallClient } from '../clients/scryfall';
import { NotFoundError, ValidationError } from '../errors';

const EXPANSIONS_TTL_MS = 24 * 3600 * 1000;
const BLUEPRINTS_TTL_MS = 3600 * 1000;
const LOOKUPS_TTL_MS = 3600 * 1000;

/** Only the fields needed to match blueprints to Scryfall printings. */
type SlimBlueprint = Pick<CtBlueprint, 'id' | 'scryfall_id'>;

export interface CardLookup {
  name: string;
  oracleId: string;
  imageUrl: string | null;
  /** CardTrader expansions in which the card was printed. */
  printings: Printing[];
  /** For each CardTrader expansion, the Scryfall ids of the card's printings. */
  scryfallIdsByExpansion: Map<number, Set<string>>;
}

export class Catalog {
  private expansionsCache: { fetchedAt: number; list: CtExpansion[] } | null = null;
  private readonly blueprintsCache = new Map<number, { fetchedAt: number; list: SlimBlueprint[] }>();
  /** By lowercased name, both as asked and canonical. */
  private readonly lookupsCache = new Map<string, { fetchedAt: number; lookup: CardLookup }>();

  constructor(
    private readonly ct: CardTraderClient,
    private readonly scryfall: ScryfallClient,
    private readonly now: () => number = Date.now,
  ) {}

  /** Magic expansions, from a cache no older than `maxAgeMs`. */
  async mtgExpansions(maxAgeMs = EXPANSIONS_TTL_MS): Promise<CtExpansion[]> {
    const cached = this.expansionsCache;
    if (cached && this.now() - cached.fetchedAt < maxAgeMs) return cached.list;
    const list = (await this.ct.expansions()).filter((e) => e.game_id === MTG_GAME_ID);
    this.expansionsCache = { fetchedAt: this.now(), list };
    return list;
  }

  /** Blueprints of an expansion, cached for an hour (an import resolves and then creates the same cards). */
  private async expansionBlueprints(expansionId: number): Promise<SlimBlueprint[]> {
    const cached = this.blueprintsCache.get(expansionId);
    if (cached && this.now() - cached.fetchedAt < BLUEPRINTS_TTL_MS) return cached.list;
    const list = (await this.ct.blueprints(expansionId)).map((bp) => ({ id: bp.id, scryfall_id: bp.scryfall_id }));
    const now = this.now();
    for (const [k, v] of this.blueprintsCache) if (now - v.fetchedAt >= BLUEPRINTS_TTL_MS) this.blueprintsCache.delete(k);
    this.blueprintsCache.set(expansionId, { fetchedAt: now, list });
    return list;
  }

  private async named(name: string): Promise<ScryfallCard> {
    try {
      return await this.scryfall.named(name);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) throw new NotFoundError(`Card "${name}" not found`);
      throw e;
    }
  }

  /**
   * Cached for an hour, under the name asked and the canonical one: an import resolves a line and then
   * creates the card by its canonical name, and Scryfall lookups are the slowest calls (2 per second).
   */
  async lookup(name: string): Promise<CardLookup> {
    const key = name.trim().toLowerCase();
    const cached = this.lookupsCache.get(key);
    if (cached && this.now() - cached.fetchedAt < LOOKUPS_TTL_MS) return cached.lookup;
    const lookup = await this.fetchLookup(name);
    const now = this.now();
    for (const [k, v] of this.lookupsCache) if (now - v.fetchedAt >= LOOKUPS_TTL_MS) this.lookupsCache.delete(k);
    this.lookupsCache.set(key, { fetchedAt: now, lookup });
    this.lookupsCache.set(lookup.name.toLowerCase(), { fetchedAt: now, lookup });
    return lookup;
  }

  private async fetchLookup(name: string): Promise<CardLookup> {
    const card = await this.named(name);
    const prints = await this.scryfall.prints(card.oracle_id);
    const byCode = new Map((await this.mtgExpansions()).map((e) => [e.code.toLowerCase(), e]));
    const printings: Printing[] = [];
    const ids = new Map<number, Set<string>>();
    for (const p of prints) {
      const exp = byCode.get(p.set.toLowerCase());
      if (!exp) continue;
      let set = ids.get(exp.id);
      if (!set) {
        set = new Set();
        ids.set(exp.id, set);
        printings.push({ expansionId: exp.id, expansionName: exp.name, code: exp.code });
      }
      set.add(p.id);
    }
    return { name: card.name, oracleId: card.oracle_id, imageUrl: cardImage(card), printings, scryfallIdsByExpansion: ids };
  }

  /** Empty `expansionIds` = all expansions the card exists in. */
  async resolveBlueprints(lookup: CardLookup, expansionIds: number[]): Promise<CardBlueprint[]> {
    const available = lookup.scryfallIdsByExpansion;
    const targets = expansionIds.length > 0 ? expansionIds.filter((id) => available.has(id)) : [...available.keys()];
    const names = new Map(lookup.printings.map((p) => [p.expansionId, p.expansionName]));
    const out: CardBlueprint[] = [];
    for (const expansionId of targets) {
      const wanted = available.get(expansionId)!;
      for (const bp of await this.expansionBlueprints(expansionId)) {
        if (bp.scryfall_id && wanted.has(bp.scryfall_id)) {
          out.push({ blueprintId: bp.id, expansionId, expansionName: names.get(expansionId) ?? '' });
        }
      }
    }
    if (out.length === 0) {
      throw new ValidationError(`No printings of "${lookup.name}" found on CardTrader for the selected expansions`);
    }
    return out;
  }
}
