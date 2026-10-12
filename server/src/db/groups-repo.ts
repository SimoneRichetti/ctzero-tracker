import type { CardGroup } from '@ctzero/shared';
import { NotFoundError, ValidationError } from '../errors';
import type { Db } from './db';

interface GroupRecord {
  id: number;
  name: string;
  created_at: string;
  card_count: number;
}

const SELECT = `SELECT g.id, g.name, g.created_at, COUNT(c.id) AS card_count
  FROM card_groups g LEFT JOIN tracked_cards c ON c.group_id = g.id`;

function toGroup(r: GroupRecord): CardGroup {
  return { id: r.id, name: r.name, cardCount: r.card_count, createdAt: r.created_at };
}

/** `name` has COLLATE NOCASE, so the comparison is case-insensitive. */
function assertNameFree(db: Db, name: string, exceptId = 0): void {
  if (db.prepare('SELECT 1 FROM card_groups WHERE name = ? AND id != ?').get(name, exceptId) !== undefined) {
    throw new ValidationError(`A group named "${name}" already exists`);
  }
}

export function listGroups(db: Db): CardGroup[] {
  const rows = db.prepare(`${SELECT} GROUP BY g.id ORDER BY g.name COLLATE NOCASE`).all() as unknown as GroupRecord[];
  return rows.map(toGroup);
}

export function getGroup(db: Db, id: number): CardGroup | null {
  const row = db.prepare(`${SELECT} WHERE g.id = ? GROUP BY g.id`).get(id) as unknown as GroupRecord | undefined;
  return row ? toGroup(row) : null;
}

export function insertGroup(db: Db, name: string, now: Date = new Date()): CardGroup {
  assertNameFree(db, name);
  const res = db.prepare('INSERT INTO card_groups (name, created_at) VALUES (?, ?)').run(name, now.toISOString());
  return getGroup(db, Number(res.lastInsertRowid))!;
}

export function renameGroup(db: Db, id: number, name: string): CardGroup {
  if (!getGroup(db, id)) throw new NotFoundError('Group not found');
  assertNameFree(db, name, id);
  db.prepare('UPDATE card_groups SET name = ? WHERE id = ?').run(name, id);
  return getGroup(db, id)!;
}

/** The group's cards stay tracked, without a group (ON DELETE SET NULL). */
export function deleteGroup(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM card_groups WHERE id = ?').run(id).changes) > 0;
}
