import type { AlertState, Language, Listing, SyncStatus, TrackedSealed } from '@ctzero/shared';
import { NotFoundError } from '../errors';
import { groupSnapshots, type Snapshot } from './cards-repo';
import { transaction, type Db } from './db';
import { PURCHASE_COLUMNS, purchaseJoin, purchaseOf, type PurchaseColumns } from './purchases-repo';

type SqlValue = string | number | null;

interface SealedRecord extends PurchaseColumns {
  id: number;
  name: string;
  blueprint_id: number;
  expansion_id: number;
  expansion_name: string;
  category_name: string;
  image_url: string | null;
  languages: string;
  threshold_cents: number;
  config_version: number;
  last_price_cents: number | null;
  last_listing: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
  alert_state: string | null;
  last_notified_price_cents: number | null;
  start_price_cents: number | null;
  start_price_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewSealed {
  name: string;
  blueprintId: number;
  expansionId: number;
  expansionName: string;
  categoryName: string;
  imageUrl: string | null;
  languages: Language[];
  thresholdCents: number;
}

export type SealedPatch = Partial<Omit<TrackedSealed, 'id' | 'createdAt' | 'updatedAt' | 'purchase'>>;

const COLUMNS: Record<keyof SealedPatch, string> = {
  name: 'name',
  blueprintId: 'blueprint_id',
  expansionId: 'expansion_id',
  expansionName: 'expansion_name',
  categoryName: 'category_name',
  imageUrl: 'image_url',
  languages: 'languages',
  thresholdCents: 'threshold_cents',
  configVersion: 'config_version',
  lastPriceCents: 'last_price_cents',
  lastListing: 'last_listing',
  lastSyncedAt: 'last_synced_at',
  lastSyncStatus: 'last_sync_status',
  lastError: 'last_error',
  alertState: 'alert_state',
  lastNotifiedPriceCents: 'last_notified_price_cents',
  startPriceCents: 'start_price_cents',
  startPriceAt: 'start_price_at',
};

/** Products with their purchase, if any. */
const SELECT_SEALED = `SELECT t.*, ${PURCHASE_COLUMNS} FROM tracked_sealed t ${purchaseJoin('sealed')}`;

function encode(key: keyof SealedPatch, value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (key === 'languages' || key === 'lastListing') return JSON.stringify(value);
  return value as SqlValue;
}

function toSealed(r: SealedRecord): TrackedSealed {
  return {
    id: r.id,
    name: r.name,
    blueprintId: r.blueprint_id,
    expansionId: r.expansion_id,
    expansionName: r.expansion_name,
    categoryName: r.category_name,
    imageUrl: r.image_url,
    languages: JSON.parse(r.languages) as Language[],
    thresholdCents: r.threshold_cents,
    configVersion: r.config_version,
    lastPriceCents: r.last_price_cents,
    lastListing: r.last_listing ? (JSON.parse(r.last_listing) as Listing) : null,
    lastSyncedAt: r.last_synced_at,
    lastSyncStatus: r.last_sync_status as SyncStatus | null,
    lastError: r.last_error,
    alertState: r.alert_state as AlertState | null,
    lastNotifiedPriceCents: r.last_notified_price_cents,
    startPriceCents: r.start_price_cents,
    startPriceAt: r.start_price_at,
    purchase: purchaseOf(r),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listSealed(db: Db): TrackedSealed[] {
  const rows = db.prepare(`${SELECT_SEALED} ORDER BY t.name COLLATE NOCASE, t.id`).all() as unknown as SealedRecord[];
  return rows.map(toSealed);
}

export function getSealed(db: Db, id: number): TrackedSealed | null {
  const row = db.prepare(`${SELECT_SEALED} WHERE t.id = ?`).get(id) as unknown as SealedRecord | undefined;
  return row ? toSealed(row) : null;
}

export function insertSealed(db: Db, s: NewSealed, now: Date = new Date()): TrackedSealed {
  const iso = now.toISOString();
  const res = db
    .prepare(
      `INSERT INTO tracked_sealed
        (name, blueprint_id, expansion_id, expansion_name, category_name, image_url, languages, threshold_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.name,
      s.blueprintId,
      s.expansionId,
      s.expansionName,
      s.categoryName,
      s.imageUrl,
      JSON.stringify(s.languages),
      s.thresholdCents,
      iso,
      iso,
    );
  return getSealed(db, Number(res.lastInsertRowid))!;
}

export function updateSealed(db: Db, id: number, patch: SealedPatch, now: Date = new Date()): TrackedSealed {
  const keys = (Object.keys(patch) as (keyof SealedPatch)[]).filter((k) => patch[k] !== undefined);
  const sets = [...keys.map((k) => `${COLUMNS[k]} = ?`), 'updated_at = ?'];
  const values: SqlValue[] = [...keys.map((k) => encode(k, patch[k])), now.toISOString()];
  const res = db.prepare(`UPDATE tracked_sealed SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  if (Number(res.changes) === 0) throw new NotFoundError('Sealed product not found');
  return getSealed(db, id)!;
}

export function deleteSealed(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM tracked_sealed WHERE id = ?').run(id).changes) > 0;
}

/** Also records the start price of the product, if this is its first price. */
export function insertSealedSnapshot(db: Db, s: Snapshot & { sealedId: number }): void {
  transaction(db, () => {
    db.prepare(
      'INSERT INTO sealed_price_snapshots (tracked_sealed_id, config_version, synced_at, price_cents) VALUES (?, ?, ?, ?)',
    ).run(s.sealedId, s.configVersion, s.syncedAt, s.priceCents);
    if (s.priceCents === null) return;
    db.prepare(
      'UPDATE tracked_sealed SET start_price_cents = ?, start_price_at = ? WHERE id = ? AND start_price_cents IS NULL',
    ).run(s.priceCents, s.syncedAt, s.sealedId);
  });
}

export function listSealedSnapshots(db: Db, sealedId: number): Snapshot[] {
  return db
    .prepare(
      `SELECT config_version AS configVersion, synced_at AS syncedAt, price_cents AS priceCents
       FROM sealed_price_snapshots WHERE tracked_sealed_id = ? ORDER BY id`,
    )
    .all(sealedId) as unknown as Snapshot[];
}

/** Snapshots since `sinceIso` of each product's current configuration, oldest first, keyed by product id. */
export function listRecentSealedSnapshots(db: Db, sinceIso: string): Map<number, Snapshot[]> {
  const rows = db
    .prepare(
      `SELECT s.tracked_sealed_id AS ownerId, s.config_version AS configVersion, s.synced_at AS syncedAt,
              s.price_cents AS priceCents
       FROM sealed_price_snapshots s
       JOIN tracked_sealed t ON t.id = s.tracked_sealed_id AND t.config_version = s.config_version
       WHERE s.synced_at >= ?
       ORDER BY s.id`,
    )
    .all(sinceIso) as unknown as (Snapshot & { ownerId: number })[];
  return groupSnapshots(rows);
}
