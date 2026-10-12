import { describe, expect, it, vi } from 'vitest';
import { BulkStoppedError, bulkInChunks } from './bulk-cards';

describe('bulkInChunks', () => {
  it('splits the ids and merges the results in order', async () => {
    const send = vi.fn(async (chunk: number[]) => ({
      updated: chunk.filter((id) => id !== 3),
      skipped: chunk.includes(3) ? [{ id: 3, reason: 'not found' }] : [],
    }));
    const result = await bulkInChunks([1, 2, 3, 4, 5], send, 2);
    expect(send.mock.calls.map((c) => c[0])).toEqual([[1, 2], [3, 4], [5]]);
    expect(result).toEqual({ updated: [1, 2, 4, 5], skipped: [{ id: 3, reason: 'not found' }] });
  });

  it('a single request when the ids fit', async () => {
    const send = vi.fn(async (chunk: number[]) => ({ updated: chunk, skipped: [] }));
    await bulkInChunks([1, 2], send, 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a failure on the first chunk is rethrown as is', async () => {
    const error = new Error('boom');
    const send = vi.fn().mockRejectedValueOnce(error);
    await expect(bulkInChunks([1, 2, 3], send, 2)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a later failure stops and reports what was applied', async () => {
    const send = vi.fn().mockResolvedValueOnce({ updated: [1, 2], skipped: [] }).mockRejectedValueOnce(new Error('boom'));
    const err = await bulkInChunks([1, 2, 3, 4, 5], send, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BulkStoppedError);
    expect(err).toMatchObject({ message: 'boom', partial: { updated: [1, 2], skipped: [] } });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
