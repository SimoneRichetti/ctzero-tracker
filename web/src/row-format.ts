import { CONDITION_ABBR, formatEuro, type Condition, type Listing, type TrackedCard, type TrackedSealed } from '@ctzero/shared';
import type { PricedItem } from './card-status';

function languageList(codes: string[]): string {
  return codes.length > 0 ? codes.map((c) => c.toUpperCase()).join(', ') : 'Any language';
}

function finish(foil: boolean | null): string {
  return foil === null ? 'Any finish' : foil ? 'Foil' : 'Non-foil';
}

/** One-line summary of which offers count for a card, e.g. "Any expansion · EN, IT · ≥ NM · Non-foil". */
export function cardMetaLine(card: Pick<TrackedCard, 'expansionNames' | 'languages' | 'minCondition' | 'foil'>): string {
  const names = card.expansionNames;
  const expansions = names.length === 0 ? 'Any expansion' : names.length <= 2 ? names.join(', ') : `${names[0]}, +${names.length - 1} more`;
  return [expansions, languageList(card.languages), `≥ ${CONDITION_ABBR[card.minCondition]}`, finish(card.foil)].join(' · ');
}

export function sealedMetaLine(item: Pick<TrackedSealed, 'expansionName' | 'categoryName' | 'languages'>): string {
  return [item.expansionName, item.categoryName, languageList(item.languages)].join(' · ');
}

export interface TargetGap {
  /** The price is at or under the target. */
  under: boolean;
  /** Distance from the target in %, one decimal, always positive. */
  pct: number;
  /** Fill of the gap bar, 0–100: full when under the target, else target / price. */
  fill: number;
  text: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function targetGap(item: Pick<PricedItem, 'lastPriceCents' | 'thresholdCents'>): TargetGap | null {
  const price = item.lastPriceCents;
  if (price === null) return null;
  const pct = round1(Math.abs(((price - item.thresholdCents) / item.thresholdCents) * 100));
  const under = price <= item.thresholdCents;
  const fill = under ? 100 : Math.max(8, Math.round((item.thresholdCents / price) * 100));
  return { under, pct, fill, text: `${pct.toFixed(1)}% ${under ? 'under' : 'to go'}` };
}

/** Longer wording of the gap for the detail panel. */
export function gapSentence(item: Pick<PricedItem, 'lastPriceCents' | 'thresholdCents'>): string {
  const gap = targetGap(item);
  if (!gap) return 'The alert fires as soon as an offer is at or under it';
  if (gap.under) return `${gap.pct.toFixed(1)}% under your target`;
  return `${formatEuro(item.lastPriceCents! - item.thresholdCents)} to go (${gap.pct.toFixed(1)}%)`;
}

export type ChangeTone = 'down' | 'up' | 'flat' | 'none';

/** 7-day change: a falling price is good news for a buyer. The arrow keeps it readable without colour. */
export function formatChange(pct: number | null): { text: string; tone: ChangeTone } {
  if (pct === null) return { text: '—', tone: 'none' };
  if (pct === 0) return { text: '0.0%', tone: 'flat' };
  return { text: `${pct < 0 ? '↓' : '↑'} ${Math.abs(pct).toFixed(1)}%`, tone: pct < 0 ? 'down' : 'up' };
}

export type ItemKind = 'card' | 'sealed';

/** The listing that set the current price, e.g. "Modern Horizons 2 · NM · EN · Foil"; sealed products only show the language. */
export function listingLine(kind: ItemKind, listing: Listing | null): string | null {
  if (!listing) return null;
  if (kind === 'sealed') return listing.language ? listing.language.toUpperCase() : null;
  const condition = CONDITION_ABBR[listing.condition as Condition] ?? listing.condition;
  return [listing.expansionName, condition, listing.language.toUpperCase(), listing.foil ? 'Foil' : null].filter(Boolean).join(' · ');
}

/** Stored images are small thumbnails: Scryfall "small" → "normal", CardTrader "preview_" → "show_". */
export function largeImageUrl(kind: ItemKind, url: string): string {
  return kind === 'card' ? url.replace('/small/', '/normal/') : url.replace('/preview_', '/show_');
}

/** The listing on CardTrader, else the product page for sealed (one blueprint) or the site for cards (many printings). */
export function cardTraderUrl(item: { lastListing: Listing | null; blueprintId?: number }): string {
  if (item.lastListing) return item.lastListing.url;
  return item.blueprintId !== undefined ? `https://www.cardtrader.com/cards/${item.blueprintId}` : 'https://www.cardtrader.com';
}
