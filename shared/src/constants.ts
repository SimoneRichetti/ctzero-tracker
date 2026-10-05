/** Condizioni MTG su CardTrader, dalla migliore alla peggiore. */
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

/** Codici lingua usati da CardTrader (`mtg_language` e parametro `language`). */
export const LANGUAGES = ['en', 'it', 'fr', 'de', 'es', 'pt', 'jp', 'ko', 'ru', 'zh-CN', 'zh-TW'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'Inglese',
  it: 'Italiano',
  fr: 'Francese',
  de: 'Tedesco',
  es: 'Spagnolo',
  pt: 'Portoghese',
  jp: 'Giapponese',
  ko: 'Coreano',
  ru: 'Russo',
  'zh-CN': 'Cinese semplificato',
  'zh-TW': 'Cinese tradizionale',
};
