import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { isFatalApiError, runBatch } from './batch-runner';

describe('runBatch', () => {
  it('runs in order, reports progress and collects results', async () => {
    const order: number[] = [];
    const onProgress = vi.fn();
    const out = await runBatch([1, 2, 3], async (n) => (order.push(n), n * 10), { onProgress });
    expect(order).toEqual([1, 2, 3]);
    expect(out.results.map((r) => r.value)).toEqual([10, 20, 30]);
    expect(out.stopped).toBeNull();
    expect(onProgress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it('collects errors with their status and keeps going', async () => {
    const out = await runBatch([1, 2, 3], async (n) => {
      if (n === 2) throw new ApiError(404, 'Card "x" not found');
      return n;
    });
    expect(out.results.map((r) => r.item)).toEqual([1, 3]);
    expect(out.errors).toEqual([{ item: 2, message: 'Card "x" not found', status: 404 }]);
  });

  it('stops on a fatal error', async () => {
    const task = vi.fn(async (n: number) => {
      if (n === 2) throw new ApiError(503, 'HTTP 401 from api.cardtrader.com');
      return n;
    });
    const out = await runBatch([1, 2, 3], task);
    expect(task).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ stopped: 'fatal', fatalMessage: 'HTTP 401 from api.cardtrader.com' });
    expect(out.errors).toEqual([]);
  });

  it('abort lets the running item finish, then stops', async () => {
    const controller = new AbortController();
    const out = await runBatch([1, 2, 3], async (n) => {
      if (n === 1) controller.abort();
      return n;
    }, { signal: controller.signal });
    expect(out.results.map((r) => r.item)).toEqual([1]);
    expect(out.stopped).toBe('aborted');
  });

  describe('rate limits', () => {
    const limited = () => new ApiError(429, 'Scryfall rate limit reached: wait 30 seconds and try again');

    it('pauses with a countdown, then retries the same item', async () => {
      vi.useFakeTimers();
      try {
        const task = vi.fn(async (n: number) => n);
        task.mockRejectedValueOnce(limited());
        const onPause = vi.fn();
        const run = runBatch([1, 2], task, { pauseMs: 3000, onPause });
        await vi.advanceTimersByTimeAsync(0);
        expect(task).toHaveBeenCalledTimes(1);
        expect(onPause).toHaveBeenLastCalledWith(3);
        await vi.advanceTimersByTimeAsync(2999);
        expect(task).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        const out = await run;
        expect(onPause.mock.calls.map((c) => c[0])).toEqual([3, 2, 1, null]);
        expect(task.mock.calls.map((c) => c[0])).toEqual([1, 1, 2]);
        expect(out).toMatchObject({ stopped: null, errors: [] });
        expect(out.results.map((r) => r.value)).toEqual([1, 2]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('abort during a pause stops right away', async () => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const task = vi.fn(async (n: number) => n);
        task.mockRejectedValueOnce(limited());
        const run = runBatch([1, 2], task, { pauseMs: 60_000, signal: controller.signal });
        await vi.advanceTimersByTimeAsync(1000);
        controller.abort();
        await vi.advanceTimersByTimeAsync(1000);
        const out = await run;
        expect(out.stopped).toBe('aborted');
        expect(task).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives up as fatal after too many pauses in a row', async () => {
      vi.useFakeTimers();
      try {
        const task = vi.fn(async () => {
          throw limited();
        });
        const run = runBatch([1, 2], task, { pauseMs: 1000, maxPauses: 2 });
        await vi.advanceTimersByTimeAsync(5000);
        const out = await run;
        expect(task).toHaveBeenCalledTimes(3);
        expect(out).toMatchObject({ stopped: 'fatal', fatalMessage: 'Scryfall rate limit reached: wait 30 seconds and try again' });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('isFatalApiError only for 503 ApiErrors', () => {
    expect(isFatalApiError(new ApiError(503, 'x'))).toBe(true);
    expect(isFatalApiError(new ApiError(502, 'x'))).toBe(false);
    expect(isFatalApiError(new Error('x'))).toBe(false);
  });
});
