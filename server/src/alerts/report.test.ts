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
        { kind: 'card', name: 'Ragavan, Nimble Pilferer', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } },
        {
          kind: 'card',
          name: 'Sheoldred, the Apocalypse',
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
        { kind: 'card', name: 'The One Ring', listing: null, event: { kind: 'back_above', priceCents: 7100, thresholdCents: 6500 } },
        { kind: 'card', name: 'Black Lotus', listing: null, event: { kind: 'back_above', priceCents: null, thresholdCents: 100 } },
      ],
      [{ kind: 'card', name: 'Mox Pearl', message: 'HTTP 500 da api.cardtrader.com' }],
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
    expect(buildReport([], [{ kind: 'card', name: 'X', message: 'boom' }], at)).toBe(
      ['🃏 <b>CTZero Tracker</b> — 10/02 06:00 PM', '', '❌ <b>Errors</b>', '• X — boom'].join('\n'),
    );
  });

  it('escapes HTML in dynamic text', () => {
    const text = buildReport(
      [{ kind: 'card', name: 'Fire & Ice <promo>', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } }],
      [{ kind: 'card', name: 'A', message: 'error <html>' }],
      at,
    )!;
    expect(text).toContain('Fire &amp; Ice &lt;promo&gt;');
    expect(text).toContain('error &lt;html&gt;');
    expect(text).not.toContain('<promo>');
  });
  it('formats sealed products with 📦, expansion and language, after cards', () => {
    const sealedListing: Listing = {
      ...listing,
      blueprintId: 279368,
      expansionName: 'Modern Horizons 3',
      condition: '',
      language: 'jp',
      priceCents: 18900,
      url: 'https://www.cardtrader.com/cards/279368',
    };
    const text = buildReport(
      [
        { kind: 'sealed', name: 'Modern Horizons 3: Play Booster Box', listing: sealedListing, event: { kind: 'below', priceCents: 18900, thresholdCents: 20000 } },
        { kind: 'card', name: 'Ragavan, Nimble Pilferer', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } },
        { kind: 'sealed', name: 'Bloomburrow: Play Booster Box', listing: null, event: { kind: 'back_above', priceCents: null, thresholdCents: 15000 } },
      ],
      [{ kind: 'sealed', name: 'Secret Lair x Beadle & Grimm\'s', message: 'boom' }],
      at,
    );
    expect(text).toBe(
      [
        '🃏 <b>CTZero Tracker</b> — 10/02 06:00 PM',
        '',
        '🟢 <b>Below threshold</b>',
        '• Ragavan, Nimble Pilferer (Modern Horizons 2, NM, EN) — €38.50 (threshold €40.00, €1.50 below) → <a href="https://www.cardtrader.com/cards/123">link</a>',
        '• 📦 Modern Horizons 3: Play Booster Box (Modern Horizons 3, JP) — €189.00 (threshold €200.00, €11.00 below) → <a href="https://www.cardtrader.com/cards/279368">link</a>',
        '',
        '🔁 <b>Back above threshold</b>',
        '• 📦 Bloomburrow: Play Booster Box — no valid CT Zero offers (threshold €150.00)',
        '',
        '❌ <b>Errors</b>',
        '• 📦 Secret Lair x Beadle &amp; Grimm\'s — boom',
      ].join('\n'),
    );
  });

  it('omits missing parts instead of leaving empty separators', () => {
    const noLanguage: Listing = { ...listing, condition: '', language: '' };
    const text = buildReport(
      [{ kind: 'sealed', name: 'Box', listing: noLanguage, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } }],
      [],
      at,
    );
    expect(text).toContain('• 📦 Box (Modern Horizons 2) — €38.50');
  });
});

describe('buildFatalMessage', () => {
  it('produces a single escaped alert', () => {
    expect(buildFatalMessage('HTTP 401 <x>', at)).toBe(
      '⚠️ <b>CTZero Tracker</b> — 10/02 06:00 PM\nPrice update failed: HTTP 401 &lt;x&gt;',
    );
  });
});
