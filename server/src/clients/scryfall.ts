import { createThrottle, requestJson } from './http';

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
  /** Scryfall chiede 50–100 ms tra le richieste. */
  throttleMs?: number;
  retryDelayMs?: number;
}

export function cardImage(c: ScryfallCard): string | null {
  return c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? null;
}

export class ScryfallClient {
  private readonly baseUrl: string;
  private readonly throttle: () => Promise<void>;
  private readonly retryDelayMs: number | undefined;

  constructor(opts: ScryfallOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.scryfall.com';
    this.throttle = createThrottle(opts.throttleMs ?? 100);
    this.retryDelayMs = opts.retryDelayMs;
  }

  private async get<T>(url: string): Promise<T> {
    await this.throttle();
    return requestJson<T>(url, { headers: { 'User-Agent': 'ctzero-tracker/0.1' }, retryDelayMs: this.retryDelayMs });
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

  /** Tutte le stampe della carta, seguendo la paginazione (175 per pagina). */
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
