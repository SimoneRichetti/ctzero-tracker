import { MAX_BULK_IDS, type BulkAction, type BulkResult } from '@ctzero/shared';
import { api } from './api';

/** Sends the ids in chunks the server accepts and merges the results; stops at the first failed chunk. */
export async function bulkInChunks(
  ids: number[],
  send: (chunk: number[]) => Promise<BulkResult>,
  size = MAX_BULK_IDS,
): Promise<BulkResult> {
  const merged: BulkResult = { updated: [], skipped: [] };
  for (let i = 0; i < ids.length; i += size) {
    const r = await send(ids.slice(i, i + size));
    merged.updated.push(...r.updated);
    merged.skipped.push(...r.skipped);
  }
  return merged;
}

export function bulkCards(ids: number[], action: BulkAction): Promise<BulkResult> {
  return bulkInChunks(ids, (chunk) => api.post<BulkResult>('/api/cards/bulk', { ids: chunk, action }));
}
