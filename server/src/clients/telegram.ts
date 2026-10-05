import { requestJson } from './http';

export const TELEGRAM_MAX_LENGTH = 4096;

/** Divide il testo sui confini di riga; spezza solo le righe più lunghe del limite. */
export function splitMessage(text: string, max = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    let rest = line;
    while (rest.length > max) {
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    current = rest;
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface TelegramOptions {
  baseUrl?: string;
  retryDelayMs?: number;
}

export class TelegramClient {
  private readonly baseUrl: string;
  private readonly retryDelayMs: number | undefined;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    opts: TelegramOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? 'https://api.telegram.org';
    this.retryDelayMs = opts.retryDelayMs;
  }

  get configured(): boolean {
    return this.botToken.length > 0 && this.chatId.length > 0;
  }

  async sendMessage(html: string): Promise<void> {
    if (!this.configured) throw new Error('Telegram non configurato (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
    for (const chunk of splitMessage(html)) {
      await requestJson(`${this.baseUrl}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        body: {
          chat_id: this.chatId,
          text: chunk,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        },
        retryDelayMs: this.retryDelayMs,
      });
    }
  }
}
