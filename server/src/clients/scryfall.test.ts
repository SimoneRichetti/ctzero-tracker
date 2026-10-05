import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScryfallClient, cardImage, type ScryfallCard } from './scryfall';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const client = new ScryfallClient({ throttleMs: 0, retryDelayMs: 1 });
const card = (id: string, set: string): ScryfallCard => ({ id, oracle_id: 'abc', name: 'X', set, set_name: set });

describe('ScryfallClient', () => {
  it('autocomplete con meno di 2 caratteri non chiama la rete', async () => {
    await expect(client.autocomplete(' l ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('autocomplete', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: ['Lightning Bolt'] }));
    await expect(client.autocomplete('light')).resolves.toEqual(['Lightning Bolt']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.scryfall.com/cards/autocomplete?q=light');
    expect((init as RequestInit & { headers: Record<string, string> }).headers['User-Agent']).toBe('ctzero-tracker/0.1');
  });

  it('named codifica il nome', async () => {
    fetchMock.mockResolvedValueOnce(json(card('1', 'mh2')));
    await client.named('Fire // Ice');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.scryfall.com/cards/named?exact=Fire%20%2F%2F%20Ice');
  });

  it('prints segue la paginazione', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: [card('a', 'mh2')], has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2' }),
      )
      .mockResolvedValueOnce(json({ data: [card('b', 'm10')], has_more: false }));
    const prints = await client.prints('abc');
    expect(prints.map((p) => p.id)).toEqual(['a', 'b']);
    const firstUrl = fetchMock.mock.calls[0]![0] as string;
    expect(firstUrl).toContain('q=oracleid%3Aabc');
    expect(firstUrl).toContain('unique=prints');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.scryfall.com/cards/search?page=2');
  });

  it('cardImage usa la prima faccia per le carte doppie', () => {
    expect(cardImage({ ...card('1', 'x'), image_uris: { small: 'front' } })).toBe('front');
    expect(cardImage({ ...card('1', 'x'), card_faces: [{ image_uris: { small: 'face' } }] })).toBe('face');
    expect(cardImage(card('1', 'x'))).toBeNull();
  });
});
