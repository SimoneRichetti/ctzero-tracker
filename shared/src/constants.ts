/** MTG conditions on CardTrader, from best to worst. */
export const CONDITIONS = [
  'Mint',
  'Near Mint',
  'Slightly Played',
  'Moderately Played',
  'Played',
  'Heavily Played',
  'Poor',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_ABBR: Record<Condition, string> = {
  Mint: 'M',
  'Near Mint': 'NM',
  'Slightly Played': 'SP',
  'Moderately Played': 'MP',
  Played: 'PL',
  'Heavily Played': 'HP',
  Poor: 'PO',
};

/** Language codes used by CardTrader (`mtg_language` and the `language` parameter). */
export const LANGUAGES = ['en', 'it', 'fr', 'de', 'es', 'pt', 'jp', 'ko', 'ru', 'zh-CN', 'zh-TW'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  it: 'Italian',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  jp: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
};

/** Choices for the foil filter: null accepts both finishes. */
export const FOIL_OPTIONS: { label: string; value: boolean | null }[] = [
  { label: 'Any', value: null },
  { label: 'Foil only', value: true },
  { label: 'Non-foil only', value: false },
];

/** Lowest threshold allowed: CardTrader Zero listings below this are not worth tracking. */
export const MIN_THRESHOLD_CENTS = 11;

/** Most card ids in one bulk request; the UI splits larger selections. */
export const MAX_BULK_IDS = 500;
