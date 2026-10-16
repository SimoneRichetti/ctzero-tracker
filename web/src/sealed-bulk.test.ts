import { describe, expect, it, vi } from 'vitest';
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

  it('delete, with a failure reported and the rest done', async () => {
    const c = client();
    c.del.mockRejectedValueOnce(new Error('boom'));
    const r = await bulkSealed([priced, unpriced], { type: 'delete' }, c);
    expect(r).toEqual({ updated: [2], skipped: [{ id: 1, reason: 'boom' }] });
  });
});
