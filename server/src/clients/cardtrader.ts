import type { CtProduct } from './cardtrader-types';
import { HttpError, createThrottle, requestJson } from './http';

export const MTG_GAME_ID = 1;

export interface CtExpansion {
  id: number;
  game_id: number;
  code: string;
  name: string;
}

export interface CtBlueprint {
  id: number;
  name: string;
  expansion_id: number;
  category_id?: number;
  scryfall_id?: string | null;
  image_url?: string | null;
}

export interface CardTraderOptions {
  baseUrl?: string;
  /** Minimum spacing between requests; default 200 ms (5 req/s, below the marketplace limit of 10). */
  throttleMs?: number;
  retryDelayMs?: number;
}

type Params = Record<string, string | number | boolean | undefined>;

export class CardTraderClient {
  private readonly baseUrl: string;
  private readonly throttle: () => Promise<void>;
  private readonly retryDelayMs: number | undefined;

  constructor(
    private readonly token: string,
    opts: CardTraderOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? 'https://api.cardtrader.com/api/v2';
    this.throttle = createThrottle(opts.throttleMs ?? 200);
    this.retryDelayMs = opts.retryDelayMs;
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  private async get<T>(path: string, params: Params = {}): Promise<T> {
    if (!this.configured) throw new HttpError(401, 'CARDTRADER_TOKEN not configured');
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    await this.throttle();
    return requestJson<T>(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
      retryDelayMs: this.retryDelayMs,
    });
  }

  expansions(): Promise<CtExpansion[]> {
    return this.get<CtExpansion[]>('/expansions');
  }

  blueprints(expansionId: number): Promise<CtBlueprint[]> {
    return this.get<CtBlueprint[]>('/blueprints/export', { expansion_id: expansionId });
  }

  /** At most the 25 cheapest listings for the blueprint. */
  async products(blueprintId: number, q: { foil?: boolean; language?: string }): Promise<CtProduct[]> {
    const data = await this.get<Record<string, CtProduct[]>>('/marketplace/products', {
      blueprint_id: blueprintId,
      foil: q.foil,
      language: q.language,
    });
    return data[String(blueprintId)] ?? [];
  }
}
