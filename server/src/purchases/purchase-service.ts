import type { PurchaseDetail, PurchaseResult, PurchasesDto, TrackedCard, TrackedSealed } from '@ctzero/shared';
import type { CardService } from '../cards/card-service';
import type { Db } from '../db/db';
import { deletePurchase, getPurchase, getPurchaseDetail, listPurchases } from '../db/purchases-repo';
import { NotFoundError, ValidationError } from '../errors';
import type { SealedService } from '../sealed/sealed-service';

export interface PurchaseServiceDeps {
  db: Db;
  cards: Pick<CardService, 'restore'>;
  sealed: Pick<SealedService, 'restore'>;
}

/** The purchases archive. Buying happens on the item (CardService / SealedService.purchase). */
export class PurchaseService {
  constructor(private readonly deps: PurchaseServiceDeps) {}

  /** The totals are computed by the client, per kind and view (see `purchaseTotals`). */
  list(): PurchasesDto {
    return { items: listPurchases(this.deps.db) };
  }

  get(id: number): PurchaseDetail {
    const purchase = getPurchaseDetail(this.deps.db, id);
    if (!purchase) throw new NotFoundError('Purchase not found');
    return purchase;
  }

  delete(id: number): void {
    if (!deletePurchase(this.deps.db, id)) throw new NotFoundError('Purchase not found');
  }

  /** Tracks again the item of an archived purchase, with its rules and price history. */
  async trackAgain(id: number): Promise<PurchaseResult<TrackedCard | TrackedSealed>> {
    const purchase = this.get(id);
    if (purchase.itemId !== null) throw new ValidationError('This purchase is still tracked');
    const item = purchase.kind === 'card' ? await this.deps.cards.restore(purchase) : await this.deps.sealed.restore(purchase);
    return { purchase: getPurchase(this.deps.db, id) ?? purchase, item };
  }
}
