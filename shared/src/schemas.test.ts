import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, cardInputSchema, cardUpdateSchema, settingsSchema } from './schemas';

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
