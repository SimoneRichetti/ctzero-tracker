import {
  thresholdPresets,
  type PreviewResult,
  type PriceHistoryDto,
  type PurchaseDetail,
  type PurchaseInput,
  type PurchaseResult,
  type SealedInput,
  type SealedPreview,
  type SealedUpdate,
  type TrackedSealed,
  type TrackedSealedRow,
} from '@ctzero/shared';
import { evaluateSilently } from '../alerts/rules';
import type { SealedCatalog } from '../catalog/sealed-catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { transaction, type Db } from '../db/db';
import {
  deleteSealed,
  getSealed,
  insertSealed,
  insertSealedSnapshot,
  listRecentSealedSnapshots,
  listSealed,
  listSealedSnapshots,
  updateSealed,
} from '../db/sealed-repo';
import { getPurchase, linkPurchase, recordPurchase } from '../db/purchases-repo';
import { NotFoundError, ValidationError, errorMessage } from '../errors';
import { priceSealed } from '../pricing/sealed-pricer';
import { computeTrend, trendSince } from '../pricing/trend';

export interface SealedServiceDeps {
  db: Db;
  catalog: Pick<SealedCatalog, 'sealedProduct'>;
  ct: Pick<CardTraderClient, 'products'>;
  now?: () => Date;
}

function sameSet<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export class SealedService {
  constructor(private readonly deps: SealedServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  list(): TrackedSealedRow[] {
    const { db } = this.deps;
    const now = this.now();
    const recent = listRecentSealedSnapshots(db, trendSince(now));
    return listSealed(db).map((item) => ({
      ...item,
      trend: computeTrend(recent.get(item.id) ?? [], item.configVersion, now),
    }));
  }

  history(id: number): PriceHistoryDto {
    const { db } = this.deps;
    const item = getSealed(db, id);
    if (!item) throw new NotFoundError('Sealed product not found');
    return { thresholdCents: item.thresholdCents, configVersion: item.configVersion, points: listSealedSnapshots(db, id) };
  }

  async preview(input: SealedPreview): Promise<PreviewResult> {
    const product = await this.deps.catalog.sealedProduct(input.blueprintId, input.expansionId);
    const result = await priceSealed(this.deps.ct, product, input.languages);
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    return {
      priceCents,
      listing: result.status === 'ok' ? result.listing : null,
      presets: thresholdPresets(priceCents),
      blueprintCount: 1,
    };
  }

  async create(input: SealedInput): Promise<TrackedSealed> {
    // Product data comes from CardTrader, not from the client.
    const product = await this.deps.catalog.sealedProduct(input.blueprintId, input.expansionId);
    const created = insertSealed(
      this.deps.db,
      { ...product, languages: input.languages, thresholdCents: input.thresholdCents, quantityNeeded: input.quantityNeeded ?? null },
      this.now(),
    );
    return this.refreshSilently(created);
  }

  /**
   * Tracks again the product of an archived purchase: same languages and target, with the price
   * history copied back. The purchase is linked to the new product.
   */
  async restore(purchase: PurchaseDetail): Promise<TrackedSealed> {
    const { db } = this.deps;
    const rules = purchase.rules;
    if (rules?.kind !== 'sealed' || purchase.thresholdCents === null) {
      throw new ValidationError('The rules of this purchase were not recorded: add the product again');
    }
    const product = await this.deps.catalog.sealedProduct(rules.blueprintId, rules.expansionId);
    const thresholdCents = purchase.thresholdCents;
    const created = transaction(db, () => {
      const item = insertSealed(db, { ...product, languages: rules.languages, thresholdCents }, this.now());
      for (const p of purchase.points) {
        insertSealedSnapshot(db, { sealedId: item.id, configVersion: item.configVersion, syncedAt: p.syncedAt, priceCents: p.priceCents });
      }
      if (!linkPurchase(db, purchase.id, 'sealed', item.id)) throw new ValidationError('This purchase is already tracked again');
      return item;
    });
    return this.refreshSilently(created);
  }

  async update(id: number, input: SealedUpdate): Promise<TrackedSealed> {
    const { db } = this.deps;
    const item = getSealed(db, id);
    if (!item) throw new NotFoundError('Sealed product not found');
    const now = this.now();

    const needed = input.quantityNeeded !== undefined ? { quantityNeeded: input.quantityNeeded } : {};
    if (sameSet(item.languages, input.languages)) {
      return updateSealed(
        db,
        id,
        { thresholdCents: input.thresholdCents, ...evaluateSilently(item.lastPriceCents, input.thresholdCents), ...needed },
        now,
      );
    }

    const updated = updateSealed(
      db,
      id,
      {
        languages: input.languages,
        thresholdCents: input.thresholdCents,
        ...needed,
        configVersion: item.configVersion + 1,
        lastPriceCents: null,
        lastListing: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
        lastError: null,
        alertState: null,
        lastNotifiedPriceCents: null,
      },
      now,
    );
    return this.refreshSilently(updated);
  }

  delete(id: number): void {
    if (!deleteSealed(this.deps.db, id)) throw new NotFoundError('Sealed product not found');
  }

  /**
   * Records a purchase of the product in the archive, as it is now. Without `keepTracking`
   * the product then stops being tracked (the purchase outlives it).
   */
  purchase(id: number, input: PurchaseInput): PurchaseResult<TrackedSealed> {
    const { db } = this.deps;
    return transaction(db, () => {
      const item = getSealed(db, id);
      if (!item) throw new NotFoundError('Sealed product not found');
      const rules = {
        kind: 'sealed' as const,
        blueprintId: item.blueprintId,
        expansionId: item.expansionId,
        expansionName: item.expansionName,
        categoryName: item.categoryName,
        languages: item.languages,
      };
      const recorded = recordPurchase(db, 'sealed', { ...item, groupName: null, rules }, input, this.now());
      if (!input.keepTracking) deleteSealed(db, id);
      return { purchase: getPurchase(db, recorded.id)!, item: input.keepTracking ? getSealed(db, id) : null };
    });
  }

  /**
   * Refreshes the price of a single product without sending notifications.
   * If the product was deleted or its languages changed while it was being priced,
   * the result is stale and is not written.
   */
  private async refreshSilently(item: TrackedSealed): Promise<TrackedSealed> {
    const { db, ct } = this.deps;
    const now = this.now();
    const iso = now.toISOString();
    const current = () => {
      const latest = getSealed(db, item.id);
      return latest && latest.configVersion === item.configVersion ? latest : null;
    };
    try {
      const result = await priceSealed(ct, item, item.languages);
      const priceCents = result.status === 'ok' ? result.priceCents : null;
      return transaction(db, () => {
        const latest = current();
        if (!latest) return getSealed(db, item.id) ?? item;
        insertSealedSnapshot(db, { sealedId: item.id, configVersion: item.configVersion, syncedAt: iso, priceCents });
        return updateSealed(
          db,
          item.id,
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
      if (!current()) return getSealed(db, item.id) ?? item;
      return updateSealed(db, item.id, { lastSyncedAt: iso, lastSyncStatus: 'error', lastError: errorMessage(e) }, now);
    }
  }
}
