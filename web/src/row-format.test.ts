import { describe, expect, it } from 'vitest';
import type { Listing } from '@ctzero/shared';
import { cardMetaLine, cardTraderUrl, formatChange, gapSentence, largeImageUrl, listingLine, savingText, sealedMetaLine, sinceStart, targetGap } from './row-format';

describe('cardMetaLine', () => {
  it('describes the matching rules', () => {
    expect(cardMetaLine({ excludedExpansions: [], expansionNames: [], languages: ['en', 'it'], minCondition: 'Near Mint', foil: false })).toBe(
      'Any expansion · EN, IT · ≥ NM · Non-foil',
    );
    expect(cardMetaLine({ excludedExpansions: [], expansionNames: ['Alliances'], languages: [], minCondition: 'Played', foil: null })).toBe(
      'Alliances · Any language · ≥ PL · Any finish',
    );
  });

  it('mentions the excluded expansions of "any expansion" cards', () => {
    const base = { expansionNames: [], languages: [], minCondition: 'Mint' as const, foil: null };
    const sld = { expansionId: 7, expansionName: 'Secret Lair' };
    expect(cardMetaLine({ ...base, excludedExpansions: [sld] })).toMatch(/^Any expansion except Secret Lair ·/);
    expect(cardMetaLine({ ...base, excludedExpansions: [sld, { expansionId: 8, expansionName: '30th' }] })).toMatch(/^Any expansion except 2 ·/);
  });

  it('shortens long expansion lists', () => {
    expect(cardMetaLine({ excludedExpansions: [], expansionNames: ['A', 'B', 'C'], languages: [], minCondition: 'Mint', foil: true })).toBe(
      'A, +2 more · Any language · ≥ M · Foil',
    );
    expect(cardMetaLine({ excludedExpansions: [], expansionNames: ['A', 'B'], languages: [], minCondition: 'Mint', foil: true })).toMatch(/^A, B ·/);
  });
});

describe('sealedMetaLine', () => {
  it('expansion, category and languages', () => {
    expect(sealedMetaLine({ expansionName: 'Bloomburrow', categoryName: 'Booster Box', languages: ['en'] })).toBe(
      'Bloomburrow · Booster Box · EN',
    );
  });
});

describe('targetGap', () => {
  it('under the target: full bar', () => {
    expect(targetGap({ lastPriceCents: 3180, thresholdCents: 3500 })).toEqual({ under: true, pct: 9.1, fill: 100, text: '9.1% under' });
  });

  it('at the target counts as under', () => {
    expect(targetGap({ lastPriceCents: 1000, thresholdCents: 1000 })).toMatchObject({ under: true, text: '0.0% under' });
  });

  it('above the target: bar filled at target / price', () => {
    expect(targetGap({ lastPriceCents: 1840, thresholdCents: 1500 })).toEqual({ under: false, pct: 22.7, fill: 82, text: '22.7% to go' });
  });

  it('keeps a visible sliver far from the target', () => {
    expect(targetGap({ lastPriceCents: 100000, thresholdCents: 100 })!.fill).toBe(8);
  });

  it('null without a price', () => {
    expect(targetGap({ lastPriceCents: null, thresholdCents: 100 })).toBeNull();
  });
});

describe('gapSentence', () => {
  it('covers under, above and no price', () => {
    expect(gapSentence({ lastPriceCents: 3180, thresholdCents: 3500 })).toBe('9.1% under your target');
    expect(gapSentence({ lastPriceCents: 1840, thresholdCents: 1500 })).toBe('€3.40 to go (22.7%)');
    expect(gapSentence({ lastPriceCents: null, thresholdCents: 1500 })).toMatch(/as soon as an offer/);
  });
});

describe('formatChange', () => {
  it('arrow, one decimal and tone', () => {
    expect(formatChange(-12.3)).toEqual({ text: '↓ 12.3%', tone: 'down' });
    expect(formatChange(5)).toEqual({ text: '↑ 5.0%', tone: 'up' });
    expect(formatChange(0)).toEqual({ text: '0.0%', tone: 'flat' });
    expect(formatChange(null)).toEqual({ text: '—', tone: 'none' });
  });
});

const listing: Listing = {
  productId: 1,
  blueprintId: 2,
  expansionName: 'Modern Horizons 2',
  condition: 'Near Mint',
  language: 'en',
  foil: true,
  priceCents: 100,
  url: 'https://www.cardtrader.com/x',
};

describe('listingLine', () => {
  it('abbreviated condition for cards, language only for sealed', () => {
    expect(listingLine('card', listing)).toBe('Modern Horizons 2 · NM · EN · Foil');
    expect(listingLine('card', { ...listing, foil: false, condition: 'Odd' })).toBe('Modern Horizons 2 · Odd · EN');
    expect(listingLine('sealed', listing)).toBe('EN');
    expect(listingLine('card', null)).toBeNull();
  });
});

describe('largeImageUrl', () => {
  it('swaps the thumbnail for the larger image', () => {
    expect(largeImageUrl('card', 'https://cards.scryfall.io/small/front/a.jpg')).toBe('https://cards.scryfall.io/normal/front/a.jpg');
    expect(largeImageUrl('sealed', 'https://cardtrader.com/uploads/preview_a.jpg')).toBe('https://cardtrader.com/uploads/show_a.jpg');
  });
});

describe('cardTraderUrl', () => {
  it('listing first, then the sealed product page, then the site', () => {
    expect(cardTraderUrl({ lastListing: listing })).toBe('https://www.cardtrader.com/x');
    expect(cardTraderUrl({ lastListing: null, blueprintId: 7 })).toBe('https://www.cardtrader.com/cards/7');
    expect(cardTraderUrl({ lastListing: null })).toBe('https://www.cardtrader.com');
  });
});

describe('sinceStart', () => {
  it('compares the current price with the start price', () => {
    expect(sinceStart({ startPriceCents: 1000, lastPriceCents: 875 })).toBe('now 12.5% lower');
    expect(sinceStart({ startPriceCents: 1000, lastPriceCents: 1100 })).toBe('now 10.0% higher');
    expect(sinceStart({ startPriceCents: 1000, lastPriceCents: 1000 })).toBe('unchanged since');
    expect(sinceStart({ startPriceCents: null, lastPriceCents: 1000 })).toBeNull();
    expect(sinceStart({ startPriceCents: 1000, lastPriceCents: null })).toBeNull();
  });
});

describe('savingText', () => {
  it('words savings and overpayments', () => {
    expect(savingText(300)).toBe('Saved €3.00');
    expect(savingText(-50)).toBe('Paid €0.50 more');
    expect(savingText(0)).toBe('Saved nothing');
    expect(savingText(null)).toBeNull();
  });
});
