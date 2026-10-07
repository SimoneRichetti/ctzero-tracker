import type { CardBlueprint, CardFilters, CardInput, CardUpdate, PreviewResult, TrackedCard } from '@ctzero/shared';
import { evaluateSilently } from '../alerts/rules';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import {
  deleteCard,
  getCard,
  insertCard,
  insertSnapshot,
  listCards,
  replaceBlueprints,
  updateCard,
} from '../db/cards-repo';
import { transaction, type Db } from '../db/db';
import { NotFoundError, errorMessage } from '../errors';
import { priceCard } from '../pricing/card-pricer';
import { thresholdPresets } from '../pricing/presets';

export interface CardServiceDeps {
  db: Db;
  catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>;
  ct: Pick<CardTraderClient, 'products'>;
  now?: () => Date;
}

function sameSet<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function filtersChanged(card: TrackedCard, input: CardUpdate): boolean {
  return (
    !sameSet(card.expansionIds, input.expansionIds) ||
    !sameSet(card.languages, input.languages) ||
    card.minCondition !== input.minCondition ||
    card.foil !== input.foil
  );
}

export class CardService {
  constructor(private readonly deps: CardServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  list(): TrackedCard[] {
    return listCards(this.deps.db);
  }

  async preview(f: CardFilters): Promise<PreviewResult> {
    const lookup = await this.deps.catalog.lookup(f.name);
    const blueprints = await this.deps.catalog.resolveBlueprints(lookup, f.expansionIds);
    const result = await priceCard(this.deps.ct, blueprints, f);
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    return {
      priceCents,
      listing: result.status === 'ok' ? result.listing : null,
      presets: thresholdPresets(priceCents),
      blueprintCount: blueprints.length,
    };
  }

  async create(input: CardInput): Promise<TrackedCard> {
    const { db, catalog } = this.deps;
    const lookup = await catalog.lookup(input.name);
    const blueprints = await catalog.resolveBlueprints(lookup, input.expansionIds);
    const now = this.now();
    const card = transaction(db, () => {
      const created = insertCard(
        db,
        {
          name: lookup.name,
          scryfallOracleId: lookup.oracleId,
          imageUrl: lookup.imageUrl,
          expansionIds: input.expansionIds,
          languages: input.languages,
          minCondition: input.minCondition,
          foil: input.foil,
          thresholdCents: input.thresholdCents,
        },
        now,
      );
      replaceBlueprints(db, created.id, blueprints);
      return updateCard(db, created.id, { blueprintsResolvedAt: now.toISOString() }, now);
    });
    return this.refreshSilently(card, blueprints);
  }

  async update(id: number, input: CardUpdate): Promise<TrackedCard> {
    const { db, catalog } = this.deps;
    const card = getCard(db, id);
    if (!card) throw new NotFoundError('Card not found');
    const now = this.now();

    if (!filtersChanged(card, input)) {
      return updateCard(
        db,
        id,
        { thresholdCents: input.thresholdCents, ...evaluateSilently(card.lastPriceCents, input.thresholdCents) },
        now,
      );
    }

    // Resolve blueprints first: if that fails, the card is left unchanged.
    const lookup = await catalog.lookup(card.name);
    const blueprints = await catalog.resolveBlueprints(lookup, input.expansionIds);
    const updated = transaction(db, () => {
      replaceBlueprints(db, id, blueprints);
      return updateCard(
        db,
        id,
        {
          expansionIds: input.expansionIds,
          languages: input.languages,
          minCondition: input.minCondition,
          foil: input.foil,
          thresholdCents: input.thresholdCents,
          configVersion: card.configVersion + 1,
          lastPriceCents: null,
          lastListing: null,
          lastSyncedAt: null,
          lastSyncStatus: null,
          lastError: null,
          alertState: null,
          lastNotifiedPriceCents: null,
          blueprintsResolvedAt: now.toISOString(),
        },
        now,
      );
    });
    return this.refreshSilently(updated, blueprints);
  }

  delete(id: number): void {
    if (!deleteCard(this.deps.db, id)) throw new NotFoundError('Card not found');
  }

  /**
   * Refreshes the price of a single card without sending notifications.
   * If the card was deleted or its filters changed while it was being priced,
   * the result is stale and is not written.
   */
  private async refreshSilently(card: TrackedCard, blueprints: CardBlueprint[]): Promise<TrackedCard> {
    const { db, ct } = this.deps;
    const now = this.now();
    const iso = now.toISOString();
    const current = () => {
      const latest = getCard(db, card.id);
      return latest && latest.configVersion === card.configVersion ? latest : null;
    };
    try {
      const result = await priceCard(ct, blueprints, card);
      const priceCents = result.status === 'ok' ? result.priceCents : null;
      return transaction(db, () => {
        const latest = current();
        if (!latest) return getCard(db, card.id) ?? card;
        insertSnapshot(db, { cardId: card.id, configVersion: card.configVersion, syncedAt: iso, priceCents });
        return updateCard(
          db,
          card.id,
          {
            lastPriceCents: priceCents,
            lastListing: result.status === 'ok' ? result.listing : null,
            lastSyncedAt: iso,
            lastSyncStatus: result.status,
            lastError: null,
            ...evaluateSilently(priceCents, latest.thresholdCents),
          },
          now,
        );
      });
    } catch (e) {
      if (!current()) return getCard(db, card.id) ?? card;
      return updateCard(db, card.id, { lastSyncedAt: iso, lastSyncStatus: 'error', lastError: errorMessage(e) }, now);
    }
  }
}
