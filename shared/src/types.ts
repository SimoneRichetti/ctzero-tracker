import type { Condition, Language } from './constants';

export type SyncStatus = 'ok' | 'no_offers' | 'error';
export type AlertState = 'above' | 'below';
export type SyncTrigger = 'manual' | 'scheduled' | 'catchup';
export type RunStatus = 'running' | 'ok' | 'partial' | 'failed';

export interface Listing {
  productId: number;
  blueprintId: number;
  expansionName: string;
  condition: string;
  language: string;
  foil: boolean;
  priceCents: number;
  url: string;
}

export interface TrackedCard {
  id: number;
  name: string;
  scryfallOracleId: string;
  imageUrl: string | null;
  /** Group the card belongs to, null = no group. */
  groupId: number | null;
  /** Selected CardTrader expansions; [] = any. */
  expansionIds: number[];
  /** Names of the selected expansions (empty if "any"). */
  expansionNames: string[];
  /** Expansions whose printings are ignored; only used when `expansionIds` is [] (any). */
  excludedExpansions: ExpansionRef[];
  /** [] = any language. */
  languages: Language[];
  minCondition: Condition;
  /** null = foil or non-foil. */
  foil: boolean | null;
  thresholdCents: number;
  configVersion: number;
  lastPriceCents: number | null;
  lastListing: Listing | null;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus | null;
  lastError: string | null;
  alertState: AlertState | null;
  lastNotifiedPriceCents: number | null;
  blueprintsResolvedAt: string | null;
  /** First price found for the current filters (null = not priced yet): changing the filters resets it. */
  startPriceCents: number | null;
  startPriceAt: string | null;
  /** Copies the user wants to buy; null = not set. */
  quantityNeeded: number | null;
  /** Copies bought while tracking this card (sum of its purchases). */
  boughtQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export type ItemKind = 'card' | 'sealed';

/** Which offers counted for a card when it was bought. */
export interface CardPurchaseRules {
  kind: 'card';
  expansionIds: number[];
  expansionNames: string[];
  /** Expansions ignored with "any expansion"; absent in purchases archived before exclusions existed. */
  excludedExpansions?: ExpansionRef[];
  languages: Language[];
  minCondition: Condition;
  foil: boolean | null;
}

/** Which product and offers counted for a sealed product when it was bought. */
export interface SealedPurchaseRules {
  kind: 'sealed';
  blueprintId: number;
  expansionId: number;
  expansionName: string;
  categoryName: string;
  languages: Language[];
}

export type PurchaseRules = CardPurchaseRules | SealedPurchaseRules;

/**
 * A purchase in the archive: a frozen copy of the item as it was when bought.
 * It survives the item being removed, and the item may keep being tracked.
 */
export interface PurchaseRecord {
  id: number;
  kind: ItemKind;
  /** Id of the tracked card or sealed product; null = no longer tracked (archived). */
  itemId: number | null;
  name: string;
  imageUrl: string | null;
  /** Group of the card when bought. */
  groupName: string | null;
  /** null only for purchases whose item was removed before the rules were recorded. */
  rules: PurchaseRules | null;
  /** Target when bought. */
  thresholdCents: number | null;
  /** CT Zero price and offer when bought. */
  marketPriceCents: number | null;
  listing: Listing | null;
  /** First price with the rules of the time; null if the item had never been priced. */
  startPriceCents: number | null;
  startPriceAt: string | null;
  /** Price paid for each copy. */
  pricePaidCents: number;
  quantity: number;
  /** (startPriceCents − pricePaidCents) × quantity (negative = paid more); null if the start price is unknown. */
  savedCents: number | null;
  purchasedAt: string;
}

/** A purchase with its price history up to the purchase. */
export interface PurchaseDetail extends PurchaseRecord {
  points: { syncedAt: string; priceCents: number | null }[];
}

export interface PurchasesDto {
  /** Newest first. */
  items: PurchaseRecord[];
}

export interface ExpansionRef {
  expansionId: number;
  expansionName: string;
}

/** Result of buying an item: `item` is null when its tracking stopped. */
export interface PurchaseResult<T> {
  purchase: PurchaseRecord;
  item: T | null;
}

export interface CardBlueprint {
  blueprintId: number;
  expansionId: number;
  expansionName: string;
}

export interface Printing {
  expansionId: number;
  expansionName: string;
  code: string;
}

export interface Preset {
  label: string;
  cents: number;
}

export interface PreviewResult {
  priceCents: number | null;
  listing: Listing | null;
  presets: Preset[];
  blueprintCount: number;
}

export interface CardLookupDto {
  name: string;
  imageUrl: string | null;
  printings: Printing[];
}

export interface CardGroup {
  id: number;
  name: string;
  cardCount: number;
  createdAt: string;
}

export interface BulkResult {
  updated: number[];
  skipped: { id: number; reason: string }[];
}

/** One decklist line resolved for the import review. */
export interface ImportResolveResult {
  name: string;
  imageUrl: string | null;
  /** [] = any expansion. */
  expansionIds: number[];
  priceCents: number | null;
  listing: Listing | null;
  /** A card with the same Scryfall oracle id is already tracked. */
  alreadyTracked: boolean;
}

export interface Expansion {
  id: number;
  code: string;
  name: string;
}

/** A sealed product on CardTrader (one blueprint). */
export interface SealedProduct {
  blueprintId: number;
  name: string;
  expansionId: number;
  expansionName: string;
  /** Display name from the sealed category whitelist (e.g. "Booster Box"). */
  categoryName: string;
  imageUrl: string | null;
}

export interface TrackedSealed {
  id: number;
  name: string;
  blueprintId: number;
  expansionId: number;
  expansionName: string;
  categoryName: string;
  imageUrl: string | null;
  /** [] = any language. */
  languages: Language[];
  thresholdCents: number;
  configVersion: number;
  lastPriceCents: number | null;
  lastListing: Listing | null;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus | null;
  lastError: string | null;
  alertState: AlertState | null;
  lastNotifiedPriceCents: number | null;
  /** First price found for the current languages (null = not priced yet): changing them resets it. */
  startPriceCents: number | null;
  startPriceAt: string | null;
  /** Copies the user wants to buy; null = not set. */
  quantityNeeded: number | null;
  /** Copies bought while tracking this product (sum of its purchases). */
  boughtQuantity: number;
  createdAt: string;
  updatedAt: string;
}

/** Recent price trend of a tracked item, current filter configuration only. */
export interface PriceTrend {
  /** Snapshots with a price from the last 30 days, oldest first. */
  sparkline: { t: string; priceCents: number }[];
  /** % change (one decimal) between the latest snapshot and the one ~7 days earlier; null if unknown. */
  change7dPct: number | null;
}

export type TrackedCardRow = TrackedCard & { trend: PriceTrend };
export type TrackedSealedRow = TrackedSealed & { trend: PriceTrend };

export interface PricePoint {
  syncedAt: string;
  /** null = no offers at that time. */
  priceCents: number | null;
  configVersion: number;
}

export interface PriceHistoryDto {
  /** Current threshold (the history does not record past thresholds). */
  thresholdCents: number;
  /** Current filter configuration. */
  configVersion: number;
  /** All snapshots, oldest first. */
  points: PricePoint[];
}

export interface SyncRun {
  id: number;
  trigger: SyncTrigger;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  cardsTotal: number;
  cardsDone: number;
  cardsError: number;
  error: string | null;
  reportSent: boolean;
  reportError: string | null;
}

export interface SyncStatusDto {
  current: SyncRun | null;
  last: SyncRun | null;
  nextRunAt: string | null;
}

export interface HealthDto {
  cardtrader: boolean;
  telegram: boolean;
}
