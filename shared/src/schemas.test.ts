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
  it('accetta un input valido', () => {
    expect(cardInputSchema.safeParse(valid).success).toBe(true);
  });

  it('rifiuta soglie non positive o non intere', () => {
    expect(cardInputSchema.safeParse({ ...valid, thresholdCents: 0 }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...valid, thresholdCents: 1.5 }).success).toBe(false);
  });

  it('rifiuta lingue e condizioni sconosciute', () => {
    expect(cardInputSchema.safeParse({ ...valid, languages: ['xx'] }).success).toBe(false);
    expect(cardInputSchema.safeParse({ ...valid, minCondition: 'Good' }).success).toBe(false);
  });

  it('rifiuta un nome vuoto', () => {
    expect(cardInputSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('cardUpdateSchema', () => {
  it('non contiene il nome', () => {
    const parsed = cardUpdateSchema.parse(valid);
    expect('name' in parsed).toBe(false);
    expect(parsed.thresholdCents).toBe(150);
  });
});

describe('settingsSchema', () => {
  it('accetta i default', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('valida orario e intervallo', () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, dailyTime: '24:00' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, dailyTime: '7:00' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, intervalHours: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, intervalHours: 169 }).success).toBe(false);
  });
});
