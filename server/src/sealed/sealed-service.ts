import type { PreviewResult, SealedInput, SealedPreview, SealedUpdate, TrackedSealed } from '@ctzero/shared';
import { evaluateSilently } from '../alerts/rules';
import type { SealedCatalog } from '../catalog/sealed-catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { transaction, type Db } from '../db/db';
import {
  deleteSealed,
  getSealed,
  insertSealed,
  insertSealedSnapshot,
  listSealed,
  updateSealed,
} from '../db/sealed-repo';
import { NotFoundError, errorMessage } from '../errors';
import { thresholdPresets } from '../pricing/presets';
import { priceSealed } from '../pricing/sealed-pricer';

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

  list(): TrackedSealed[] {
    return listSealed(this.deps.db);
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
      { ...product, languages: input.languages, thresholdCents: input.thresholdCents },
      this.now(),
    );
    return this.refreshSilently(created);
  }

  async update(id: number, input: SealedUpdate): Promise<TrackedSealed> {
    const { db } = this.deps;
    const item = getSealed(db, id);
    if (!item) throw new NotFoundError('Sealed product not found');
    const now = this.now();

    if (sameSet(item.languages, input.languages)) {
      return updateSealed(
        db,
        id,
        { thresholdCents: input.thresholdCents, ...evaluateSilently(item.lastPriceCents, input.thresholdCents) },
        now,
      );
    }

    const updated = updateSealed(
      db,
      id,
      {
        languages: input.languages,
        thresholdCents: input.thresholdCents,
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
