import { formatEuro, type PurchaseRecord } from '@ctzero/shared';
import type { ToastMessageOptions } from 'primevue/toast';
import { linkToast } from './link-toast';

function savedText(purchase: PurchaseRecord): string | undefined {
  const saved = purchase.savedCents;
  if (saved === null) return undefined;
  return saved > 0 ? `You saved ${formatEuro(saved)}` : saved < 0 ? `Paid ${formatEuro(-saved)} more than the start price` : undefined;
}

/** Toast after a purchase: it links the purchase in the archive. */
export function purchaseToast(purchase: PurchaseRecord, keptTracking: boolean): ToastMessageOptions {
  const copies = purchase.quantity === 1 ? '' : ` × ${purchase.quantity}`;
  const summary = keptTracking ? `${purchase.name}${copies} bought` : `${purchase.name} moved to Purchases`;
  return linkToast(summary, savedText(purchase), { to: { path: '/purchases', query: { item: String(purchase.id) } }, label: 'View' });
}
