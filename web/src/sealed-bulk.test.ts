import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { BulkStoppedError } from './bulk-cards';
import { bulkSealed } from './sealed-bulk';

function client() {
  return { put: vi.fn(async () => ({})), del: vi.fn(async () => undefined) };
}

const priced = { id: 1, languages: ['en' as const], lastPriceCents: 20000 };
const unpriced = { id: 2, languages: [], lastPriceCents: null };

describe('bulkSealed', () => {
  it('fixed target: same amount for every product, languages unchanged', async () => {
    const c = client();
    const r = await bulkSealed([priced, unpriced], { type: 'threshold', choice: { mode: 'fixed', cents: 15000 } }, c);
    expect(r).toEqual({ updated: [1, 2], skipped: [] });
    expect(c.put).toHaveBeenCalledWith('/api/sealed/1', { languages: ['en'], thresholdCents: 15000 });
    expect(c.put).toHaveBeenCalledWith('/api/sealed/2', { languages: [], thresholdCents: 15000 });
  });

  it('percent target: below the current price, products without a price skipped', async () => {
    const c = client();
    const r = await bulkSealed([priced, unpriced], { type: 'threshold', choice: { mode: 'percent', percent: 10 } }, c);
    expect(r).toEqual({ updated: [1], skipped: [{ id: 2, reason: 'no current price' }] });
    expect(c.put).toHaveBeenCalledWith('/api/sealed/1', { languages: ['en'], thresholdCents: 18000 });
  });

  it('a product rejected by the server is skipped, the rest done', async () => {
    const c = client();
    c.del.mockRejectedValueOnce(new ApiError(404, 'not found'));
    const r = await bulkSealed([priced, unpriced], { type: 'delete' }, c);
    expect(r).toEqual({ updated: [2], skipped: [{ id: 1, reason: 'not found' }] });
  });

  it('a server or network error on the first product is rethrown, nothing else is tried', async () => {
    const c = client();
    c.del.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(bulkSealed([priced, unpriced], { type: 'delete' }, c)).rejects.toThrow('Failed to fetch');
    expect(c.del).toHaveBeenCalledTimes(1);
  });

  it('a server error part way stops with what went through', async () => {
    const c = client();
    c.del.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(503, 'CardTrader token rejected'));
    const third = { ...priced, id: 3 };
    const err = await bulkSealed([priced, unpriced, third], { type: 'delete' }, c).catch((e) => e);
    expect(err).toBeInstanceOf(BulkStoppedError);
    expect(err.partial).toEqual({ updated: [1], skipped: [] });
    expect(c.del).toHaveBeenCalledTimes(2);
  });
});
