import { percentBelow, type BulkResult, type TrackedSealed } from '@ctzero/shared';
import { api } from './api';
import type { ThresholdChoice } from './threshold-choice';

type SealedTarget = Pick<TrackedSealed, 'id' | 'languages' | 'lastPriceCents'>;

export interface SealedBulkApi {
  put: (path: string, body: unknown) => Promise<unknown>;
  del: (path: string) => Promise<unknown>;
}

export type SealedBulkAction = { type: 'threshold'; choice: ThresholdChoice } | { type: 'delete' };

/**
 * The server has a bulk endpoint for cards only: sealed products are changed one call each.
 * A failed call does not stop the others; it is reported as skipped with the error message.
 */
export async function bulkSealed(items: SealedTarget[], action: SealedBulkAction, client: SealedBulkApi = api): Promise<BulkResult> {
  const result: BulkResult = { updated: [], skipped: [] };
  for (const item of items) {
    try {
      if (action.type === 'delete') {
        await client.del(`/api/sealed/${item.id}`);
      } else {
        const { choice } = action;
        let cents: number;
        if (choice.mode === 'fixed') cents = choice.cents;
        else if (item.lastPriceCents === null) {
          result.skipped.push({ id: item.id, reason: 'no current price' });
          continue;
        } else cents = percentBelow(item.lastPriceCents, choice.percent);
        await client.put(`/api/sealed/${item.id}`, { languages: item.languages, thresholdCents: cents });
      }
      result.updated.push(item.id);
    } catch (e) {
      result.skipped.push({ id: item.id, reason: (e as Error).message });
    }
  }
  return result;
}
