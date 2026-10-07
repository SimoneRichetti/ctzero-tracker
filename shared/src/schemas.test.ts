import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  cardInputSchema,
  cardUpdateSchema,
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

  it('rejects non-positive or non-integer thresholds', () => {
    expect(cardInputSchema.safeParse({ ...valid, thresholdCents: 0 }).success).toBe(false);
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
    expect(sealedInputSchema.parse({ blueprintId: 1, languages: ['en', 'en'], thresholdCents: 1 }).languages).toEqual(['en']);
    expect(sealedUpdateSchema.parse({ languages: ['it', 'it'], thresholdCents: 1 }).languages).toEqual(['it']);
  });
});
