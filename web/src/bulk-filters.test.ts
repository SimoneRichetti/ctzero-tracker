import type { TrackedCard } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { filterUpdate } from './bulk-filters';

const card = {
  id: 1,
  expansionIds: [],
  excludedExpansions: [{ expansionId: 7, expansionName: 'Secret Lair' }],
  languages: ['en'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 1200,
  groupId: 3,
} as unknown as TrackedCard;

describe('filterUpdate', () => {
  it('keeps the card values for fields not being changed (exclusions included), and never sends groupId', () => {
    expect(filterUpdate(card, { foil: true })).toEqual({
      expansionIds: [],
      excludedExpansionIds: [7],
      languages: ['en'],
      minCondition: 'Near Mint',
      foil: true,
      thresholdCents: 1200,
    });
  });

  it('can set foil to null (any finish)', () => {
    expect(filterUpdate(card, { foil: null }).foil).toBeNull();
    expect(filterUpdate({ ...card, foil: null }, {}).foil).toBeNull();
  });

  it('adds to and removes from the exclusions of "any expansion" cards', () => {
    expect(filterUpdate(card, { excluded: { mode: 'add', expansionIds: [7, 9] } }).excludedExpansionIds).toEqual([7, 9]);
    expect(filterUpdate(card, { excluded: { mode: 'remove', expansionIds: [7] } }).excludedExpansionIds).toEqual([]);
  });

  it('cards with specific expansions keep their exclusions', () => {
    const specific = { ...card, expansionIds: [5], excludedExpansions: [] } as TrackedCard;
    expect(filterUpdate(specific, { excluded: { mode: 'add', expansionIds: [7] } }).excludedExpansionIds).toEqual([]);
  });

  it('replaces the changed fields', () => {
    expect(filterUpdate(card, { languages: [], minCondition: 'Played' })).toMatchObject({ languages: [], minCondition: 'Played' });
  });
});
