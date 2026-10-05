import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramClient, splitMessage } from './telegram';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('splitMessage', () => {
  it('does not split short messages', () => {
    expect(splitMessage('hello', 10)).toEqual(['hello']);
  });

  it('splits on lines respecting the limit', () => {
    const text = Array.from({ length: 10 }, (_, i) => `riga ${i} ${'x'.repeat(20)}`).join('\n');
    const chunks = splitMessage(text, 70);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(70);
    expect(chunks.join('\n')).toBe(text);
  });

  it('breaks a line longer than the limit', () => {
    expect(splitMessage('a'.repeat(25), 10)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });
});

describe('TelegramClient', () => {
  it('sendMessage sends HTML to the chat id', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await new TelegramClient('BOT', '99', { retryDelayMs: 1 }).sendMessage('<b>hello</b>');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botBOT/sendMessage');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '99',
      text: '<b>hello</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('over 4096 characters sends multiple messages', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    const text = Array.from({ length: 300 }, () => 'x'.repeat(30)).join('\n'); // ~9300 characters
    await new TelegramClient('BOT', '99').sendMessage(text);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('not configured → error without hitting the network', async () => {
    const client = new TelegramClient('', '');
    expect(client.configured).toBe(false);
    await expect(client.sendMessage('x')).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
