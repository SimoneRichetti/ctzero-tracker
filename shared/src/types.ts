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
  createdAt: string;
  updatedAt: string;
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
