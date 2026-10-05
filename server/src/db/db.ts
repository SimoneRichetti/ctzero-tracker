import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tracked_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scryfall_oracle_id TEXT NOT NULL,
    image_url TEXT,
    expansion_ids TEXT NOT NULL DEFAULT '[]',
    languages TEXT NOT NULL DEFAULT '[]',
    min_condition TEXT NOT NULL,
    foil INTEGER NOT NULL,
    threshold_cents INTEGER NOT NULL,
    config_version INTEGER NOT NULL DEFAULT 1,
    last_price_cents INTEGER,
    last_listing TEXT,
    last_synced_at TEXT,
    last_sync_status TEXT,
    last_error TEXT,
    alert_state TEXT,
    last_notified_price_cents INTEGER,
    blueprints_resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE card_blueprints (
    tracked_card_id INTEGER NOT NULL REFERENCES tracked_cards(id) ON DELETE CASCADE,
    blueprint_id INTEGER NOT NULL,
    expansion_id INTEGER NOT NULL,
    expansion_name TEXT NOT NULL,
    PRIMARY KEY (tracked_card_id, blueprint_id)
  );
  CREATE TABLE price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracked_card_id INTEGER NOT NULL REFERENCES tracked_cards(id) ON DELETE CASCADE,
    config_version INTEGER NOT NULL,
    synced_at TEXT NOT NULL,
    price_cents INTEGER
  );
  CREATE INDEX price_snapshots_card ON price_snapshots(tracked_card_id);
  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    cards_total INTEGER NOT NULL DEFAULT 0,
    cards_done INTEGER NOT NULL DEFAULT 0,
    cards_error INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    report_sent INTEGER NOT NULL DEFAULT 0,
    report_error TEXT
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

const depth = new WeakMap<Db, number>();

/** Esegue `fn` in una transazione; le chiamate annidate riusano quella esterna. */
export function transaction<T>(db: Db, fn: () => T): T {
  const current = depth.get(db) ?? 0;
  if (current > 0) {
    depth.set(db, current + 1);
    try {
      return fn();
    } finally {
      depth.set(db, current);
    }
  }
  db.exec('BEGIN');
  depth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth.set(db, 0);
  }
}
