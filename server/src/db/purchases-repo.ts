import type { ItemKind, Purchase, PurchaseRecord, PurchasesDto } from '@ctzero/shared';
import type { Db } from './db';

interface PurchaseRow {
  id: number;
  kind: ItemKind;
  tracked_card_id: number | null;
  tracked_sealed_id: number | null;
  name: string;
  image_url: string | null;
  start_price_cents: number | null;
  price_paid_cents: number;
  purchased_at: string;
}

const ITEM_COLUMN: Record<ItemKind, string> = { card: 'tracked_card_id', sealed: 'tracked_sealed_id' };

/** Joins the purchase of each item (its table aliased `t`); select it with PURCHASE_COLUMNS. */
export function purchaseJoin(kind: ItemKind): string {
  return `LEFT JOIN purchases p ON p.${ITEM_COLUMN[kind]} = t.id`;
}
export const PURCHASE_COLUMNS = 'p.price_paid_cents AS p_paid, p.start_price_cents AS p_start, p.purchased_at AS p_at';

export interface PurchaseColumns {
  p_paid: number | null;
  p_start: number | null;
  p_at: string | null;
}

export function toPurchase(r: Pick<PurchaseRow, 'start_price_cents' | 'price_paid_cents' | 'purchased_at'>): Purchase {
  return {
    pricePaidCents: r.price_paid_cents,
    startPriceCents: r.start_price_cents,
    savedCents: r.start_price_cents === null ? null : r.start_price_cents - r.price_paid_cents,
    purchasedAt: r.purchased_at,
  };
}

export function purchaseOf(r: PurchaseColumns): Purchase | null {
  return r.p_paid === null || r.p_at === null
    ? null
    : toPurchase({ start_price_cents: r.p_start, price_paid_cents: r.p_paid, purchased_at: r.p_at });
}

interface Purchasable {
  id: number;
  name: string;
  imageUrl: string | null;
  startPriceCents: number | null;
}

/**
 * Records that `item` was bought for `pricePaidCents`, with its current start price.
 * Buying an item already bought replaces the price paid and the date.
 */
export function upsertPurchase(db: Db, kind: ItemKind, item: Purchasable, pricePaidCents: number, now: Date = new Date()): void {
  const column = ITEM_COLUMN[kind];
  db.prepare(
    `INSERT INTO purchases (kind, ${column}, name, image_url, start_price_cents, price_paid_cents, purchased_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (${column}) DO UPDATE SET price_paid_cents = excluded.price_paid_cents, purchased_at = excluded.purchased_at`,
  ).run(kind, item.id, item.name, item.imageUrl, item.startPriceCents, pricePaidCents, now.toISOString());
}

export function deletePurchaseOf(db: Db, kind: ItemKind, itemId: number): boolean {
  return Number(db.prepare(`DELETE FROM purchases WHERE ${ITEM_COLUMN[kind]} = ?`).run(itemId).changes) > 0;
}

/** Every purchase, newest first, including those of items no longer tracked. */
export function listPurchases(db: Db): PurchaseRecord[] {
  const rows = db.prepare('SELECT * FROM purchases ORDER BY purchased_at DESC, id DESC').all() as unknown as PurchaseRow[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    itemId: r.kind === 'card' ? r.tracked_card_id : r.tracked_sealed_id,
    name: r.name,
    imageUrl: r.image_url,
    ...toPurchase(r),
  }));
}

export function purchasesSummary(db: Db): PurchasesDto {
  const items = listPurchases(db);
  return {
    totalSavedCents: items.reduce((sum, p) => sum + (p.savedCents ?? 0), 0),
    totalPaidCents: items.reduce((sum, p) => sum + p.pricePaidCents, 0),
    items,
  };
}
