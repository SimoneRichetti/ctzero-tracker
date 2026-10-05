import type { Listing } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { buildFatalMessage, buildReport } from './report';

const at = new Date(2026, 9, 2, 18, 0); // local time: 10/02 06:00 PM
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
  it('returns null when there are no events or errors', () => {
    expect(buildReport([], [], at)).toBeNull();
  });

  it('builds all sections in the expected order', () => {
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
        '🃏 <b>CTZero Tracker</b> — 10/02 06:00 PM',
        '',
        '🟢 <b>Below threshold</b>',
        '• Ragavan, Nimble Pilferer (Modern Horizons 2, NM, EN) — €38.50 (threshold €40.00, €1.50 below) → <a href="https://www.cardtrader.com/cards/123">link</a>',
        '',
        '📉 <b>Further drop</b>',
        '• Sheoldred, the Apocalypse (Dominaria United, SP, IT, foil) — €52.00 (was €58.00) → <a href="https://www.cardtrader.com/cards/7">link</a>',
        '',
        '🔁 <b>Back above threshold</b>',
        '• The One Ring — €71.00 (threshold €65.00)',
        '• Black Lotus — no valid CT Zero offers (threshold €1.00)',
        '',
        '❌ <b>Errors</b>',
        '• Mox Pearl — HTTP 500 da api.cardtrader.com',
      ].join('\n'),
    );
  });

  it('omits empty sections', () => {
    expect(buildReport([], [{ cardName: 'X', message: 'boom' }], at)).toBe(
      ['🃏 <b>CTZero Tracker</b> — 10/02 06:00 PM', '', '❌ <b>Errors</b>', '• X — boom'].join('\n'),
    );
  });

  it('escapes HTML in dynamic text', () => {
    const text = buildReport(
      [{ cardName: 'Fire & Ice <promo>', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } }],
      [{ cardName: 'A', message: 'error <html>' }],
      at,
    )!;
    expect(text).toContain('Fire &amp; Ice &lt;promo&gt;');
    expect(text).toContain('error &lt;html&gt;');
    expect(text).not.toContain('<promo>');
  });
});

describe('buildFatalMessage', () => {
  it('produces a single escaped alert', () => {
    expect(buildFatalMessage('HTTP 401 <x>', at)).toBe(
      '⚠️ <b>CTZero Tracker</b> — 10/02 06:00 PM\nPrice update failed: HTTP 401 &lt;x&gt;',
    );
  });
});
