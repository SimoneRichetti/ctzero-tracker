import { describe, expect, it, vi } from 'vitest';
import { bulkInChunks } from './bulk-cards';

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

  it('stops at the first failed chunk', async () => {
    const send = vi.fn().mockResolvedValueOnce({ updated: [1, 2], skipped: [] }).mockRejectedValueOnce(new Error('boom'));
    await expect(bulkInChunks([1, 2, 3, 4, 5], send, 2)).rejects.toThrow('boom');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
