import type { CardBlueprint, Printing } from '@ctzero/shared';
import { MTG_GAME_ID, type CardTraderClient, type CtExpansion } from '../clients/cardtrader';
import { HttpError } from '../clients/http';
import { cardImage, type ScryfallCard, type ScryfallClient } from '../clients/scryfall';
import { NotFoundError, ValidationError } from '../errors';

const EXPANSIONS_TTL_MS = 24 * 3600 * 1000;

export interface CardLookup {
  name: string;
  oracleId: string;
  imageUrl: string | null;
  /** Espansioni CardTrader in cui la carta è stata stampata. */
  printings: Printing[];
  /** Per ogni espansione CardTrader, gli id Scryfall delle stampe della carta. */
  scryfallIdsByExpansion: Map<number, Set<string>>;
}

export class Catalog {
  private expansionsCache: { fetchedAt: number; list: CtExpansion[] } | null = null;

  constructor(
    private readonly ct: CardTraderClient,
    private readonly scryfall: ScryfallClient,
    private readonly now: () => number = Date.now,
  ) {}

  async mtgExpansions(): Promise<CtExpansion[]> {
    const cached = this.expansionsCache;
    if (cached && this.now() - cached.fetchedAt < EXPANSIONS_TTL_MS) return cached.list;
    const list = (await this.ct.expansions()).filter((e) => e.game_id === MTG_GAME_ID);
    this.expansionsCache = { fetchedAt: this.now(), list };
    return list;
  }

  private async named(name: string): Promise<ScryfallCard> {
    try {
      return await this.scryfall.named(name);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) throw new NotFoundError(`Carta "${name}" non trovata`);
      throw e;
    }
  }

  async lookup(name: string): Promise<CardLookup> {
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

  /** `expansionIds` vuoto = tutte le espansioni in cui esiste la carta. */
  async resolveBlueprints(lookup: CardLookup, expansionIds: number[]): Promise<CardBlueprint[]> {
    const available = lookup.scryfallIdsByExpansion;
    const targets = expansionIds.length > 0 ? expansionIds.filter((id) => available.has(id)) : [...available.keys()];
    const names = new Map(lookup.printings.map((p) => [p.expansionId, p.expansionName]));
    const out: CardBlueprint[] = [];
    for (const expansionId of targets) {
      const wanted = available.get(expansionId)!;
      for (const bp of await this.ct.blueprints(expansionId)) {
        if (bp.scryfall_id && wanted.has(bp.scryfall_id)) {
          out.push({ blueprintId: bp.id, expansionId, expansionName: names.get(expansionId) ?? '' });
        }
      }
    }
    if (out.length === 0) {
      throw new ValidationError(`Nessuna stampa di "${lookup.name}" trovata su CardTrader per le espansioni selezionate`);
    }
    return out;
  }
}
