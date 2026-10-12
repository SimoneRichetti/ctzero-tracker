import type { TrackedCard } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { filterUpdate } from './bulk-filters';

const card = {
  id: 1,
  expansionIds: [5],
  languages: ['en'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 1200,
  groupId: 3,
} as unknown as TrackedCard;

describe('filterUpdate', () => {
  it('keeps the card values for fields not being changed, and never sends groupId', () => {
    expect(filterUpdate(card, { foil: true })).toEqual({
      expansionIds: [5],
      languages: ['en'],
      minCondition: 'Near Mint',
      foil: true,
      thresholdCents: 1200,
    });
  });

  it('replaces the changed fields', () => {
    expect(filterUpdate(card, { languages: [], minCondition: 'Played' })).toMatchObject({ languages: [], minCondition: 'Played' });
  });
});
