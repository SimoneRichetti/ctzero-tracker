export class HttpError extends Error {
  constructor(
    /** HTTP status; 0 = network error. */
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Errors that make continuing the run pointless (missing or invalid token). */
export function isFatalHttpError(e: unknown): boolean {
  return e instanceof HttpError && (e.status === 401 || e.status === 403);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  retries?: number;
  retryDelayMs?: number;
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelay = opts.retryDelayMs ?? 500;
  // Only the host in messages: path and query may contain tokens.
  const host = new URL(url).host;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...opts.headers,
  };

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }
      throw new HttpError(0, `Network error contacting ${host}: ${(e as Error).message}`);
    }
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(baseDelay * 2 ** attempt);
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, `HTTP ${res.status} from ${host}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
}

/** Guarantees at least `minIntervalMs` between two consecutive calls. */
export function createThrottle(minIntervalMs: number): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  };
}
