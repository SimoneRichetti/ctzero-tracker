import { z } from 'zod';
import { CONDITIONS, LANGUAGES } from './constants';

export const cardFiltersSchema = z.object({
  name: z.string().trim().min(1),
  expansionIds: z.array(z.number().int().positive()),
  languages: z.array(z.enum(LANGUAGES)),
  minCondition: z.enum(CONDITIONS),
  foil: z.boolean(),
});
export type CardFilters = z.infer<typeof cardFiltersSchema>;

export const cardInputSchema = cardFiltersSchema.extend({
  thresholdCents: z.number().int().positive(),
});
export type CardInput = z.infer<typeof cardInputSchema>;

export const cardUpdateSchema = cardInputSchema.omit({ name: true });
export type CardUpdate = z.infer<typeof cardUpdateSchema>;

export const settingsSchema = z.object({
  scheduleMode: z.enum(['interval', 'daily']),
  intervalHours: z.number().int().min(1).max(168),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  furtherDropPercent: z.number().min(1).max(90),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  scheduleMode: 'interval',
  intervalHours: 6,
  dailyTime: '09:00',
  furtherDropPercent: 5,
};
