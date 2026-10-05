import type { Listing } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { buildFatalMessage, buildReport } from './report';

const at = new Date(2026, 9, 2, 18, 0); // ora locale: 02/10 18:00
const listing: Listing = {
  productId: 1,
  blueprintId: 123,
  expansionName: 'Modern Horizons 2',
  condition: 'Near Mint',
  language: 'en',
  foil: false,
  priceCents: 3850,
  url: 'https://www.cardtrader.com/cards/123',
};

describe('buildReport', () => {
  it('restituisce null se non ci sono eventi né errori', () => {
    expect(buildReport([], [], at)).toBeNull();
  });

  it('compone tutte le sezioni nell’ordine previsto', () => {
    const text = buildReport(
      [
        { cardName: 'Ragavan, Nimble Pilferer', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } },
        {
          cardName: 'Sheoldred, the Apocalypse',
          listing: {
            ...listing,
            blueprintId: 7,
            expansionName: 'Dominaria United',
            condition: 'Slightly Played',
            language: 'it',
            foil: true,
            priceCents: 5200,
            url: 'https://www.cardtrader.com/cards/7',
          },
          event: { kind: 'further_drop', priceCents: 5200, previousCents: 5800 },
        },
        { cardName: 'The One Ring', listing: null, event: { kind: 'back_above', priceCents: 7100, thresholdCents: 6500 } },
        { cardName: 'Black Lotus', listing: null, event: { kind: 'back_above', priceCents: null, thresholdCents: 100 } },
      ],
      [{ cardName: 'Mox Pearl', message: 'HTTP 500 da api.cardtrader.com' }],
      at,
    );
    expect(text).toBe(
      [
        '🃏 <b>CTZero Tracker</b> — 02/10 18:00',
        '',
        '🟢 <b>Sotto soglia</b>',
        '• Ragavan, Nimble Pilferer (Modern Horizons 2, NM, EN) — 38,50 € (soglia 40,00 €, 1,50 € sotto) → <a href="https://www.cardtrader.com/cards/123">link</a>',
        '',
        '📉 <b>Ulteriore calo</b>',
        '• Sheoldred, the Apocalypse (Dominaria United, SP, IT, foil) — 52,00 € (era 58,00 €) → <a href="https://www.cardtrader.com/cards/7">link</a>',
        '',
        '🔁 <b>Tornato sopra soglia</b>',
        '• The One Ring — 71,00 € (soglia 65,00 €)',
        '• Black Lotus — nessuna offerta CT Zero valida (soglia 1,00 €)',
        '',
        '❌ <b>Errori</b>',
        '• Mox Pearl — HTTP 500 da api.cardtrader.com',
      ].join('\n'),
    );
  });

  it('omette le sezioni vuote', () => {
    expect(buildReport([], [{ cardName: 'X', message: 'boom' }], at)).toBe(
      ['🃏 <b>CTZero Tracker</b> — 02/10 18:00', '', '❌ <b>Errori</b>', '• X — boom'].join('\n'),
    );
  });

  it("fa l'escape dell'HTML nei testi dinamici", () => {
    const text = buildReport(
      [{ cardName: 'Fire & Ice <promo>', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } }],
      [{ cardName: 'A', message: 'errore <html>' }],
      at,
    )!;
    expect(text).toContain('Fire &amp; Ice &lt;promo&gt;');
    expect(text).toContain('errore &lt;html&gt;');
    expect(text).not.toContain('<promo>');
  });
});

describe('buildFatalMessage', () => {
  it('produce un avviso unico con escape', () => {
    expect(buildFatalMessage('HTTP 401 <x>', at)).toBe(
      '⚠️ <b>CTZero Tracker</b> — 02/10 18:00\nAggiornamento prezzi fallito: HTTP 401 &lt;x&gt;',
    );
  });
});
