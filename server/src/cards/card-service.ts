import {
  percentBelow,
  thresholdPresets,
  type BulkCards,
  type BulkResult,
  type CardBlueprint,
  type CardFilters,
  type CardInput,
  type CardUpdate,
  type PreviewResult,
  type PriceHistoryDto,
  type TrackedCard,
  type TrackedCardRow,
} from '@ctzero/shared';
import { evaluateSilently } from '../alerts/rules';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import {
  deleteCard,
  getCard,
  insertCard,
  insertSnapshot,
  listCards,
  listRecentSnapshotsByCard,
  listSnapshots,
  replaceBlueprints,
  updateCard,
} from '../db/cards-repo';
import { transaction, type Db } from '../db/db';
import { getGroup } from '../db/groups-repo';
import { NotFoundError, ValidationError, errorMessage } from '../errors';
import { priceCard } from '../pricing/card-pricer';
import { computeTrend, trendSince } from '../pricing/trend';

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

  /** Throws if `groupId` is set but does not exist. */
  private assertGroup(groupId: number | null | undefined): void {
    if (groupId != null && !getGroup(this.deps.db, groupId)) throw new ValidationError('Group not found');
  }

  list(): TrackedCardRow[] {
    const { db } = this.deps;
    const now = this.now();
    const recent = listRecentSnapshotsByCard(db, trendSince(now));
    return listCards(db).map((card) => ({
      ...card,
      trend: computeTrend(recent.get(card.id) ?? [], card.configVersion, now),
    }));
  }

  history(id: number): PriceHistoryDto {
    const { db } = this.deps;
    const card = getCard(db, id);
    if (!card) throw new NotFoundError('Card not found');
    return { thresholdCents: card.thresholdCents, configVersion: card.configVersion, points: listSnapshots(db, id) };
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
    this.assertGroup(input.groupId);
    const lookup = await catalog.lookup(input.name);
    const blueprints = await catalog.resolveBlueprints(lookup, input.expansionIds);
    const now = this.now();
    const card = transaction(db, () => {
      // Checked again: the group may have been deleted while Scryfall was being called.
      this.assertGroup(input.groupId);
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
          groupId: input.groupId ?? null,
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
    this.assertGroup(input.groupId);
    const groupPatch = input.groupId !== undefined ? { groupId: input.groupId } : {};
    const now = this.now();

    if (!filtersChanged(card, input)) {
      return updateCard(
        db,
        id,
        {
          thresholdCents: input.thresholdCents,
          ...evaluateSilently(card.lastPriceCents, input.thresholdCents),
          ...groupPatch,
        },
        now,
      );
    }

    // Resolve blueprints first: if that fails, the card is left unchanged.
    const lookup = await catalog.lookup(card.name);
    const blueprints = await catalog.resolveBlueprints(lookup, input.expansionIds);
    const updated = transaction(db, () => {
      this.assertGroup(input.groupId);
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
          ...groupPatch,
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

  /** Fast bulk edits, DB only, in one transaction. */
  bulk(input: BulkCards): BulkResult {
    const { db } = this.deps;
    const { action } = input;
    if (action.type === 'group') this.assertGroup(action.groupId);
    const now = this.now();
    return transaction(db, () => {
      const updated: number[] = [];
      const skipped: BulkResult['skipped'] = [];
      for (const id of input.ids) {
        const card = getCard(db, id);
        if (!card) {
          skipped.push({ id, reason: 'not found' });
          continue;
        }
        if (action.type === 'delete') {
          deleteCard(db, id);
        } else if (action.type === 'group') {
          updateCard(db, id, { groupId: action.groupId }, now);
        } else {
          if (action.mode === 'percent' && card.lastPriceCents === null) {
            skipped.push({ id, reason: 'no current price' });
            continue;
          }
          const cents = action.mode === 'fixed' ? action.cents : percentBelow(card.lastPriceCents!, action.percent);
          updateCard(db, id, { thresholdCents: cents, ...evaluateSilently(card.lastPriceCents, cents) }, now);
        }
        updated.push(id);
      }
      return { updated, skipped };
    });
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
