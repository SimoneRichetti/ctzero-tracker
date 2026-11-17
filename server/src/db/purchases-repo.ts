import type { ItemKind, Listing, PurchaseDetail, PurchaseRecord, PurchaseRules } from '@ctzero/shared';
import type { Db } from './db';

interface PurchaseRow {
  id: number;
  kind: ItemKind;
  tracked_card_id: number | null;
  tracked_sealed_id: number | null;
  name: string;
  image_url: string | null;
  group_name: string | null;
  rules: string | null;
  threshold_cents: number | null;
  market_price_cents: number | null;
  listing: string | null;
  start_price_cents: number | null;
  start_price_at: string | null;
  price_paid_cents: number;
  quantity: number;
  purchased_at: string;
}

const ITEM_COLUMN: Record<ItemKind, string> = { card: 'tracked_card_id', sealed: 'tracked_sealed_id' };
const SNAPSHOTS: Record<ItemKind, { table: string; owner: string }> = {
  card: { table: 'price_snapshots', owner: 'tracked_card_id' },
  sealed: { table: 'sealed_price_snapshots', owner: 'tracked_sealed_id' },
};

/** Copies bought of each item (its table aliased `t`), selected as `bought_quantity`. */
export function boughtQuantityColumn(kind: ItemKind): string {
  return `(SELECT COALESCE(SUM(p.quantity), 0) FROM purchases p WHERE p.${ITEM_COLUMN[kind]} = t.id) AS bought_quantity`;
}

function toRecord(r: PurchaseRow): PurchaseRecord {
  return {
    id: r.id,
    kind: r.kind,
    itemId: r.kind === 'card' ? r.tracked_card_id : r.tracked_sealed_id,
    name: r.name,
    imageUrl: r.image_url,
    groupName: r.group_name,
    rules: r.rules ? (JSON.parse(r.rules) as PurchaseRules) : null,
    thresholdCents: r.threshold_cents,
    marketPriceCents: r.market_price_cents,
    listing: r.listing ? (JSON.parse(r.listing) as Listing) : null,
    startPriceCents: r.start_price_cents,
    startPriceAt: r.start_price_at,
    pricePaidCents: r.price_paid_cents,
    quantity: r.quantity,
    savedCents: r.start_price_cents === null ? null : (r.start_price_cents - r.price_paid_cents) * r.quantity,
    purchasedAt: r.purchased_at,
  };
}

/** The item as it is when bought: what the purchase freezes. */
export interface FrozenItem {
  id: number;
  name: string;
  imageUrl: string | null;
  groupName: string | null;
  rules: PurchaseRules;
  thresholdCents: number;
  configVersion: number;
  lastPriceCents: number | null;
  lastListing: Listing | null;
  startPriceCents: number | null;
  startPriceAt: string | null;
}

/**
 * Records that `quantity` copies of `item` were bought at `pricePaidCents` each, with a copy of its
 * price history (current configuration, up to now). The purchase stays linked to the item.
 */
export function recordPurchase(
  db: Db,
  kind: ItemKind,
  item: FrozenItem,
  input: { pricePaidCents: number; quantity: number },
  now: Date = new Date(),
): PurchaseRecord {
  const iso = now.toISOString();
  const res = db
    .prepare(
      `INSERT INTO purchases (kind, ${ITEM_COLUMN[kind]}, name, image_url, group_name, rules, threshold_cents,
         market_price_cents, listing, start_price_cents, start_price_at, price_paid_cents, quantity, purchased_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      kind,
      item.id,
      item.name,
      item.imageUrl,
      item.groupName,
      JSON.stringify(item.rules),
      item.thresholdCents,
      item.lastPriceCents,
      item.lastListing ? JSON.stringify(item.lastListing) : null,
      item.startPriceCents,
      item.startPriceAt,
      input.pricePaidCents,
      input.quantity,
      iso,
    );
  const id = Number(res.lastInsertRowid);
  const { table, owner } = SNAPSHOTS[kind];
  db.prepare(
    `INSERT INTO purchase_snapshots (purchase_id, synced_at, price_cents)
     SELECT ?, synced_at, price_cents FROM ${table}
     WHERE ${owner} = ? AND config_version = ? AND synced_at <= ? ORDER BY id`,
  ).run(id, item.id, item.configVersion, iso);
  return getPurchase(db, id)!;
}

export function getPurchase(db: Db, id: number): PurchaseRecord | null {
  const row = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as unknown as PurchaseRow | undefined;
  return row ? toRecord(row) : null;
}

export function getPurchaseDetail(db: Db, id: number): PurchaseDetail | null {
  const purchase = getPurchase(db, id);
  if (!purchase) return null;
  const points = db
    .prepare('SELECT synced_at AS syncedAt, price_cents AS priceCents FROM purchase_snapshots WHERE purchase_id = ? ORDER BY id')
    .all(id) as unknown as PurchaseDetail['points'];
  return { ...purchase, points };
}

/** Every purchase, newest first, including those of items no longer tracked. */
export function listPurchases(db: Db): PurchaseRecord[] {
  const rows = db.prepare('SELECT * FROM purchases ORDER BY purchased_at DESC, id DESC').all() as unknown as PurchaseRow[];
  return rows.map(toRecord);
}

export function deletePurchase(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM purchases WHERE id = ?').run(id).changes) > 0;
}

/** Links an archived purchase to the item tracked again from it; false if it is linked already (or gone). */
export function linkPurchase(db: Db, id: number, kind: ItemKind, itemId: number): boolean {
  const res = db.prepare(`UPDATE purchases SET ${ITEM_COLUMN[kind]} = ? WHERE id = ? AND ${ITEM_COLUMN[kind]} IS NULL`).run(itemId, id);
  return Number(res.changes) > 0;
}
