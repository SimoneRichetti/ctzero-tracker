import { z } from 'zod';
import { CONDITIONS, LANGUAGES, MAX_BULK_IDS, MIN_THRESHOLD_CENTS } from './constants';

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

const thresholdCentsSchema = z.number().int().min(MIN_THRESHOLD_CENTS);

/** `undefined` = leave unchanged (on update), `null` = no group. */
const groupIdSchema = z.number().int().positive().nullable().optional();

export const cardInputSchema = cardFiltersSchema.extend({
  thresholdCents: thresholdCentsSchema,
  groupId: groupIdSchema,
});
export type CardInput = z.infer<typeof cardInputSchema>;

export const cardUpdateSchema = cardInputSchema.omit({ name: true });
export type CardUpdate = z.infer<typeof cardUpdateSchema>;

export const groupInputSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type GroupInput = z.infer<typeof groupInputSchema>;

export const bulkActionSchema = z.union([
  z.object({ type: z.literal('threshold'), mode: z.literal('fixed'), cents: thresholdCentsSchema }),
  z.object({ type: z.literal('threshold'), mode: z.literal('percent'), percent: z.number().min(1).max(90) }),
  z.object({ type: z.literal('group'), groupId: z.number().int().positive().nullable() }),
  z.object({ type: z.literal('delete') }),
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;

export const bulkCardsSchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(MAX_BULK_IDS)
    .transform((a) => [...new Set(a)]),
  action: bulkActionSchema,
});
export type BulkCards = z.infer<typeof bulkCardsSchema>;

export const importResolveSchema = cardFiltersSchema.omit({ expansionIds: true }).extend({
  setCode: z.string().trim().min(1).nullable(),
  /** See DecklistLine.setGuessed: an unknown set falls back to any set instead of failing. */
  setGuessed: z.boolean().default(false),
  respectSet: z.boolean(),
});
export type ImportResolve = z.infer<typeof importResolveSchema>;

export const sealedPreviewSchema = z.object({
  blueprintId: z.number().int().positive(),
  /** Known when picked from an expansion: lets products without listings be resolved. */
  expansionId: z.number().int().positive().optional(),
  languages: languagesSchema,
});
export type SealedPreview = z.infer<typeof sealedPreviewSchema>;

export const sealedInputSchema = sealedPreviewSchema.extend({
  thresholdCents: thresholdCentsSchema,
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
