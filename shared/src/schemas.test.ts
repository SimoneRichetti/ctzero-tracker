import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  bulkCardsSchema,
  cardInputSchema,
  cardUpdateSchema,
  groupInputSchema,
  importResolveSchema,
  sealedInputSchema,
  sealedPreviewSchema,
  sealedUpdateSchema,
  settingsSchema,
} from './schemas';

const valid = {
  name: 'Lightning Bolt',
  expansionIds: [12],
  languages: ['en', 'it'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 150,
};

describe('cardInputSchema', () => {
  it('accepts valid input', () => {
    expect(cardInputSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts foil = null (any finish) but requires the field', () => {
    expect(cardInputSchema.parse({ ...valid, foil: null }).foil).toBeNull();
    const { foil: _, ...noFoil } = valid;
    expect(cardInputSchema.safeParse(noFoil).success).toBe(false);
  });

  it('rejects thresholds below the minimum or non-integer', () => {
    expect(cardInputSchema.safeParse({ ...valid, thresholdCents: 0 }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...valid, thresholdCents: 10 }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...valid, thresholdCents: 11 }).success).toBe(true);
    expect(cardInputSchema.safeParse({ ...valid, thresholdCents: 1.5 }).success).toBe(false);
  });

  it('rejects unknown languages and conditions', () => {
    expect(cardInputSchema.safeParse({ ...valid, languages: ['xx'] }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...valid, minCondition: 'Good' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(cardInputSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('cardUpdateSchema', () => {
  it('does not include the name', () => {
    const parsed = cardUpdateSchema.parse(valid);
    expect('name' in parsed).toBe(false);
    expect(parsed.thresholdCents).toBe(150);
  });
});

describe('settingsSchema', () => {
  it('accepts the defaults', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('validates time and interval', () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, dailyTime: '24:00' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, dailyTime: '7:00' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, intervalHours: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, intervalHours: 169 }).success).toBe(false);
  });
});

describe('sealed schemas', () => {
  const sealed = { blueprintId: 279368, languages: ['en', 'jp'], thresholdCents: 20000 };

  it('accepts valid input', () => {
    expect(sealedInputSchema.safeParse(sealed).success).toBe(true);
    expect(sealedPreviewSchema.safeParse({ blueprintId: 1, languages: [] }).success).toBe(true);
  });

  it('rejects invalid blueprint ids, thresholds and languages', () => {
    expect(sealedInputSchema.safeParse({ ...sealed, blueprintId: 0 }).success).toBe(false);
    expect(sealedInputSchema.safeParse({ ...sealed, blueprintId: 1.5 }).success).toBe(false);
    expect(sealedInputSchema.safeParse({ ...sealed, thresholdCents: 0 }).success).toBe(false);
    expect(sealedInputSchema.safeParse({ ...sealed, thresholdCents: 10 }).success).toBe(false);
    expect(sealedInputSchema.safeParse({ ...sealed, languages: ['xx'] }).success).toBe(false);
  });

  it('update ignores the blueprint and the expansion', () => {
    expect(sealedUpdateSchema.parse({ ...sealed, expansionId: 3627 })).toEqual({ languages: ['en', 'jp'], thresholdCents: 20000 });
  });

  it('accepts an optional expansion id', () => {
    expect(sealedInputSchema.parse({ ...sealed, expansionId: 3627 })).toEqual({ ...sealed, expansionId: 3627 });
    expect(sealedPreviewSchema.safeParse({ blueprintId: 1, languages: [], expansionId: 0 }).success).toBe(false);
  });
});

describe('list deduplication', () => {
  it('removes duplicate languages and expansions, keeping the first occurrence', () => {
    expect(cardInputSchema.parse({ ...valid, languages: ['en', 'it', 'en'], expansionIds: [12, 12] })).toMatchObject({
      languages: ['en', 'it'],
      expansionIds: [12],
    });
    expect(sealedInputSchema.parse({ blueprintId: 1, languages: ['en', 'en'], thresholdCents: 11 }).languages).toEqual(['en']);
    expect(sealedUpdateSchema.parse({ languages: ['it', 'it'], thresholdCents: 11 }).languages).toEqual(['it']);
  });
});

describe('groupId on cards', () => {
  const base = { name: 'Bolt', expansionIds: [], languages: [], minCondition: 'Near Mint', foil: false, thresholdCents: 100 };

  it('is optional, nullable or a positive id', () => {
    expect(cardInputSchema.parse(base)).not.toHaveProperty('groupId');
    expect(cardInputSchema.parse({ ...base, groupId: null }).groupId).toBeNull();
    expect(cardInputSchema.parse({ ...base, groupId: 3 }).groupId).toBe(3);
    expect(() => cardInputSchema.parse({ ...base, groupId: 0 })).toThrow();
    const { name: _n, ...update } = base;
    expect(cardUpdateSchema.parse({ ...update, groupId: 2 }).groupId).toBe(2);
  });
});

describe('groupInputSchema', () => {
  it('trims and requires 1..80 chars', () => {
    expect(groupInputSchema.parse({ name: '  Atraxa  ' })).toEqual({ name: 'Atraxa' });
    expect(() => groupInputSchema.parse({ name: '   ' })).toThrow();
    expect(() => groupInputSchema.parse({ name: 'x'.repeat(81) })).toThrow();
  });
});

describe('bulkCardsSchema', () => {
  it('accepts every action and deduplicates ids', () => {
    expect(bulkCardsSchema.parse({ ids: [1, 1, 2], action: { type: 'delete' } }).ids).toEqual([1, 2]);
    expect(bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'fixed', cents: 500 } }).action).toEqual({
      type: 'threshold',
      mode: 'fixed',
      cents: 500,
    });
    expect(bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'percent', percent: 10 } }).action).toEqual({
      type: 'threshold',
      mode: 'percent',
      percent: 10,
    });
    expect(bulkCardsSchema.parse({ ids: [1], action: { type: 'group', groupId: null } }).action).toEqual({
      type: 'group',
      groupId: null,
    });
  });

  it('rejects empty or oversized id lists and out-of-range values', () => {
    expect(() => bulkCardsSchema.parse({ ids: [], action: { type: 'delete' } })).toThrow();
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    expect(() => bulkCardsSchema.parse({ ids, action: { type: 'delete' } })).toThrow();
    expect(() => bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'percent', percent: 95 } })).toThrow();
    expect(() => bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'fixed', cents: 0 } })).toThrow();
    expect(() => bulkCardsSchema.parse({ ids: [1], action: { type: 'threshold', mode: 'fixed', cents: 10 } })).toThrow();
  });
});

describe('importResolveSchema', () => {
  it('parses a resolve request', () => {
    const parsed = importResolveSchema.parse({
      name: ' Sol Ring ',
      setCode: null,
      respectSet: false,
      languages: ['en', 'en'],
      minCondition: 'Near Mint',
      foil: false,
    });
    expect(parsed).toEqual({ name: 'Sol Ring', setCode: null, setGuessed: false, respectSet: false, languages: ['en'], minCondition: 'Near Mint', foil: false });
  });
});
