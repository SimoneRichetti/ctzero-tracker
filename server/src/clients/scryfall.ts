import { HttpError, RateLimitError, createThrottle, requestJson } from './http';

export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  set: string;
  set_name: string;
  image_uris?: { small?: string };
  card_faces?: { image_uris?: { small?: string } }[];
}

interface ScryfallList<T> {
  data: T[];
  has_more: boolean;
  next_page?: string;
}

export interface ScryfallOptions {
  baseUrl?: string;
  /** Spacing for endpoints without a stricter limit (Scryfall: 10/second). */
  throttleMs?: number;
  retryDelayMs?: number;
}

/**
 * Scryfall documents 2 requests/second for /cards/named and /cards/search; in practice the budget is
 * shared between them (spacing each one at 500 ms on its own still triggers 429s), so one throttle covers both.
 */
const LIMITED_ENDPOINT_MS = 500;
const LIMITED_ENDPOINTS = new Set(['/cards/named', '/cards/search']);

export function cardImage(c: ScryfallCard): string | null {
  return c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? null;
}

export class ScryfallClient {
  private readonly baseUrl: string;
  private readonly throttle: () => Promise<void>;
  private readonly limitedThrottle = createThrottle(LIMITED_ENDPOINT_MS);
  private readonly retryDelayMs: number | undefined;

  constructor(opts: ScryfallOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.scryfall.com';
    this.throttle = createThrottle(opts.throttleMs ?? 100);
    this.retryDelayMs = opts.retryDelayMs;
  }

  private async get<T>(url: string): Promise<T> {
    await (LIMITED_ENDPOINTS.has(new URL(url).pathname) ? this.limitedThrottle : this.throttle)();
    try {
      return await requestJson<T>(url, {
        headers: { 'User-Agent': 'ctzero-tracker/0.1' },
        retryDelayMs: this.retryDelayMs,
        // A 429 blocks us for 30 seconds: retrying sooner only makes it worse.
        retryRateLimited: false,
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        throw new RateLimitError('Scryfall rate limit reached: wait 30 seconds and try again');
      }
      throw e;
    }
  }

  async autocomplete(q: string): Promise<string[]> {
    const query = q.trim();
    if (query.length < 2) return [];
    const res = await this.get<{ data: string[] }>(`${this.baseUrl}/cards/autocomplete?q=${encodeURIComponent(query)}`);
    return res.data;
  }

  named(name: string): Promise<ScryfallCard> {
    return this.get<ScryfallCard>(`${this.baseUrl}/cards/named?exact=${encodeURIComponent(name)}`);
  }

  /** All printings of the card, following pagination (175 per page). */
  async prints(oracleId: string): Promise<ScryfallCard[]> {
    const out: ScryfallCard[] = [];
    let url: string | undefined =
      `${this.baseUrl}/cards/search?q=${encodeURIComponent(`oracleid:${oracleId}`)}&unique=prints&order=released`;
    while (url) {
      const page: ScryfallList<ScryfallCard> = await this.get<ScryfallList<ScryfallCard>>(url);
      out.push(...page.data);
      url = page.has_more ? page.next_page : undefined;
    }
    return out;
  }
}
