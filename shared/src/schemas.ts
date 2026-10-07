import { z } from 'zod';
import { CONDITIONS, LANGUAGES } from './constants';

/** A list without duplicates: repeated values are dropped, keeping the first occurrence. */
const uniqueArray = <T extends z.ZodType>(item: T) => z.array(item).transform((a) => [...new Set(a)]);
const languagesSchema = uniqueArray(z.enum(LANGUAGES));

export const cardFiltersSchema = z.object({
  name: z.string().trim().min(1),
  expansionIds: uniqueArray(z.number().int().positive()),
  languages: languagesSchema,
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

export const sealedPreviewSchema = z.object({
  blueprintId: z.number().int().positive(),
  /** Known when picked from an expansion: lets products without listings be resolved. */
  expansionId: z.number().int().positive().optional(),
  languages: languagesSchema,
});
export type SealedPreview = z.infer<typeof sealedPreviewSchema>;

export const sealedInputSchema = sealedPreviewSchema.extend({
  thresholdCents: z.number().int().positive(),
});
export type SealedInput = z.infer<typeof sealedInputSchema>;

export const sealedUpdateSchema = sealedInputSchema.omit({ blueprintId: true, expansionId: true });
export type SealedUpdate = z.infer<typeof sealedUpdateSchema>;

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
