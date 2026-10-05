import type {
  AlertState,
  CardBlueprint,
  Condition,
  Language,
  Listing,
  SyncStatus,
  TrackedCard,
} from '@ctzero/shared';
import { NotFoundError } from '../errors';
import { transaction, type Db } from './db';

type SqlValue = string | number | null;

interface CardRecord {
  id: number;
  name: string;
  scryfall_oracle_id: string;
  image_url: string | null;
  expansion_ids: string;
  languages: string;
  min_condition: string;
  foil: number;
  threshold_cents: number;
  config_version: number;
  last_price_cents: number | null;
  last_listing: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
  alert_state: string | null;
  last_notified_price_cents: number | null;
  blueprints_resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewCard {
  name: string;
  scryfallOracleId: string;
  imageUrl: string | null;
  expansionIds: number[];
  languages: Language[];
  minCondition: Condition;
  foil: boolean;
  thresholdCents: number;
}

export type CardPatch = Partial<Omit<TrackedCard, 'id' | 'createdAt' | 'updatedAt' | 'expansionNames'>>;

const COLUMNS: Record<keyof CardPatch, string> = {
  name: 'name',
  scryfallOracleId: 'scryfall_oracle_id',
  imageUrl: 'image_url',
  expansionIds: 'expansion_ids',
  languages: 'languages',
  minCondition: 'min_condition',
  foil: 'foil',
  thresholdCents: 'threshold_cents',
  configVersion: 'config_version',
  lastPriceCents: 'last_price_cents',
  lastListing: 'last_listing',
  lastSyncedAt: 'last_synced_at',
  lastSyncStatus: 'last_sync_status',
  lastError: 'last_error',
  alertState: 'alert_state',
  lastNotifiedPriceCents: 'last_notified_price_cents',
  blueprintsResolvedAt: 'blueprints_resolved_at',
};

function encode(key: keyof CardPatch, value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (key === 'expansionIds' || key === 'languages' || key === 'lastListing') return JSON.stringify(value);
  if (key === 'foil') return value ? 1 : 0;
  return value as SqlValue;
}

function expansionNames(db: Db, cardId: number): string[] {
  const rows = db
    .prepare('SELECT DISTINCT expansion_name AS name FROM card_blueprints WHERE tracked_card_id = ? ORDER BY expansion_name')
    .all(cardId) as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

function toCard(db: Db, r: CardRecord): TrackedCard {
  const expansionIds = JSON.parse(r.expansion_ids) as number[];
  return {
    id: r.id,
    name: r.name,
    scryfallOracleId: r.scryfall_oracle_id,
    imageUrl: r.image_url,
    expansionIds,
    expansionNames: expansionIds.length > 0 ? expansionNames(db, r.id) : [],
    languages: JSON.parse(r.languages) as Language[],
    minCondition: r.min_condition as Condition,
    foil: r.foil === 1,
    thresholdCents: r.threshold_cents,
    configVersion: r.config_version,
    lastPriceCents: r.last_price_cents,
    lastListing: r.last_listing ? (JSON.parse(r.last_listing) as Listing) : null,
    lastSyncedAt: r.last_synced_at,
    lastSyncStatus: r.last_sync_status as SyncStatus | null,
    lastError: r.last_error,
    alertState: r.alert_state as AlertState | null,
    lastNotifiedPriceCents: r.last_notified_price_cents,
    blueprintsResolvedAt: r.blueprints_resolved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listCards(db: Db): TrackedCard[] {
  const rows = db.prepare('SELECT * FROM tracked_cards ORDER BY name COLLATE NOCASE, id').all() as unknown as CardRecord[];
  return rows.map((r) => toCard(db, r));
}

export function getCard(db: Db, id: number): TrackedCard | null {
  const row = db.prepare('SELECT * FROM tracked_cards WHERE id = ?').get(id) as unknown as CardRecord | undefined;
  return row ? toCard(db, row) : null;
}

export function insertCard(db: Db, c: NewCard, now: Date = new Date()): TrackedCard {
  const iso = now.toISOString();
  const res = db
    .prepare(
      `INSERT INTO tracked_cards
        (name, scryfall_oracle_id, image_url, expansion_ids, languages, min_condition, foil, threshold_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.name,
      c.scryfallOracleId,
      c.imageUrl,
      JSON.stringify(c.expansionIds),
      JSON.stringify(c.languages),
      c.minCondition,
      c.foil ? 1 : 0,
      c.thresholdCents,
      iso,
      iso,
    );
  return getCard(db, Number(res.lastInsertRowid))!;
}

export function updateCard(db: Db, id: number, patch: CardPatch, now: Date = new Date()): TrackedCard {
  const keys = (Object.keys(patch) as (keyof CardPatch)[]).filter((k) => patch[k] !== undefined);
  const sets = [...keys.map((k) => `${COLUMNS[k]} = ?`), 'updated_at = ?'];
  const values: SqlValue[] = [...keys.map((k) => encode(k, patch[k])), now.toISOString()];
  const res = db.prepare(`UPDATE tracked_cards SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  if (Number(res.changes) === 0) throw new NotFoundError('Card not found');
  return getCard(db, id)!;
}

export function deleteCard(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM tracked_cards WHERE id = ?').run(id).changes) > 0;
}

export function getBlueprints(db: Db, cardId: number): CardBlueprint[] {
  return db
    .prepare(
      `SELECT blueprint_id AS blueprintId, expansion_id AS expansionId, expansion_name AS expansionName
       FROM card_blueprints WHERE tracked_card_id = ? ORDER BY blueprint_id`,
    )
    .all(cardId) as unknown as CardBlueprint[];
}

export function replaceBlueprints(db: Db, cardId: number, blueprints: CardBlueprint[]): void {
  transaction(db, () => {
    db.prepare('DELETE FROM card_blueprints WHERE tracked_card_id = ?').run(cardId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO card_blueprints (tracked_card_id, blueprint_id, expansion_id, expansion_name) VALUES (?, ?, ?, ?)',
    );
    for (const b of blueprints) insert.run(cardId, b.blueprintId, b.expansionId, b.expansionName);
  });
}

export interface Snapshot {
  configVersion: number;
  syncedAt: string;
  priceCents: number | null;
}

export function insertSnapshot(db: Db, s: Snapshot & { cardId: number }): void {
  db.prepare('INSERT INTO price_snapshots (tracked_card_id, config_version, synced_at, price_cents) VALUES (?, ?, ?, ?)').run(
    s.cardId,
    s.configVersion,
    s.syncedAt,
    s.priceCents,
  );
}

export function listSnapshots(db: Db, cardId: number): Snapshot[] {
  return db
    .prepare(
      `SELECT config_version AS configVersion, synced_at AS syncedAt, price_cents AS priceCents
       FROM price_snapshots WHERE tracked_card_id = ? ORDER BY id`,
    )
    .all(cardId) as unknown as Snapshot[];
}
