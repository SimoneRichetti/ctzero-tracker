import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardTraderClient } from './cardtrader';
import { HttpError } from './http';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const client = new CardTraderClient('tok', { throttleMs: 0, retryDelayMs: 1 });

function lastCall(): { url: URL; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: new URL(url as string), init: init as RequestInit };
}

describe('CardTraderClient', () => {
  it('products: URL, token e inserzioni del blueprint richiesto', async () => {
    fetchMock.mockResolvedValueOnce(json({ '42': [{ id: 1 }], '43': [{ id: 2 }] }));
    const res = await client.products(42, { foil: true, language: 'it' });
    expect(res).toEqual([{ id: 1 }]);
    const { url, init } = lastCall();
    expect(url.origin + url.pathname).toBe('https://api.cardtrader.com/api/v2/marketplace/products');
    expect(url.searchParams.get('blueprint_id')).toBe('42');
    expect(url.searchParams.get('foil')).toBe('true');
    expect(url.searchParams.get('language')).toBe('it');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('products senza lingua non passa il parametro e gestisce la chiave mancante', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(client.products(42, { foil: false })).resolves.toEqual([]);
    expect(lastCall().url.searchParams.has('language')).toBe(false);
  });

  it('blueprints passa expansion_id', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: 5, name: 'X', expansion_id: 9, scryfall_id: 's' }]));
    await expect(client.blueprints(9)).resolves.toHaveLength(1);
    const { url } = lastCall();
    expect(url.pathname).toBe('/api/v2/blueprints/export');
    expect(url.searchParams.get('expansion_id')).toBe('9');
  });

  it('expansions', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: 1, game_id: 1, code: 'mh2', name: 'Modern Horizons 2' }]));
    await expect(client.expansions()).resolves.toEqual([{ id: 1, game_id: 1, code: 'mh2', name: 'Modern Horizons 2' }]);
    expect(lastCall().url.pathname).toBe('/api/v2/expansions');
  });

  it('senza token lancia 401 senza chiamare la rete', async () => {
    const noToken = new CardTraderClient('');
    expect(noToken.configured).toBe(false);
    const err = (await noToken.expansions().catch((e: unknown) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
