import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../errors';
import { getCard, insertCard, updateCard, type NewCard } from './cards-repo';
import { openDb, type Db } from './db';
import { deleteGroup, getGroup, insertGroup, listGroups, renameGroup } from './groups-repo';

const t0 = new Date('2026-10-09T10:00:00.000Z');
const card: NewCard = {
  name: 'Sol Ring',
  scryfallOracleId: 'o-sol',
  imageUrl: null,
  expansionIds: [],
  languages: [],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 100,
};

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('groups-repo', () => {
  it('insert + list sorted by name with card counts', () => {
    const b = insertGroup(db, 'Wishlist', t0);
    const a = insertGroup(db, 'atraxa', t0);
    insertCard(db, { ...card, groupId: b.id });
    insertCard(db, { ...card, name: 'Arcane Signet', groupId: b.id });
    insertCard(db, card);
    expect(listGroups(db)).toEqual([
      { id: a.id, name: 'atraxa', cardCount: 0, createdAt: t0.toISOString() },
      { id: b.id, name: 'Wishlist', cardCount: 2, createdAt: t0.toISOString() },
    ]);
  });

  it('names are unique case-insensitively, on insert and rename', () => {
    const a = insertGroup(db, 'Atraxa');
    expect(() => insertGroup(db, 'ATRAXA')).toThrow(ValidationError);
    const b = insertGroup(db, 'Wishlist');
    expect(() => renameGroup(db, b.id, 'atraxa')).toThrow(ValidationError);
    expect(renameGroup(db, a.id, 'ATRAXA').name).toBe('ATRAXA');
  });

  it('rename of a nonexistent group → NotFoundError', () => {
    expect(() => renameGroup(db, 99, 'X')).toThrow(NotFoundError);
  });

  it('delete keeps the cards, without a group', () => {
    const g = insertGroup(db, 'Deck');
    const c = insertCard(db, { ...card, groupId: g.id });
    expect(deleteGroup(db, g.id)).toBe(true);
    expect(getGroup(db, g.id)).toBeNull();
    expect(getCard(db, c.id)?.groupId).toBeNull();
    expect(deleteGroup(db, g.id)).toBe(false);
  });

  it('updateCard can set and clear the group', () => {
    const g = insertGroup(db, 'Deck');
    const c = insertCard(db, card);
    expect(c.groupId).toBeNull();
    expect(updateCard(db, c.id, { groupId: g.id }).groupId).toBe(g.id);
    expect(updateCard(db, c.id, { groupId: null }).groupId).toBeNull();
  });
});
