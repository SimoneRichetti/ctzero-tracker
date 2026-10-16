import { percentBelow, type BulkResult, type TrackedSealed } from '@ctzero/shared';
import { ApiError, api } from './api';
import { BulkStoppedError } from './bulk-cards';
import type { ThresholdChoice } from './threshold-choice';

type SealedTarget = Pick<TrackedSealed, 'id' | 'languages' | 'lastPriceCents'>;

export interface SealedBulkApi {
  put: (path: string, body: unknown) => Promise<unknown>;
  del: (path: string) => Promise<unknown>;
}

export type SealedBulkAction = { type: 'threshold'; choice: ThresholdChoice } | { type: 'delete' };

/** Errors that would hit every following call too: network down, server errors, rate limits. */
function stopsTheBatch(e: unknown): boolean {
  return !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
}

/**
 * The server has a bulk endpoint for cards only: sealed products are changed one call each.
 * A call rejected for that product (4xx, e.g. already deleted) is reported as skipped and the others go on.
 * An error that would hit every call stops the batch, like the cards' bulk: it is rethrown as is when nothing
 * was done yet, else as a BulkStoppedError carrying what went through.
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
      if (stopsTheBatch(e)) {
        if (result.updated.length === 0 && result.skipped.length === 0) throw e;
        throw new BulkStoppedError(result, e);
      }
      result.skipped.push({ id: item.id, reason: (e as Error).message });
    }
  }
  return result;
}
