import { ApiError } from './api';

export interface BatchOutcome<T, R> {
  results: { item: T; value: R }[];
  errors: { item: T; message: string; status: number | null }[];
  /** Why the batch ended early, if it did. */
  stopped: 'aborted' | 'fatal' | null;
  fatalMessage: string | null;
}

/** The server answers 503 when CardTrader rejects the token: every following call would fail too. */
export function isFatalApiError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 503;
}

/** The server answers 429 when an upstream service (Scryfall) asks us to slow down. */
export function isRateLimitedApiError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 429;
}

export interface BatchOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  isFatal?: (e: unknown) => boolean;
  /** Wait after a rate limit before retrying the same item (default 60 s). */
  pauseMs?: number;
  /** Pauses in a row on the same item before giving up (default 5). */
  maxPauses?: number;
  /** Seconds left in the current pause, every second; null when the pause ends. */
  onPause?: (secondsLeft: number | null) => void;
}

/** Waits `ms`, reporting the seconds left every second. False if aborted meanwhile. */
async function pause(ms: number, signal: AbortSignal | undefined, onPause: BatchOptions['onPause']): Promise<boolean> {
  for (let left = ms; left > 0 && !signal?.aborted; left -= 1000) {
    onPause?.(Math.ceil(left / 1000));
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, left)));
  }
  onPause?.(null);
  return !signal?.aborted;
}

/**
 * Runs `task` on each item, one at a time. Errors are collected and the batch goes on,
 * except for fatal ones. A rate-limited item is retried after a pause.
 * After `signal` is aborted, the running item finishes and the batch stops.
 */
export async function runBatch<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  opts: BatchOptions = {},
): Promise<BatchOutcome<T, R>> {
  const isFatal = opts.isFatal ?? isFatalApiError;
  const pauseMs = opts.pauseMs ?? 60_000;
  const maxPauses = opts.maxPauses ?? 5;
  const out: BatchOutcome<T, R> = { results: [], errors: [], stopped: null, fatalMessage: null };
  let done = 0;
  opts.onProgress?.(0, items.length);
  for (const item of items) {
    if (opts.signal?.aborted) {
      out.stopped = 'aborted';
      break;
    }
    for (let pauses = 0; ; pauses++) {
      try {
        out.results.push({ item, value: await task(item) });
        break;
      } catch (e) {
        const rateLimited = isRateLimitedApiError(e);
        if (rateLimited && pauses < maxPauses) {
          if (await pause(pauseMs, opts.signal, opts.onPause)) continue;
          out.stopped = 'aborted';
          return out;
        }
        const message = e instanceof Error ? e.message : String(e);
        if (rateLimited || isFatal(e)) {
          out.stopped = 'fatal';
          out.fatalMessage = message;
          return out;
        }
        out.errors.push({ item, message, status: e instanceof ApiError ? e.status : null });
        break;
      }
    }
    opts.onProgress?.(++done, items.length);
  }
  return out;
}
