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
  it('non divide i messaggi corti', () => {
    expect(splitMessage('ciao', 10)).toEqual(['ciao']);
  });

  it('divide sulle righe rispettando il limite', () => {
    const text = Array.from({ length: 10 }, (_, i) => `riga ${i} ${'x'.repeat(20)}`).join('\n');
    const chunks = splitMessage(text, 70);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(70);
    expect(chunks.join('\n')).toBe(text);
  });

  it('spezza una riga più lunga del limite', () => {
    expect(splitMessage('a'.repeat(25), 10)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });
});

describe('TelegramClient', () => {
  it('sendMessage invia HTML al chat id', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await new TelegramClient('BOT', '99', { retryDelayMs: 1 }).sendMessage('<b>ciao</b>');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botBOT/sendMessage');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '99',
      text: '<b>ciao</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('oltre 4096 caratteri invia più messaggi', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    const text = Array.from({ length: 300 }, () => 'x'.repeat(30)).join('\n'); // ~9300 caratteri
    await new TelegramClient('BOT', '99').sendMessage(text);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('non configurato → errore senza chiamare la rete', async () => {
    const client = new TelegramClient('', '');
    expect(client.configured).toBe(false);
    await expect(client.sendMessage('x')).rejects.toThrow(/non configurato/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
