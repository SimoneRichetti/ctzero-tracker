import { MAX_BULK_IDS, type BulkAction, type BulkResult } from '@ctzero/shared';
import { api } from './api';

/** A chunk failed after earlier ones were applied: `partial` is what went through. */
export class BulkStoppedError extends Error {
  constructor(
    readonly partial: BulkResult,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'BulkStoppedError';
  }
}

/**
 * Sends the ids in chunks the server accepts and merges the results. Each chunk is applied on its own:
 * if one fails, the error is rethrown as is when nothing was applied yet, else as a BulkStoppedError.
 */
export async function bulkInChunks(
  ids: number[],
  send: (chunk: number[]) => Promise<BulkResult>,
  size = MAX_BULK_IDS,
): Promise<BulkResult> {
  const merged: BulkResult = { updated: [], skipped: [] };
  for (let i = 0; i < ids.length; i += size) {
    let r: BulkResult;
    try {
      r = await send(ids.slice(i, i + size));
    } catch (e) {
      throw i === 0 ? e : new BulkStoppedError(merged, e);
    }
    merged.updated.push(...r.updated);
    merged.skipped.push(...r.skipped);
  }
  return merged;
}

export function bulkCards(ids: number[], action: BulkAction): Promise<BulkResult> {
  return bulkInChunks(ids, (chunk) => api.post<BulkResult>('/api/cards/bulk', { ids: chunk, action }));
}
