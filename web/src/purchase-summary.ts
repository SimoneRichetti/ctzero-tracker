import type { ItemKind, PurchaseRecord } from '@ctzero/shared';
import type { GroupFilter } from './group-summary';

export interface PurchaseTotals {
  /** Saved on the start prices (unknown savings count as 0). */
  savedCents: number;
  /** Price paid × copies. */
  spentCents: number;
  copies: number;
  count: number;
}

export function purchaseTotals(items: PurchaseRecord[]): PurchaseTotals {
  const t: PurchaseTotals = { savedCents: 0, spentCents: 0, copies: 0, count: items.length };
  for (const p of items) {
    t.savedCents += p.savedCents ?? 0;
    t.spentCents += p.pricePaidCents * p.quantity;
    t.copies += p.quantity;
  }
  return t;
}

/**
 * The purchases a list view counts: every purchase on the home ("all" cards, which also counts
 * sealed products: what the tool saved so far), else the purchases of that kind and group.
 * A group is matched by the name it had when bought, so archived cards still count.
 */
export function purchasesOfView(
  items: PurchaseRecord[],
  kind: ItemKind,
  group: GroupFilter = 'all',
  groupName: string | null = null,
): PurchaseRecord[] {
  if (kind === 'sealed') return items.filter((p) => p.kind === 'sealed');
  if (group === 'all') return items;
  const name = group === 'none' ? null : groupName;
  return items.filter((p) => p.kind === 'card' && p.groupName === name);
}

export type TrackingFilter = 'any' | 'tracked' | 'archived';

export function filterPurchases(items: PurchaseRecord[], kind: ItemKind | 'all', tracking: TrackingFilter): PurchaseRecord[] {
  return items.filter(
    (p) =>
      (kind === 'all' || p.kind === kind) &&
      (tracking === 'any' || (tracking === 'tracked') === (p.itemId !== null)),
  );
}

/** Progress towards the copies needed, e.g. "1/4"; null when no quantity is set. */
export function copiesProgress(item: { quantityNeeded: number | null; boughtQuantity: number }): { text: string; pct: number; done: boolean } | null {
  const need = item.quantityNeeded;
  if (need === null) return null;
  return {
    text: `${item.boughtQuantity}/${need}`,
    pct: Math.min(100, Math.round((item.boughtQuantity / need) * 100)),
    done: item.boughtQuantity >= need,
  };
}

/**
 * Whether buying `quantity` more copies should stop the tracking by default: when it completes
 * the copies needed, or when no quantity is set (a single copy is the common case).
 */
export function suggestStopTracking(item: { quantityNeeded: number | null; boughtQuantity: number }, quantity: number): boolean {
  return item.quantityNeeded === null || item.boughtQuantity + quantity >= item.quantityNeeded;
}
