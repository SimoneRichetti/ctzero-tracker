import type { CardPurchase, PurchaseRecord, TrackedCard } from '@ctzero/shared';
import type { Db } from './db';

interface PurchaseRow {
  id: number;
  tracked_card_id: number | null;
  name: string;
  image_url: string | null;
  start_price_cents: number | null;
  price_paid_cents: number;
  purchased_at: string;
}

export function toPurchase(r: Pick<PurchaseRow, 'start_price_cents' | 'price_paid_cents' | 'purchased_at'>): CardPurchase {
  return {
    pricePaidCents: r.price_paid_cents,
    startPriceCents: r.start_price_cents,
    savedCents: r.start_price_cents === null ? null : r.start_price_cents - r.price_paid_cents,
    purchasedAt: r.purchased_at,
  };
}

/**
 * Records that `card` was bought for `pricePaidCents`, with its current start price.
 * Buying a card already bought replaces the price paid and the date.
 */
export function upsertPurchase(db: Db, card: TrackedCard, pricePaidCents: number, now: Date = new Date()): void {
  db.prepare(
    `INSERT INTO card_purchases (tracked_card_id, name, image_url, start_price_cents, price_paid_cents, purchased_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tracked_card_id) DO UPDATE SET price_paid_cents = excluded.price_paid_cents, purchased_at = excluded.purchased_at`,
  ).run(card.id, card.name, card.imageUrl, card.startPriceCents, pricePaidCents, now.toISOString());
}

export function deletePurchaseOfCard(db: Db, cardId: number): boolean {
  return Number(db.prepare('DELETE FROM card_purchases WHERE tracked_card_id = ?').run(cardId).changes) > 0;
}

/** Every purchase, newest first, including those of cards no longer tracked. */
export function listPurchases(db: Db): PurchaseRecord[] {
  const rows = db.prepare('SELECT * FROM card_purchases ORDER BY purchased_at DESC, id DESC').all() as unknown as PurchaseRow[];
  return rows.map((r) => ({ id: r.id, cardId: r.tracked_card_id, name: r.name, imageUrl: r.image_url, ...toPurchase(r) }));
}
