# CTZero Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tool locale che traccia il prezzo minimo CardTrader Zero di carte Magic, notifica via Telegram i cali sotto soglia e offre una UI web per gestire le carte e lanciare aggiornamenti.

**Architecture:** Un unico processo Node (Fastify) su `localhost:3000` espone l'API REST, serve la UI Vue buildata ed esegue lo scheduler (setTimeout). Persistenza su SQLite tramite `node:sqlite`. La logica (filtro inserzioni, regole di notifica, report, pianificazione) è in funzioni pure; i client HTTP (CardTrader, Scryfall, Telegram) non contengono logica.

**Tech Stack:** Node 24, TypeScript 5.9, npm workspaces, Fastify 5, `node:sqlite`, zod 4, Vitest 5, tsx, Vue 3.5 + Vite 8 + PrimeVue 4 (tema Aura), vue-router 4.

**Spec:** `docs/superpowers/specs/2026-10-02-ctzero-tracker-design.md`

## Global Constraints

- **Nessun `git commit`.** L'utente committa solo quando lo chiede esplicitamente. Nessun task termina con un commit: si lascia il working tree con le modifiche pronte.
- Node ≥ 24 (serve `node:sqlite` e `process.loadEnvFile`). Verificato: v24.12.0.
- Versioni: `typescript ~5.9.3` (non la 7: incompatibile con vue-tsc), `primevue ^4.5.5` + `@primeuix/themes ^1.2.5` + `primeicons ^7.0.0` (PrimeVue 5 richiede un license manager), `vue-router ^4.6.4`, `fastify ^5.12.5`, `@fastify/static ^10.1.5`, `zod ^4.6.5`, `vitest ^5.0.3`, `tsx ^4.23.15`, `vite ^8.3.2`, `@vitejs/plugin-vue ^6.0.9`, `vue-tsc ^3.3.12`, `@types/node ^24.19.1`.
- **Nessuna libreria aziendale** (niente FuturaUI / `@expertai/*`): è un progetto personale.
- **CT Zero è una regola assoluta:** un'inserzione è considerata solo se `user.can_sell_via_hub === true`.
- Prezzi sempre in **centesimi di euro interi**; solo inserzioni con `price.currency === "EUR"`.
- Testi UI e messaggi Telegram in **italiano**; identificatori nel codice in inglese.
- Il server ascolta solo su `127.0.0.1`.
- I segreti stanno solo in `.env` (ignorato da git) e non devono mai comparire in messaggi d'errore o log (il token Telegram è nel path dell'URL: i messaggi d'errore HTTP riportano solo l'host).
- Telegram: `parse_mode: "HTML"`; ogni testo dinamico va passato da `escapeHtml`.

### Scostamenti dalla spec (decisi in fase di plan, la spec va aggiornata di conseguenza)
- `node:sqlite` (built-in) con SQL scritto a mano al posto di better-sqlite3 + Drizzle: nessuna dipendenza nativa da compilare su WSL, schema piccolo.
- Scheduler con `setTimeout` + funzione pura `nextRunAt` al posto di croner: "ogni N ore" con N che non divide 24 non è esprimibile in cron.
- La pianificazione si basa sull'ultimo giro **terminato con qualunque esito** (anche `failed`), così un token errato non provoca giri a ripetizione; i giri orfani vengono chiusi con `finished_at = started_at`, così il recupero all'avvio scatta comunque.
- `TrackedCard` espone anche `expansionNames: string[]` (nomi delle espansioni selezionate, per la UI).

## Review Focus

1. **Report Telegram più lungo di 4096 caratteri** (molte carte che scendono insieme) → deve essere diviso in più messaggi sui confini di riga, non rifiutato da Telegram. Test in Task 5 (`splitMessage`, `sendMessage` multiplo).
2. **Nomi di carte con caratteri HTML** (`&`, `<`, `>`, es. "Fire & Ice" o nomi con "//") → il report deve restare HTML valido e i nomi vanno codificati correttamente nelle query Scryfall. Test in Task 4 (escape) e Task 5 (`named('Fire // Ice')`).
3. **Carta eliminata dalla UI mentre un giro è in corso** → il giro la salta senza errori e senza fallire. Test in Task 9.
4. **Processo chiuso a metà giro** (PC spento, Ctrl+C) → al riavvio il giro orfano non blocca nuovi giri e il recupero all'avvio parte. Test in Task 6 (`failOrphanRuns`) e Task 10.
5. **Carte con moltissime stampe** (>175, es. Lightning Bolt, terre base) → la ricerca delle stampe deve seguire la paginazione di Scryfall. Test in Task 5 (`prints` con `next_page`).

---

## Mappa dei file

```
ctzero-tracker/
├── package.json                 workspaces + script root
├── tsconfig.json                typecheck di shared + server
├── vitest.config.ts             test di tutti i workspace
├── .gitignore, .env.example, README.md
├── shared/
│   ├── package.json
│   └── src/
│       ├── index.ts             re-export
│       ├── constants.ts         condizioni, lingue, etichette
│       ├── schemas.ts           schemi zod (input carta, impostazioni) + default
│       ├── types.ts             DTO condivisi (TrackedCard, SyncRun, ...)
│       └── money.ts             formatEuro, euroToCents
├── server/
│   ├── package.json
│   └── src/
│       ├── main.ts              bootstrap: env, db, servizi, listen, scheduler
│       ├── errors.ts            NotFoundError, ValidationError, errorMessage
│       ├── test-utils.ts        makeProduct per i test
│       ├── clients/
│       │   ├── http.ts          requestJson con retry, HttpError, throttle
│       │   ├── cardtrader-types.ts
│       │   ├── cardtrader.ts
│       │   ├── scryfall.ts
│       │   └── telegram.ts      sendMessage + splitMessage
│       ├── db/
│       │   ├── db.ts            openDb, migrazioni, transaction
│       │   ├── cards-repo.ts    tracked_cards, card_blueprints, price_snapshots
│       │   ├── runs-repo.ts     sync_runs
│       │   └── settings-repo.ts settings
│       ├── catalog/catalog.ts   Scryfall → espansioni → blueprint CardTrader
│       ├── pricing/
│       │   ├── listings.ts      filtro inserzioni + più economica (puro)
│       │   ├── presets.ts       preset soglia (puro)
│       │   └── card-pricer.ts   chiama il marketplace per i blueprint di una carta
│       ├── alerts/
│       │   ├── rules.ts         regole di notifica (puro)
│       │   └── report.ts        testo HTML del report (puro)
│       ├── cards/card-service.ts  create/update/delete/preview + valutazione silenziosa
│       ├── sync/sync-service.ts   giro di aggiornamento
│       ├── scheduler/
│       │   ├── schedule.ts      nextRunAt (puro)
│       │   └── scheduler.ts     timer
│       └── api/app.ts           rotte Fastify + static
└── web/
    ├── package.json, index.html, vite.config.ts, tsconfig.json
    └── src/
        ├── main.ts, App.vue, router.ts, style.css, api.ts
        ├── card-status.ts       stato/ordinamento/format per la tabella (puro, testato)
        ├── pages/CardsPage.vue, pages/SettingsPage.vue
        └── components/HealthBanner.vue, SyncHeader.vue, CardDialog.vue
```

---

### Task 1: Monorepo e pacchetto `shared`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `shared/package.json`, `shared/src/{index,constants,schemas,types,money}.ts`
- Create: `server/package.json`
- Test: `shared/src/money.test.ts`, `shared/src/schemas.test.ts`

**Interfaces:**
- Produces (da `@ctzero/shared`):
  - `CONDITIONS` (tuple ordinata dalla migliore), `type Condition`, `CONDITION_ABBR: Record<Condition,string>`, `LANGUAGES`, `type Language`, `LANGUAGE_LABELS`
  - `cardFiltersSchema`, `cardInputSchema`, `cardUpdateSchema`, `settingsSchema`, `DEFAULT_SETTINGS`, tipi `CardFilters`, `CardInput`, `CardUpdate`, `Settings`
  - tipi `SyncStatus`, `AlertState`, `SyncTrigger`, `RunStatus`, `Listing`, `TrackedCard`, `CardBlueprint`, `Printing`, `Preset`, `PreviewResult`, `CardLookupDto`, `SyncRun`, `SyncStatusDto`, `HealthDto`
  - `formatEuro(cents: number): string`, `euroToCents(euro: number): number`

- [ ] **Step 1: File di progetto root**

`package.json`:
```json
{
  "name": "ctzero-tracker",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "web"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "dev:server": "npm run dev -w @ctzero/server",
    "dev:web": "npm run dev -w @ctzero/web",
    "build": "npm run build -w @ctzero/web",
    "start": "npm run build && npm run start -w @ctzero/server"
  },
  "devDependencies": {
    "@types/node": "^24.19.1",
    "typescript": "~5.9.3",
    "vitest": "^5.0.3"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["shared/src", "server/src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
  },
});
```

`.gitignore`:
```
node_modules/
data/
.env
web/dist/
```

`.env.example`:
```
# Token API CardTrader: https://www.cardtrader.com/it/full_api_app
CARDTRADER_TOKEN=
# Bot Telegram creato con @BotFather
TELEGRAM_BOT_TOKEN=
# Chat id: scrivi al bot, poi apri https://api.telegram.org/bot<TOKEN>/getUpdates e leggi message.chat.id
TELEGRAM_CHAT_ID=
# Opzionali
PORT=3000
# DB_PATH=data/ctzero.db
```

`shared/package.json`:
```json
{
  "name": "@ctzero/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.6.5" }
}
```

`server/package.json`:
```json
{
  "name": "@ctzero/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "node --disable-warning=ExperimentalWarning --import tsx src/main.ts"
  },
  "dependencies": {
    "@ctzero/shared": "*",
    "@fastify/static": "^10.1.5",
    "fastify": "^5.12.5",
    "tsx": "^4.23.15",
    "zod": "^4.6.5"
  }
}
```

Nota: il workspace `web` è elencato ma la cartella nasce nel Task 12; npm ignora i pattern senza cartella. Se `npm install` dovesse lamentarsene, rimuovere temporaneamente `"web"` da `workspaces` e rimetterlo nel Task 12.

- [ ] **Step 2: Installare le dipendenze**

Run: `npm install`
Expected: termina senza errori, crea `node_modules/@ctzero/shared` (symlink).

- [ ] **Step 3: Scrivere i test che falliscono**

`shared/src/money.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { euroToCents, formatEuro } from './money';

describe('formatEuro', () => {
  it('formatta i centesimi con la virgola', () => {
    expect(formatEuro(3850)).toBe('38,50 €');
    expect(formatEuro(5)).toBe('0,05 €');
    expect(formatEuro(123456)).toBe('1234,56 €');
  });

  it('gestisce i negativi', () => {
    expect(formatEuro(-150)).toBe('-1,50 €');
  });
});

describe('euroToCents', () => {
  it('arrotonda al centesimo', () => {
    expect(euroToCents(38.5)).toBe(3850);
    expect(euroToCents(0.1 + 0.2)).toBe(30);
    expect(euroToCents(19.999)).toBe(2000);
  });
});
```

`shared/src/schemas.test.ts`:
```ts
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
```

- [ ] **Step 4: Verificare che falliscano**

Run: `npx vitest run shared`
Expected: FAIL, moduli `./money` e `./schemas` non trovati.

- [ ] **Step 5: Implementare `shared`**

`shared/src/constants.ts`:
```ts
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
```

`shared/src/schemas.ts`:
```ts
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
```

`shared/src/types.ts`:
```ts
import type { Condition, Language } from './constants';

export type SyncStatus = 'ok' | 'no_offers' | 'error';
export type AlertState = 'above' | 'below';
export type SyncTrigger = 'manual' | 'scheduled' | 'catchup';
export type RunStatus = 'running' | 'ok' | 'partial' | 'failed';

export interface Listing {
  productId: number;
  blueprintId: number;
  expansionName: string;
  condition: string;
  language: string;
  foil: boolean;
  priceCents: number;
  url: string;
}

export interface TrackedCard {
  id: number;
  name: string;
  scryfallOracleId: string;
  imageUrl: string | null;
  /** Espansioni CardTrader selezionate; [] = qualsiasi. */
  expansionIds: number[];
  /** Nomi delle espansioni selezionate (vuoto se "qualsiasi"). */
  expansionNames: string[];
  /** [] = qualsiasi lingua. */
  languages: Language[];
  minCondition: Condition;
  foil: boolean;
  thresholdCents: number;
  configVersion: number;
  lastPriceCents: number | null;
  lastListing: Listing | null;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus | null;
  lastError: string | null;
  alertState: AlertState | null;
  lastNotifiedPriceCents: number | null;
  blueprintsResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CardBlueprint {
  blueprintId: number;
  expansionId: number;
  expansionName: string;
}

export interface Printing {
  expansionId: number;
  expansionName: string;
  code: string;
}

export interface Preset {
  label: string;
  cents: number;
}

export interface PreviewResult {
  priceCents: number | null;
  listing: Listing | null;
  presets: Preset[];
  blueprintCount: number;
}

export interface CardLookupDto {
  name: string;
  imageUrl: string | null;
  printings: Printing[];
}

export interface SyncRun {
  id: number;
  trigger: SyncTrigger;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  cardsTotal: number;
  cardsDone: number;
  cardsError: number;
  error: string | null;
  reportSent: boolean;
  reportError: string | null;
}

export interface SyncStatusDto {
  current: SyncRun | null;
  last: SyncRun | null;
  nextRunAt: string | null;
}

export interface HealthDto {
  cardtrader: boolean;
  telegram: boolean;
}
```

`shared/src/money.ts`:
```ts
export function formatEuro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${euros},${rest} €`;
}

export function euroToCents(euro: number): number {
  return Math.round(euro * 100);
}
```

`shared/src/index.ts`:
```ts
export * from './constants';
export * from './schemas';
export * from './types';
export * from './money';
```

- [ ] **Step 6: Verificare che passino e che il typecheck sia pulito**

Run: `npx vitest run shared && npm run typecheck`
Expected: tutti i test PASS; `tsc` senza errori.

---

### Task 2: Filtro inserzioni e preset soglia (puri)

**Files:**
- Create: `server/src/clients/cardtrader-types.ts`, `server/src/test-utils.ts`
- Create: `server/src/pricing/listings.ts`, `server/src/pricing/presets.ts`
- Test: `server/src/pricing/listings.test.ts`, `server/src/pricing/presets.test.ts`

**Interfaces:**
- Consumes: `CONDITIONS`, `Condition`, `Language`, `Listing`, `Preset` da `@ctzero/shared`
- Produces:
  - `interface CtProduct` (forma di un'inserzione del marketplace)
  - `makeProduct(overrides?)` per i test
  - `interface ListingFilter { minCondition: Condition; foil: boolean; languages: Language[] }`
  - `isValidListing(p: CtProduct, f: ListingFilter): boolean`
  - `cheapestListing(products: CtProduct[], f: ListingFilter, expansionNames: Map<number, string>): Listing | null`
  - `listingUrl(blueprintId: number): string`
  - `thresholdPresets(priceCents: number | null): Preset[]`

- [ ] **Step 1: Tipi e helper di test**

`server/src/clients/cardtrader-types.ts`:
```ts
/** Inserzione restituita da GET /marketplace/products (solo i campi usati). */
export interface CtProduct {
  id: number;
  blueprint_id: number;
  quantity: number;
  price: { cents: number; currency: string };
  properties_hash: {
    condition?: string;
    mtg_language?: string;
    mtg_foil?: boolean;
    signed?: boolean;
    altered?: boolean;
  };
  graded?: boolean;
  on_vacation?: boolean;
  user?: { id?: number; username?: string; can_sell_via_hub?: boolean };
}
```

`server/src/test-utils.ts`:
```ts
import type { CtProduct } from './clients/cardtrader-types';

type ProductOverrides = Partial<CtProduct> & {
  props?: Partial<CtProduct['properties_hash']>;
  hub?: boolean;
};

/** Inserzione CT Zero valida (NM, EN, non foil, 10 €), personalizzabile. */
export function makeProduct(overrides: ProductOverrides = {}): CtProduct {
  const { props, hub, ...rest } = overrides;
  return {
    id: 1,
    blueprint_id: 10,
    quantity: 1,
    price: { cents: 1000, currency: 'EUR' },
    graded: false,
    on_vacation: false,
    user: { can_sell_via_hub: hub ?? true },
    ...rest,
    properties_hash: {
      condition: 'Near Mint',
      mtg_language: 'en',
      mtg_foil: false,
      signed: false,
      altered: false,
      ...props,
    },
  };
}
```

- [ ] **Step 2: Test che falliscono**

`server/src/pricing/listings.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeProduct } from '../test-utils';
import { cheapestListing, isValidListing, type ListingFilter } from './listings';

const filter: ListingFilter = { minCondition: 'Near Mint', foil: false, languages: [] };
const names = new Map([[10, 'Modern Horizons 2']]);

describe('isValidListing', () => {
  it("accetta un'inserzione CT Zero valida", () => {
    expect(isValidListing(makeProduct(), filter)).toBe(true);
  });

  it('scarta le inserzioni non CT Zero', () => {
    expect(isValidListing(makeProduct({ hub: false }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ user: undefined }), filter)).toBe(false);
  });

  it('rispetta la condizione minima', () => {
    expect(isValidListing(makeProduct({ props: { condition: 'Mint' } }), filter)).toBe(true);
    expect(isValidListing(makeProduct({ props: { condition: 'Slightly Played' } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { condition: 'Ottima' } }), filter)).toBe(false);
    expect(
      isValidListing(makeProduct({ props: { condition: 'Played' } }), { ...filter, minCondition: 'Played' }),
    ).toBe(true);
  });

  it('rispetta foil', () => {
    expect(isValidListing(makeProduct({ props: { mtg_foil: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { mtg_foil: true } }), { ...filter, foil: true })).toBe(true);
    expect(isValidListing(makeProduct({ props: { mtg_foil: undefined } }), filter)).toBe(true);
  });

  it('filtra per lingua solo se specificata', () => {
    const it_ = { ...filter, languages: ['it' as const] };
    expect(isValidListing(makeProduct({ props: { mtg_language: 'en' } }), it_)).toBe(false);
    expect(isValidListing(makeProduct({ props: { mtg_language: 'it' } }), it_)).toBe(true);
    expect(isValidListing(makeProduct({ props: { mtg_language: 'jp' } }), filter)).toBe(true);
  });

  it('scarta quantità zero, vacanza, alterate, firmate, gradate e valute non EUR', () => {
    expect(isValidListing(makeProduct({ quantity: 0 }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ on_vacation: true }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { altered: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ props: { signed: true } }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ graded: true }), filter)).toBe(false);
    expect(isValidListing(makeProduct({ price: { cents: 100, currency: 'USD' } }), filter)).toBe(false);
  });
});

describe('cheapestListing', () => {
  it('sceglie la più economica tra le valide', () => {
    const products = [
      makeProduct({ id: 1, price: { cents: 900, currency: 'EUR' }, hub: false }),
      makeProduct({ id: 2, price: { cents: 1200, currency: 'EUR' } }),
      makeProduct({ id: 3, price: { cents: 1100, currency: 'EUR' }, props: { mtg_language: 'it' } }),
    ];
    expect(cheapestListing(products, filter, names)).toEqual({
      productId: 3,
      blueprintId: 10,
      expansionName: 'Modern Horizons 2',
      condition: 'Near Mint',
      language: 'it',
      foil: false,
      priceCents: 1100,
      url: 'https://www.cardtrader.com/cards/10',
    });
  });

  it('restituisce null se nessuna inserzione è valida', () => {
    expect(cheapestListing([makeProduct({ hub: false })], filter, names)).toBeNull();
    expect(cheapestListing([], filter, names)).toBeNull();
  });
});
```

`server/src/pricing/presets.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { thresholdPresets } from './presets';

describe('thresholdPresets', () => {
  it('propone -10/-20/-30% e 1 €', () => {
    expect(thresholdPresets(4000)).toEqual([
      { label: '-10%', cents: 3600 },
      { label: '-20%', cents: 3200 },
      { label: '-30%', cents: 2800 },
      { label: '1 €', cents: 100 },
    ]);
  });

  it('arrotonda al centesimo', () => {
    expect(thresholdPresets(3333).map((p) => p.cents)).toEqual([3000, 2666, 2333, 100]);
  });

  it('omette 1 € se il prezzo non lo supera', () => {
    expect(thresholdPresets(100).map((p) => p.label)).toEqual(['-10%', '-20%', '-30%']);
  });

  it('senza prezzo propone solo 1 €', () => {
    expect(thresholdPresets(null)).toEqual([{ label: '1 €', cents: 100 }]);
  });
});
```

- [ ] **Step 3: Verificare che falliscano**

Run: `npx vitest run server/src/pricing`
Expected: FAIL, moduli `./listings` e `./presets` non trovati.

- [ ] **Step 4: Implementare**

`server/src/pricing/listings.ts`:
```ts
import { CONDITIONS, type Condition, type Language, type Listing } from '@ctzero/shared';
import type { CtProduct } from '../clients/cardtrader-types';

export interface ListingFilter {
  minCondition: Condition;
  foil: boolean;
  /** [] = qualsiasi lingua. */
  languages: Language[];
}

/** Indice nella scala delle condizioni (0 = Mint); -1 se sconosciuta. */
function conditionRank(condition: string | undefined): number {
  return CONDITIONS.indexOf(condition as Condition);
}

export function listingUrl(blueprintId: number): string {
  return `https://www.cardtrader.com/cards/${blueprintId}`;
}

export function isValidListing(p: CtProduct, f: ListingFilter): boolean {
  // Regola assoluta: solo inserzioni acquistabili tramite CardTrader Zero.
  if (p.user?.can_sell_via_hub !== true) return false;
  const rank = conditionRank(p.properties_hash.condition);
  if (rank < 0 || rank > conditionRank(f.minCondition)) return false;
  if (Boolean(p.properties_hash.mtg_foil) !== f.foil) return false;
  if (f.languages.length > 0 && !f.languages.includes(p.properties_hash.mtg_language as Language)) return false;
  if (!(p.quantity > 0)) return false;
  if (p.on_vacation) return false;
  if (p.properties_hash.altered || p.properties_hash.signed || p.graded) return false;
  if (p.price.currency !== 'EUR') return false;
  return true;
}

export function cheapestListing(
  products: CtProduct[],
  f: ListingFilter,
  expansionNames: Map<number, string>,
): Listing | null {
  let best: CtProduct | null = null;
  for (const p of products) {
    if (!isValidListing(p, f)) continue;
    if (!best || p.price.cents < best.price.cents) best = p;
  }
  if (!best) return null;
  return {
    productId: best.id,
    blueprintId: best.blueprint_id,
    expansionName: expansionNames.get(best.blueprint_id) ?? '',
    condition: best.properties_hash.condition ?? '',
    language: best.properties_hash.mtg_language ?? '',
    foil: Boolean(best.properties_hash.mtg_foil),
    priceCents: best.price.cents,
    url: listingUrl(best.blueprint_id),
  };
}
```

`server/src/pricing/presets.ts`:
```ts
import type { Preset } from '@ctzero/shared';

const DISCOUNTS = [10, 20, 30];
const ONE_EURO_CENTS = 100;

export function thresholdPresets(priceCents: number | null): Preset[] {
  const oneEuro: Preset = { label: '1 €', cents: ONE_EURO_CENTS };
  if (priceCents === null) return [oneEuro];
  const presets: Preset[] = DISCOUNTS.map((d) => ({
    label: `-${d}%`,
    cents: Math.round((priceCents * (100 - d)) / 100),
  }));
  if (priceCents > ONE_EURO_CENTS) presets.push(oneEuro);
  return presets;
}
```

- [ ] **Step 5: Verificare**

Run: `npx vitest run server/src/pricing && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 3: Regole di notifica (pure)

**Files:**
- Create: `server/src/alerts/rules.ts`
- Test: `server/src/alerts/rules.test.ts`

**Interfaces:**
- Consumes: `AlertState` da `@ctzero/shared`
- Produces:
  - `interface AlertSnapshot { alertState: AlertState | null; lastNotifiedPriceCents: number | null }`
  - `type PriceOutcome = { status: 'ok'; priceCents: number } | { status: 'no_offers' }`
  - `type AlertEvent = { kind: 'below'; priceCents; thresholdCents } | { kind: 'further_drop'; priceCents; previousCents } | { kind: 'back_above'; priceCents: number | null; thresholdCents }`
  - `evaluateAlert(prev: AlertSnapshot, outcome: PriceOutcome, thresholdCents: number, furtherDropPercent: number): { next: AlertSnapshot; event: AlertEvent | null }`
  - `evaluateSilently(priceCents: number | null, thresholdCents: number): AlertSnapshot`

- [ ] **Step 1: Test che falliscono**

`server/src/alerts/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { evaluateAlert, evaluateSilently, type AlertSnapshot } from './rules';

const T = 4000;
const fresh: AlertSnapshot = { alertState: null, lastNotifiedPriceCents: null };
const above: AlertSnapshot = { alertState: 'above', lastNotifiedPriceCents: null };
const below3900: AlertSnapshot = { alertState: 'below', lastNotifiedPriceCents: 3900 };

describe('evaluateAlert', () => {
  it('prima discesa sotto soglia → evento below', () => {
    const r = evaluateAlert(fresh, { status: 'ok', priceCents: 3900 }, T, 5);
    expect(r.event).toEqual({ kind: 'below', priceCents: 3900, thresholdCents: T });
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3900 });
  });

  it('prezzo pari alla soglia conta come sotto', () => {
    expect(evaluateAlert(above, { status: 'ok', priceCents: T }, T, 5).event?.kind).toBe('below');
  });

  it('già sotto, calo inferiore alla percentuale → nessun evento, stato invariato', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 3800 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(below3900);
  });

  it('già sotto, calo pari alla percentuale → further_drop', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 3705 }, T, 5);
    expect(r.event).toEqual({ kind: 'further_drop', priceCents: 3705, previousCents: 3900 });
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3705 });
  });

  it("i cali piccoli si accumulano rispetto all'ultimo prezzo notificato", () => {
    const step1 = evaluateAlert(below3900, { status: 'ok', priceCents: 3800 }, T, 5);
    expect(step1.event).toBeNull();
    const step2 = evaluateAlert(step1.next, { status: 'ok', priceCents: 3700 }, T, 5);
    expect(step2.event).toEqual({ kind: 'further_drop', priceCents: 3700, previousCents: 3900 });
  });

  it('da sotto a sopra soglia → back_above', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 4100 }, T, 5);
    expect(r.event).toEqual({ kind: 'back_above', priceCents: 4100, thresholdCents: T });
    expect(r.next).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('da sotto a nessuna offerta → back_above senza prezzo', () => {
    const r = evaluateAlert(below3900, { status: 'no_offers' }, T, 5);
    expect(r.event).toEqual({ kind: 'back_above', priceCents: null, thresholdCents: T });
    expect(r.next.alertState).toBe('above');
  });

  it('sopra soglia e resta sopra → niente', () => {
    const r = evaluateAlert(above, { status: 'ok', priceCents: 4500 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(above);
  });

  it('nessuna offerta senza essere mai stata sotto → above silenzioso', () => {
    const r = evaluateAlert(fresh, { status: 'no_offers' }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(above);
  });

  it('sotto con prezzo notificato mancante usa il prezzo attuale come riferimento', () => {
    const r = evaluateAlert({ alertState: 'below', lastNotifiedPriceCents: null }, { status: 'ok', priceCents: 3000 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3000 });
  });
});

describe('evaluateSilently', () => {
  it('sotto o pari soglia → below con il prezzo come riferimento', () => {
    expect(evaluateSilently(3900, T)).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3900 });
    expect(evaluateSilently(T, T)).toEqual({ alertState: 'below', lastNotifiedPriceCents: T });
  });

  it('sopra soglia o senza prezzo → above', () => {
    expect(evaluateSilently(4100, T)).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
    expect(evaluateSilently(null, T)).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/alerts/rules.test.ts`
Expected: FAIL, modulo `./rules` non trovato.

- [ ] **Step 3: Implementare**

`server/src/alerts/rules.ts`:
```ts
import type { AlertState } from '@ctzero/shared';

export interface AlertSnapshot {
  alertState: AlertState | null;
  lastNotifiedPriceCents: number | null;
}

export type PriceOutcome = { status: 'ok'; priceCents: number } | { status: 'no_offers' };

export type AlertEvent =
  | { kind: 'below'; priceCents: number; thresholdCents: number }
  | { kind: 'further_drop'; priceCents: number; previousCents: number }
  | { kind: 'back_above'; priceCents: number | null; thresholdCents: number };

export interface AlertEvaluation {
  next: AlertSnapshot;
  event: AlertEvent | null;
}

const ABOVE: AlertSnapshot = { alertState: 'above', lastNotifiedPriceCents: null };

export function evaluateAlert(
  prev: AlertSnapshot,
  outcome: PriceOutcome,
  thresholdCents: number,
  furtherDropPercent: number,
): AlertEvaluation {
  const price = outcome.status === 'ok' ? outcome.priceCents : null;

  if (price !== null && price <= thresholdCents) {
    if (prev.alertState !== 'below') {
      return {
        next: { alertState: 'below', lastNotifiedPriceCents: price },
        event: { kind: 'below', priceCents: price, thresholdCents },
      };
    }
    // Il confronto è con l'ultimo prezzo notificato, così i cali piccoli si accumulano.
    const reference = prev.lastNotifiedPriceCents ?? price;
    if (price * 100 <= reference * (100 - furtherDropPercent)) {
      return {
        next: { alertState: 'below', lastNotifiedPriceCents: price },
        event: { kind: 'further_drop', priceCents: price, previousCents: reference },
      };
    }
    return { next: { alertState: 'below', lastNotifiedPriceCents: reference }, event: null };
  }

  if (prev.alertState === 'below') {
    return { next: ABOVE, event: { kind: 'back_above', priceCents: price, thresholdCents } };
  }
  return { next: ABOVE, event: null };
}

/** Valutazione senza notifica: usata alla creazione/modifica di una carta. */
export function evaluateSilently(priceCents: number | null, thresholdCents: number): AlertSnapshot {
  if (priceCents !== null && priceCents <= thresholdCents) {
    return { alertState: 'below', lastNotifiedPriceCents: priceCents };
  }
  return { ...ABOVE };
}
```

- [ ] **Step 4: Verificare**

Run: `npx vitest run server/src/alerts/rules.test.ts`
Expected: PASS.

---

### Task 4: Report Telegram (puro)

**Files:**
- Create: `server/src/alerts/report.ts`
- Test: `server/src/alerts/report.test.ts`

**Interfaces:**
- Consumes: `AlertEvent` (Task 3); `CONDITION_ABBR`, `Condition`, `Listing`, `formatEuro` da `@ctzero/shared`
- Produces:
  - `interface ReportItem { cardName: string; listing: Listing | null; event: AlertEvent }`
  - `interface ReportError { cardName: string; message: string }`
  - `buildReport(items: ReportItem[], errors: ReportError[], at: Date): string | null`
  - `buildFatalMessage(message: string, at: Date): string`
  - `escapeHtml(text: string): string`

- [ ] **Step 1: Test che falliscono**

`server/src/alerts/report.test.ts`:
```ts
import type { Listing } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { buildFatalMessage, buildReport } from './report';

const at = new Date(2026, 9, 2, 18, 0); // ora locale: 02/10 18:00
const listing: Listing = {
  productId: 1,
  blueprintId: 123,
  expansionName: 'Modern Horizons 2',
  condition: 'Near Mint',
  language: 'en',
  foil: false,
  priceCents: 3850,
  url: 'https://www.cardtrader.com/cards/123',
};

describe('buildReport', () => {
  it('restituisce null se non ci sono eventi né errori', () => {
    expect(buildReport([], [], at)).toBeNull();
  });

  it('compone tutte le sezioni nell’ordine previsto', () => {
    const text = buildReport(
      [
        { cardName: 'Ragavan, Nimble Pilferer', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } },
        {
          cardName: 'Sheoldred, the Apocalypse',
          listing: {
            ...listing,
            blueprintId: 7,
            expansionName: 'Dominaria United',
            condition: 'Slightly Played',
            language: 'it',
            foil: true,
            priceCents: 5200,
            url: 'https://www.cardtrader.com/cards/7',
          },
          event: { kind: 'further_drop', priceCents: 5200, previousCents: 5800 },
        },
        { cardName: 'The One Ring', listing: null, event: { kind: 'back_above', priceCents: 7100, thresholdCents: 6500 } },
        { cardName: 'Black Lotus', listing: null, event: { kind: 'back_above', priceCents: null, thresholdCents: 100 } },
      ],
      [{ cardName: 'Mox Pearl', message: 'HTTP 500 da api.cardtrader.com' }],
      at,
    );
    expect(text).toBe(
      [
        '🃏 <b>CTZero Tracker</b> — 02/10 18:00',
        '',
        '🟢 <b>Sotto soglia</b>',
        '• Ragavan, Nimble Pilferer (Modern Horizons 2, NM, EN) — 38,50 € (soglia 40,00 €, 1,50 € sotto) → <a href="https://www.cardtrader.com/cards/123">link</a>',
        '',
        '📉 <b>Ulteriore calo</b>',
        '• Sheoldred, the Apocalypse (Dominaria United, SP, IT, foil) — 52,00 € (era 58,00 €) → <a href="https://www.cardtrader.com/cards/7">link</a>',
        '',
        '🔁 <b>Tornato sopra soglia</b>',
        '• The One Ring — 71,00 € (soglia 65,00 €)',
        '• Black Lotus — nessuna offerta CT Zero valida (soglia 1,00 €)',
        '',
        '❌ <b>Errori</b>',
        '• Mox Pearl — HTTP 500 da api.cardtrader.com',
      ].join('\n'),
    );
  });

  it('omette le sezioni vuote', () => {
    expect(buildReport([], [{ cardName: 'X', message: 'boom' }], at)).toBe(
      ['🃏 <b>CTZero Tracker</b> — 02/10 18:00', '', '❌ <b>Errori</b>', '• X — boom'].join('\n'),
    );
  });

  it("fa l'escape dell'HTML nei testi dinamici", () => {
    const text = buildReport(
      [{ cardName: 'Fire & Ice <promo>', listing, event: { kind: 'below', priceCents: 3850, thresholdCents: 4000 } }],
      [{ cardName: 'A', message: 'errore <html>' }],
      at,
    )!;
    expect(text).toContain('Fire &amp; Ice &lt;promo&gt;');
    expect(text).toContain('errore &lt;html&gt;');
    expect(text).not.toContain('<promo>');
  });
});

describe('buildFatalMessage', () => {
  it('produce un avviso unico con escape', () => {
    expect(buildFatalMessage('HTTP 401 <x>', at)).toBe(
      '⚠️ <b>CTZero Tracker</b> — 02/10 18:00\nAggiornamento prezzi fallito: HTTP 401 &lt;x&gt;',
    );
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/alerts/report.test.ts`
Expected: FAIL, modulo `./report` non trovato.

- [ ] **Step 3: Implementare**

`server/src/alerts/report.ts`:
```ts
import { CONDITION_ABBR, formatEuro, type Condition, type Listing } from '@ctzero/shared';
import type { AlertEvent } from './rules';

export interface ReportItem {
  cardName: string;
  listing: Listing | null;
  event: AlertEvent;
}

export interface ReportError {
  cardName: string;
  message: string;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(at: Date): string {
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function describeListing(l: Listing | null): string {
  if (!l) return '';
  const parts = [l.expansionName, CONDITION_ABBR[l.condition as Condition] ?? l.condition, l.language.toUpperCase()];
  if (l.foil) parts.push('foil');
  return ` (${escapeHtml(parts.join(', '))})`;
}

function link(l: Listing | null): string {
  return l ? ` → <a href="${escapeHtml(l.url)}">link</a>` : '';
}

function itemLine(item: ReportItem): string {
  const name = escapeHtml(item.cardName);
  const e = item.event;
  switch (e.kind) {
    case 'below':
      return `• ${name}${describeListing(item.listing)} — ${formatEuro(e.priceCents)} (soglia ${formatEuro(e.thresholdCents)}, ${formatEuro(e.thresholdCents - e.priceCents)} sotto)${link(item.listing)}`;
    case 'further_drop':
      return `• ${name}${describeListing(item.listing)} — ${formatEuro(e.priceCents)} (era ${formatEuro(e.previousCents)})${link(item.listing)}`;
    case 'back_above':
      return e.priceCents === null
        ? `• ${name} — nessuna offerta CT Zero valida (soglia ${formatEuro(e.thresholdCents)})`
        : `• ${name} — ${formatEuro(e.priceCents)} (soglia ${formatEuro(e.thresholdCents)})`;
  }
}

const SECTIONS: { kind: AlertEvent['kind']; title: string }[] = [
  { kind: 'below', title: '🟢 <b>Sotto soglia</b>' },
  { kind: 'further_drop', title: '📉 <b>Ulteriore calo</b>' },
  { kind: 'back_above', title: '🔁 <b>Tornato sopra soglia</b>' },
];

export function buildReport(items: ReportItem[], errors: ReportError[], at: Date): string | null {
  if (items.length === 0 && errors.length === 0) return null;
  const blocks: string[] = [`🃏 <b>CTZero Tracker</b> — ${formatDate(at)}`];
  for (const section of SECTIONS) {
    const lines = items.filter((i) => i.event.kind === section.kind).map(itemLine);
    if (lines.length > 0) blocks.push([section.title, ...lines].join('\n'));
  }
  if (errors.length > 0) {
    const lines = errors.map((e) => `• ${escapeHtml(e.cardName)} — ${escapeHtml(e.message)}`);
    blocks.push(['❌ <b>Errori</b>', ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}

export function buildFatalMessage(message: string, at: Date): string {
  return `⚠️ <b>CTZero Tracker</b> — ${formatDate(at)}\nAggiornamento prezzi fallito: ${escapeHtml(message)}`;
}
```

- [ ] **Step 4: Verificare**

Run: `npx vitest run server/src/alerts && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 5: Client HTTP (CardTrader, Scryfall, Telegram)

**Files:**
- Create: `server/src/clients/http.ts`, `server/src/clients/cardtrader.ts`, `server/src/clients/scryfall.ts`, `server/src/clients/telegram.ts`
- Test: `server/src/clients/http.test.ts`, `cardtrader.test.ts`, `scryfall.test.ts`, `telegram.test.ts` (stessa cartella)

**Interfaces:**
- Consumes: `CtProduct` (Task 2)
- Produces:
  - `class HttpError extends Error { status: number }` (`status` 0 = errore di rete)
  - `isFatalHttpError(e: unknown): boolean` (401/403)
  - `requestJson<T>(url: string, opts?: { method?: 'GET' | 'POST'; headers?: Record<string,string>; body?: unknown; retries?: number; retryDelayMs?: number }): Promise<T>`
  - `createThrottle(minIntervalMs: number): () => Promise<void>`, `sleep(ms)`
  - `MTG_GAME_ID = 1`, `interface CtExpansion { id; game_id; code; name }`, `interface CtBlueprint { id; name; expansion_id; scryfall_id?: string | null }`
  - `class CardTraderClient(token: string, opts?: { baseUrl?; throttleMs?; retryDelayMs? })` con `configured: boolean`, `expansions(): Promise<CtExpansion[]>`, `blueprints(expansionId: number): Promise<CtBlueprint[]>`, `products(blueprintId: number, q: { foil: boolean; language?: string }): Promise<CtProduct[]>`
  - `interface ScryfallCard { id; oracle_id; name; set; set_name; image_uris?; card_faces? }`, `class ScryfallClient(opts?)` con `autocomplete(q): Promise<string[]>`, `named(name): Promise<ScryfallCard>`, `prints(oracleId): Promise<ScryfallCard[]>`; `cardImage(c: ScryfallCard): string | null`
  - `TELEGRAM_MAX_LENGTH = 4096`, `splitMessage(text: string, max?: number): string[]`, `class TelegramClient(botToken: string, chatId: string, opts?: { baseUrl?; retryDelayMs? })` con `configured: boolean`, `sendMessage(html: string): Promise<void>`

- [ ] **Step 1: Test di `http.ts` (falliscono)**

`server/src/clients/http.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, createThrottle, isFatalHttpError, requestJson } from './http';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('requestJson', () => {
  it('restituisce il JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({ a: 1 }));
    await expect(requestJson('https://x.test/a')).resolves.toEqual({ a: 1 });
  });

  it('ritenta su 429 e poi riesce', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ ok: true }));
    await expect(requestJson('https://x.test/a', { retryDelayMs: 1 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dopo i tentativi su 500 lancia HttpError', async () => {
    fetchMock.mockImplementation(async () => json({ e: 1 }, 500));
    const err = await requestJson('https://x.test/a', { retryDelayMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('non ritenta su 404', async () => {
    fetchMock.mockImplementation(async () => json({}, 404));
    const err = (await requestJson('https://x.test/a', { retryDelayMs: 1 }).catch((e: unknown) => e)) as HttpError;
    expect(err.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('su errore di rete ritenta e poi lancia HttpError con status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const err = (await requestJson('https://x.test/a', { retryDelayMs: 1 }).catch((e: unknown) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('non mette path e query nel messaggio di errore (niente token)', async () => {
    fetchMock.mockImplementation(async () => json({}, 401));
    const err = (await requestJson('https://api.telegram.org/botSECRET/sendMessage?x=SECRET').catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(err.message).toContain('api.telegram.org');
    expect(err.message).not.toContain('SECRET');
  });

  it('in POST invia il body JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await requestJson('https://x.test/a', { method: 'POST', body: { a: 1 } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

describe('isFatalHttpError', () => {
  it('riconosce 401 e 403', () => {
    expect(isFatalHttpError(new HttpError(401, 'x'))).toBe(true);
    expect(isFatalHttpError(new HttpError(403, 'x'))).toBe(true);
    expect(isFatalHttpError(new HttpError(500, 'x'))).toBe(false);
    expect(isFatalHttpError(new Error('x'))).toBe(false);
  });
});

describe('createThrottle', () => {
  it('distanzia le chiamate', async () => {
    const throttle = createThrottle(40);
    const start = Date.now();
    await throttle();
    await throttle();
    await throttle();
    expect(Date.now() - start).toBeGreaterThanOrEqual(75);
  });
});
```

Nota: il messaggio di errore usa il body della risposta (troncato a 200 caratteri). Telegram non rimanda il token nel body, quindi va bene.

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/clients/http.test.ts`
Expected: FAIL, modulo `./http` non trovato.

- [ ] **Step 3: Implementare `http.ts`**

`server/src/clients/http.ts`:
```ts
export class HttpError extends Error {
  constructor(
    /** Status HTTP; 0 = errore di rete. */
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Errori che rendono inutile proseguire il giro (token mancante o non valido). */
export function isFatalHttpError(e: unknown): boolean {
  return e instanceof HttpError && (e.status === 401 || e.status === 403);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  retries?: number;
  retryDelayMs?: number;
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelay = opts.retryDelayMs ?? 500;
  // Solo l'host nei messaggi: path e query possono contenere token.
  const host = new URL(url).host;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...opts.headers,
  };

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }
      throw new HttpError(0, `Errore di rete verso ${host}: ${(e as Error).message}`);
    }
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(baseDelay * 2 ** attempt);
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, `HTTP ${res.status} da ${host}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
}

/** Garantisce almeno `minIntervalMs` tra due chiamate consecutive. */
export function createThrottle(minIntervalMs: number): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  };
}
```

- [ ] **Step 4: Verificare `http.ts`**

Run: `npx vitest run server/src/clients/http.test.ts`
Expected: PASS.

- [ ] **Step 5: Test dei client (falliscono)**

`server/src/clients/cardtrader.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardTraderClient } from './cardtrader';
import { HttpError } from './http';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const client = new CardTraderClient('tok', { throttleMs: 0, retryDelayMs: 1 });

function lastCall(): { url: URL; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: new URL(url as string), init: init as RequestInit };
}

describe('CardTraderClient', () => {
  it('products: URL, token e inserzioni del blueprint richiesto', async () => {
    fetchMock.mockResolvedValueOnce(json({ '42': [{ id: 1 }], '43': [{ id: 2 }] }));
    const res = await client.products(42, { foil: true, language: 'it' });
    expect(res).toEqual([{ id: 1 }]);
    const { url, init } = lastCall();
    expect(url.origin + url.pathname).toBe('https://api.cardtrader.com/api/v2/marketplace/products');
    expect(url.searchParams.get('blueprint_id')).toBe('42');
    expect(url.searchParams.get('foil')).toBe('true');
    expect(url.searchParams.get('language')).toBe('it');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('products senza lingua non passa il parametro e gestisce la chiave mancante', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(client.products(42, { foil: false })).resolves.toEqual([]);
    expect(lastCall().url.searchParams.has('language')).toBe(false);
  });

  it('blueprints passa expansion_id', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: 5, name: 'X', expansion_id: 9, scryfall_id: 's' }]));
    await expect(client.blueprints(9)).resolves.toHaveLength(1);
    const { url } = lastCall();
    expect(url.pathname).toBe('/api/v2/blueprints/export');
    expect(url.searchParams.get('expansion_id')).toBe('9');
  });

  it('expansions', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: 1, game_id: 1, code: 'mh2', name: 'Modern Horizons 2' }]));
    await expect(client.expansions()).resolves.toEqual([{ id: 1, game_id: 1, code: 'mh2', name: 'Modern Horizons 2' }]);
    expect(lastCall().url.pathname).toBe('/api/v2/expansions');
  });

  it('senza token lancia 401 senza chiamare la rete', async () => {
    const noToken = new CardTraderClient('');
    expect(noToken.configured).toBe(false);
    const err = (await noToken.expansions().catch((e: unknown) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

`server/src/clients/scryfall.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScryfallClient, cardImage, type ScryfallCard } from './scryfall';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const client = new ScryfallClient({ throttleMs: 0, retryDelayMs: 1 });
const card = (id: string, set: string): ScryfallCard => ({ id, oracle_id: 'abc', name: 'X', set, set_name: set });

describe('ScryfallClient', () => {
  it('autocomplete con meno di 2 caratteri non chiama la rete', async () => {
    await expect(client.autocomplete(' l ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('autocomplete', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: ['Lightning Bolt'] }));
    await expect(client.autocomplete('light')).resolves.toEqual(['Lightning Bolt']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.scryfall.com/cards/autocomplete?q=light');
    expect((init as RequestInit & { headers: Record<string, string> }).headers['User-Agent']).toBe('ctzero-tracker/0.1');
  });

  it('named codifica il nome', async () => {
    fetchMock.mockResolvedValueOnce(json(card('1', 'mh2')));
    await client.named('Fire // Ice');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.scryfall.com/cards/named?exact=Fire%20%2F%2F%20Ice');
  });

  it('prints segue la paginazione', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: [card('a', 'mh2')], has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2' }),
      )
      .mockResolvedValueOnce(json({ data: [card('b', 'm10')], has_more: false }));
    const prints = await client.prints('abc');
    expect(prints.map((p) => p.id)).toEqual(['a', 'b']);
    const firstUrl = fetchMock.mock.calls[0]![0] as string;
    expect(firstUrl).toContain('q=oracleid%3Aabc');
    expect(firstUrl).toContain('unique=prints');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.scryfall.com/cards/search?page=2');
  });

  it('cardImage usa la prima faccia per le carte doppie', () => {
    expect(cardImage({ ...card('1', 'x'), image_uris: { small: 'front' } })).toBe('front');
    expect(cardImage({ ...card('1', 'x'), card_faces: [{ image_uris: { small: 'face' } }] })).toBe('face');
    expect(cardImage(card('1', 'x'))).toBeNull();
  });
});
```

`server/src/clients/telegram.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramClient, splitMessage } from './telegram';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('splitMessage', () => {
  it('non divide i messaggi corti', () => {
    expect(splitMessage('ciao', 10)).toEqual(['ciao']);
  });

  it('divide sulle righe rispettando il limite', () => {
    const text = Array.from({ length: 10 }, (_, i) => `riga ${i} ${'x'.repeat(20)}`).join('\n');
    const chunks = splitMessage(text, 70);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(70);
    expect(chunks.join('\n')).toBe(text);
  });

  it('spezza una riga più lunga del limite', () => {
    expect(splitMessage('a'.repeat(25), 10)).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });
});

describe('TelegramClient', () => {
  it('sendMessage invia HTML al chat id', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await new TelegramClient('BOT', '99', { retryDelayMs: 1 }).sendMessage('<b>ciao</b>');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botBOT/sendMessage');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '99',
      text: '<b>ciao</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('oltre 4096 caratteri invia più messaggi', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    const text = Array.from({ length: 300 }, () => 'x'.repeat(30)).join('\n'); // ~9300 caratteri
    await new TelegramClient('BOT', '99').sendMessage(text);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('non configurato → errore senza chiamare la rete', async () => {
    const client = new TelegramClient('', '');
    expect(client.configured).toBe(false);
    await expect(client.sendMessage('x')).rejects.toThrow(/non configurato/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Verificare che falliscano**

Run: `npx vitest run server/src/clients`
Expected: i test di `http` PASS; gli altri FAIL per moduli mancanti.

- [ ] **Step 7: Implementare i client**

`server/src/clients/cardtrader.ts`:
```ts
import type { CtProduct } from './cardtrader-types';
import { HttpError, createThrottle, requestJson } from './http';

export const MTG_GAME_ID = 1;

export interface CtExpansion {
  id: number;
  game_id: number;
  code: string;
  name: string;
}

export interface CtBlueprint {
  id: number;
  name: string;
  expansion_id: number;
  scryfall_id?: string | null;
}

export interface CardTraderOptions {
  baseUrl?: string;
  /** Distanza minima tra richieste; default 200 ms (5 req/s, sotto il limite di 10 del marketplace). */
  throttleMs?: number;
  retryDelayMs?: number;
}

type Params = Record<string, string | number | boolean | undefined>;

export class CardTraderClient {
  private readonly baseUrl: string;
  private readonly throttle: () => Promise<void>;
  private readonly retryDelayMs: number | undefined;

  constructor(
    private readonly token: string,
    opts: CardTraderOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? 'https://api.cardtrader.com/api/v2';
    this.throttle = createThrottle(opts.throttleMs ?? 200);
    this.retryDelayMs = opts.retryDelayMs;
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  private async get<T>(path: string, params: Params = {}): Promise<T> {
    if (!this.configured) throw new HttpError(401, 'CARDTRADER_TOKEN non configurato');
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    await this.throttle();
    return requestJson<T>(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
      retryDelayMs: this.retryDelayMs,
    });
  }

  expansions(): Promise<CtExpansion[]> {
    return this.get<CtExpansion[]>('/expansions');
  }

  blueprints(expansionId: number): Promise<CtBlueprint[]> {
    return this.get<CtBlueprint[]>('/blueprints/export', { expansion_id: expansionId });
  }

  /** Al massimo le 25 inserzioni più economiche del blueprint. */
  async products(blueprintId: number, q: { foil: boolean; language?: string }): Promise<CtProduct[]> {
    const data = await this.get<Record<string, CtProduct[]>>('/marketplace/products', {
      blueprint_id: blueprintId,
      foil: q.foil,
      language: q.language,
    });
    return data[String(blueprintId)] ?? [];
  }
}
```

`server/src/clients/scryfall.ts`:
```ts
import { createThrottle, requestJson } from './http';

export interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  set: string;
  set_name: string;
  image_uris?: { small?: string };
  card_faces?: { image_uris?: { small?: string } }[];
}

interface ScryfallList<T> {
  data: T[];
  has_more: boolean;
  next_page?: string;
}

export interface ScryfallOptions {
  baseUrl?: string;
  /** Scryfall chiede 50–100 ms tra le richieste. */
  throttleMs?: number;
  retryDelayMs?: number;
}

export function cardImage(c: ScryfallCard): string | null {
  return c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? null;
}

export class ScryfallClient {
  private readonly baseUrl: string;
  private readonly throttle: () => Promise<void>;
  private readonly retryDelayMs: number | undefined;

  constructor(opts: ScryfallOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.scryfall.com';
    this.throttle = createThrottle(opts.throttleMs ?? 100);
    this.retryDelayMs = opts.retryDelayMs;
  }

  private async get<T>(url: string): Promise<T> {
    await this.throttle();
    return requestJson<T>(url, { headers: { 'User-Agent': 'ctzero-tracker/0.1' }, retryDelayMs: this.retryDelayMs });
  }

  async autocomplete(q: string): Promise<string[]> {
    const query = q.trim();
    if (query.length < 2) return [];
    const res = await this.get<{ data: string[] }>(`${this.baseUrl}/cards/autocomplete?q=${encodeURIComponent(query)}`);
    return res.data;
  }

  named(name: string): Promise<ScryfallCard> {
    return this.get<ScryfallCard>(`${this.baseUrl}/cards/named?exact=${encodeURIComponent(name)}`);
  }

  /** Tutte le stampe della carta, seguendo la paginazione (175 per pagina). */
  async prints(oracleId: string): Promise<ScryfallCard[]> {
    const out: ScryfallCard[] = [];
    let url: string | undefined =
      `${this.baseUrl}/cards/search?q=${encodeURIComponent(`oracleid:${oracleId}`)}&unique=prints&order=released`;
    while (url) {
      const page: ScryfallList<ScryfallCard> = await this.get<ScryfallList<ScryfallCard>>(url);
      out.push(...page.data);
      url = page.has_more ? page.next_page : undefined;
    }
    return out;
  }
}
```

`server/src/clients/telegram.ts`:
```ts
import { requestJson } from './http';

export const TELEGRAM_MAX_LENGTH = 4096;

/** Divide il testo sui confini di riga; spezza solo le righe più lunghe del limite. */
export function splitMessage(text: string, max = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    let rest = line;
    while (rest.length > max) {
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    current = rest;
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface TelegramOptions {
  baseUrl?: string;
  retryDelayMs?: number;
}

export class TelegramClient {
  private readonly baseUrl: string;
  private readonly retryDelayMs: number | undefined;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    opts: TelegramOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? 'https://api.telegram.org';
    this.retryDelayMs = opts.retryDelayMs;
  }

  get configured(): boolean {
    return this.botToken.length > 0 && this.chatId.length > 0;
  }

  async sendMessage(html: string): Promise<void> {
    if (!this.configured) throw new Error('Telegram non configurato (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
    for (const chunk of splitMessage(html)) {
      await requestJson(`${this.baseUrl}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        body: {
          chat_id: this.chatId,
          text: chunk,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        },
        retryDelayMs: this.retryDelayMs,
      });
    }
  }
}
```

- [ ] **Step 8: Verificare**

Run: `npx vitest run server/src/clients && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 6: Database e repository

**Files:**
- Create: `server/src/errors.ts`, `server/src/db/db.ts`, `server/src/db/cards-repo.ts`, `server/src/db/runs-repo.ts`, `server/src/db/settings-repo.ts`
- Test: `server/src/db/repos.test.ts`

**Interfaces:**
- Consumes: tipi e `DEFAULT_SETTINGS`/`settingsSchema` da `@ctzero/shared`
- Produces:
  - `errors.ts`: `class NotFoundError`, `class ValidationError`, `errorMessage(e: unknown): string`
  - `db.ts`: `type Db = DatabaseSync`, `MIGRATIONS: string[]`, `openDb(path: string): Db` (`':memory:'` per i test), `transaction<T>(db, fn: () => T): T` (rientrante)
  - `cards-repo.ts`: `interface NewCard { name; scryfallOracleId; imageUrl: string | null; expansionIds: number[]; languages: Language[]; minCondition: Condition; foil: boolean; thresholdCents: number }`, `type CardPatch = Partial<Omit<TrackedCard, 'id' | 'createdAt' | 'updatedAt' | 'expansionNames'>>`, `listCards(db)`, `getCard(db, id)`, `insertCard(db, c, now?)`, `updateCard(db, id, patch, now?)` (i campi `undefined` vengono ignorati, `null` scrive NULL; lancia `NotFoundError`), `deleteCard(db, id): boolean`, `getBlueprints(db, cardId): CardBlueprint[]`, `replaceBlueprints(db, cardId, bps)`, `insertSnapshot(db, { cardId, configVersion, syncedAt, priceCents })`, `listSnapshots(db, cardId)`
  - `runs-repo.ts`: `startRun(db, trigger, cardsTotal, now?)`, `updateRunProgress(db, id, cardsDone, cardsError)`, `finishRun(db, id, { status, error?, reportSent?, reportError? }, now?)`, `getRun(db, id)`, `getRunningRun(db)`, `getLastFinishedRun(db)`, `failOrphanRuns(db): number`
  - `settings-repo.ts`: `getSettings(db): Settings`, `saveSettings(db, s: Settings): void`

- [ ] **Step 1: Test che falliscono**

`server/src/db/repos.test.ts`:
```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Listing } from '@ctzero/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors';
import {
  deleteCard,
  getBlueprints,
  getCard,
  insertCard,
  insertSnapshot,
  listCards,
  listSnapshots,
  replaceBlueprints,
  updateCard,
  type NewCard,
} from './cards-repo';
import { MIGRATIONS, openDb, type Db } from './db';
import {
  failOrphanRuns,
  finishRun,
  getLastFinishedRun,
  getRun,
  getRunningRun,
  startRun,
  updateRunProgress,
} from './runs-repo';
import { getSettings, saveSettings } from './settings-repo';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const t0 = new Date('2026-10-02T10:00:00.000Z');
const t1 = new Date('2026-10-02T11:00:00.000Z');
const t2 = new Date('2026-10-02T12:00:00.000Z');
const newCard: NewCard = {
  name: 'Lightning Bolt',
  scryfallOracleId: 'oid',
  imageUrl: null,
  expansionIds: [1, 2],
  languages: ['en'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 150,
};
const listing: Listing = {
  productId: 1,
  blueprintId: 10,
  expansionName: 'Alpha',
  condition: 'Near Mint',
  language: 'en',
  foil: false,
  priceCents: 120,
  url: 'https://www.cardtrader.com/cards/10',
};

describe('openDb', () => {
  it('applica le migrazioni una sola volta su file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ctzero-')), 'test.db');
    openDb(path).close();
    const again = openDb(path);
    const { user_version } = again.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(user_version).toBe(MIGRATIONS.length);
    again.close();
  });
});

describe('cards-repo', () => {
  it('insert + get con i default', () => {
    const card = insertCard(db, newCard, t0);
    expect(card).toMatchObject({
      name: 'Lightning Bolt',
      expansionIds: [1, 2],
      expansionNames: [],
      languages: ['en'],
      foil: false,
      configVersion: 1,
      lastPriceCents: null,
      lastListing: null,
      alertState: null,
      createdAt: t0.toISOString(),
      updatedAt: t0.toISOString(),
    });
    expect(getCard(db, card.id)).toEqual(card);
  });

  it('updateCard aggiorna solo i campi passati e accetta null', () => {
    const { id } = insertCard(db, newCard, t0);
    const updated = updateCard(db, id, { lastPriceCents: 120, lastListing: listing, alertState: 'below', foil: true }, t1);
    expect(updated).toMatchObject({ lastPriceCents: 120, lastListing: listing, alertState: 'below', foil: true });
    expect(updated.updatedAt).toBe(t1.toISOString());
    const cleared = updateCard(db, id, { lastPriceCents: null }, t2);
    expect(cleared.lastPriceCents).toBeNull();
    expect(cleared.alertState).toBe('below');
  });

  it('updateCard su id inesistente lancia NotFoundError', () => {
    expect(() => updateCard(db, 999, { thresholdCents: 1 })).toThrow(NotFoundError);
  });

  it('replaceBlueprints sostituisce e popola expansionNames', () => {
    const { id } = insertCard(db, newCard, t0);
    replaceBlueprints(db, id, [
      { blueprintId: 10, expansionId: 1, expansionName: 'Alpha' },
      { blueprintId: 11, expansionId: 1, expansionName: 'Alpha' },
      { blueprintId: 12, expansionId: 2, expansionName: 'Beta' },
    ]);
    expect(getBlueprints(db, id)).toHaveLength(3);
    expect(getCard(db, id)!.expansionNames).toEqual(['Alpha', 'Beta']);
    replaceBlueprints(db, id, [{ blueprintId: 12, expansionId: 2, expansionName: 'Beta' }]);
    expect(getBlueprints(db, id)).toEqual([{ blueprintId: 12, expansionId: 2, expansionName: 'Beta' }]);
  });

  it('expansionNames è vuoto per le carte con espansione "qualsiasi"', () => {
    const { id } = insertCard(db, { ...newCard, expansionIds: [] }, t0);
    replaceBlueprints(db, id, [{ blueprintId: 10, expansionId: 1, expansionName: 'Alpha' }]);
    expect(getCard(db, id)!.expansionNames).toEqual([]);
  });

  it('deleteCard elimina in cascata blueprint e snapshot', () => {
    const { id } = insertCard(db, newCard, t0);
    replaceBlueprints(db, id, [{ blueprintId: 10, expansionId: 1, expansionName: 'Alpha' }]);
    insertSnapshot(db, { cardId: id, configVersion: 1, syncedAt: t0.toISOString(), priceCents: 100 });
    expect(deleteCard(db, id)).toBe(true);
    expect(getCard(db, id)).toBeNull();
    expect(getBlueprints(db, id)).toEqual([]);
    expect(listSnapshots(db, id)).toEqual([]);
    expect(deleteCard(db, id)).toBe(false);
  });

  it('listCards ordina per nome', () => {
    insertCard(db, { ...newCard, name: 'Zur' }, t0);
    insertCard(db, { ...newCard, name: 'Abrade' }, t0);
    expect(listCards(db).map((c) => c.name)).toEqual(['Abrade', 'Zur']);
  });

  it('snapshot con prezzo nullo', () => {
    const { id } = insertCard(db, newCard, t0);
    insertSnapshot(db, { cardId: id, configVersion: 2, syncedAt: t0.toISOString(), priceCents: null });
    expect(listSnapshots(db, id)).toEqual([{ configVersion: 2, syncedAt: t0.toISOString(), priceCents: null }]);
  });
});

describe('runs-repo', () => {
  it('ciclo di vita di un giro', () => {
    const run = startRun(db, 'manual', 3, t0);
    expect(run).toMatchObject({ trigger: 'manual', status: 'running', cardsTotal: 3, cardsDone: 0, finishedAt: null });
    expect(getRunningRun(db)?.id).toBe(run.id);
    updateRunProgress(db, run.id, 2, 1);
    finishRun(db, run.id, { status: 'partial', reportSent: true }, t1);
    expect(getRun(db, run.id)).toMatchObject({
      status: 'partial',
      cardsDone: 2,
      cardsError: 1,
      reportSent: true,
      reportError: null,
      finishedAt: t1.toISOString(),
    });
    expect(getRunningRun(db)).toBeNull();
    expect(getLastFinishedRun(db)?.id).toBe(run.id);
  });

  it('failOrphanRuns chiude i giri interrotti con finished_at = started_at', () => {
    const run = startRun(db, 'scheduled', 1, t0);
    expect(failOrphanRuns(db)).toBe(1);
    const orphan = getRun(db, run.id)!;
    expect(orphan.status).toBe('failed');
    expect(orphan.finishedAt).toBe(t0.toISOString());
    expect(orphan.error).toContain('Interrotto');
  });

  it('getLastFinishedRun prende il più recente, qualunque esito', () => {
    const a = startRun(db, 'manual', 0, t0);
    finishRun(db, a.id, { status: 'failed', error: 'x' }, t2);
    const b = startRun(db, 'manual', 0, t0);
    finishRun(db, b.id, { status: 'ok' }, t1);
    expect(getLastFinishedRun(db)?.id).toBe(a.id);
  });
});

describe('settings-repo', () => {
  it('restituisce i default se vuoto', () => {
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('save + get', () => {
    const s = { ...DEFAULT_SETTINGS, scheduleMode: 'daily' as const, dailyTime: '07:30' };
    saveSettings(db, s);
    expect(getSettings(db)).toEqual(s);
  });

  it('valori corrotti → default', () => {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('intervalHours', '"abc"')`).run();
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/db`
Expected: FAIL, moduli mancanti.

- [ ] **Step 3: Implementare `errors.ts` e `db.ts`**

`server/src/errors.ts`:
```ts
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Richiesta formalmente valida ma non soddisfacibile (→ 422). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

`server/src/db/db.ts`:
```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tracked_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scryfall_oracle_id TEXT NOT NULL,
    image_url TEXT,
    expansion_ids TEXT NOT NULL DEFAULT '[]',
    languages TEXT NOT NULL DEFAULT '[]',
    min_condition TEXT NOT NULL,
    foil INTEGER NOT NULL,
    threshold_cents INTEGER NOT NULL,
    config_version INTEGER NOT NULL DEFAULT 1,
    last_price_cents INTEGER,
    last_listing TEXT,
    last_synced_at TEXT,
    last_sync_status TEXT,
    last_error TEXT,
    alert_state TEXT,
    last_notified_price_cents INTEGER,
    blueprints_resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE card_blueprints (
    tracked_card_id INTEGER NOT NULL REFERENCES tracked_cards(id) ON DELETE CASCADE,
    blueprint_id INTEGER NOT NULL,
    expansion_id INTEGER NOT NULL,
    expansion_name TEXT NOT NULL,
    PRIMARY KEY (tracked_card_id, blueprint_id)
  );
  CREATE TABLE price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracked_card_id INTEGER NOT NULL REFERENCES tracked_cards(id) ON DELETE CASCADE,
    config_version INTEGER NOT NULL,
    synced_at TEXT NOT NULL,
    price_cents INTEGER
  );
  CREATE INDEX price_snapshots_card ON price_snapshots(tracked_card_id);
  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    cards_total INTEGER NOT NULL DEFAULT 0,
    cards_done INTEGER NOT NULL DEFAULT 0,
    cards_error INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    report_sent INTEGER NOT NULL DEFAULT 0,
    report_error TEXT
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

const depth = new WeakMap<Db, number>();

/** Esegue `fn` in una transazione; le chiamate annidate riusano quella esterna. */
export function transaction<T>(db: Db, fn: () => T): T {
  const current = depth.get(db) ?? 0;
  if (current > 0) {
    depth.set(db, current + 1);
    try {
      return fn();
    } finally {
      depth.set(db, current);
    }
  }
  db.exec('BEGIN');
  depth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth.set(db, 0);
  }
}
```

- [ ] **Step 4: Implementare i repository**

`server/src/db/cards-repo.ts`:
```ts
import type {
  AlertState,
  CardBlueprint,
  Condition,
  Language,
  Listing,
  SyncStatus,
  TrackedCard,
} from '@ctzero/shared';
import { NotFoundError } from '../errors';
import { transaction, type Db } from './db';

type SqlValue = string | number | null;

interface CardRecord {
  id: number;
  name: string;
  scryfall_oracle_id: string;
  image_url: string | null;
  expansion_ids: string;
  languages: string;
  min_condition: string;
  foil: number;
  threshold_cents: number;
  config_version: number;
  last_price_cents: number | null;
  last_listing: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
  alert_state: string | null;
  last_notified_price_cents: number | null;
  blueprints_resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewCard {
  name: string;
  scryfallOracleId: string;
  imageUrl: string | null;
  expansionIds: number[];
  languages: Language[];
  minCondition: Condition;
  foil: boolean;
  thresholdCents: number;
}

export type CardPatch = Partial<Omit<TrackedCard, 'id' | 'createdAt' | 'updatedAt' | 'expansionNames'>>;

const COLUMNS: Record<keyof CardPatch, string> = {
  name: 'name',
  scryfallOracleId: 'scryfall_oracle_id',
  imageUrl: 'image_url',
  expansionIds: 'expansion_ids',
  languages: 'languages',
  minCondition: 'min_condition',
  foil: 'foil',
  thresholdCents: 'threshold_cents',
  configVersion: 'config_version',
  lastPriceCents: 'last_price_cents',
  lastListing: 'last_listing',
  lastSyncedAt: 'last_synced_at',
  lastSyncStatus: 'last_sync_status',
  lastError: 'last_error',
  alertState: 'alert_state',
  lastNotifiedPriceCents: 'last_notified_price_cents',
  blueprintsResolvedAt: 'blueprints_resolved_at',
};

function encode(key: keyof CardPatch, value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (key === 'expansionIds' || key === 'languages' || key === 'lastListing') return JSON.stringify(value);
  if (key === 'foil') return value ? 1 : 0;
  return value as SqlValue;
}

function expansionNames(db: Db, cardId: number): string[] {
  const rows = db
    .prepare('SELECT DISTINCT expansion_name AS name FROM card_blueprints WHERE tracked_card_id = ? ORDER BY expansion_name')
    .all(cardId) as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

function toCard(db: Db, r: CardRecord): TrackedCard {
  const expansionIds = JSON.parse(r.expansion_ids) as number[];
  return {
    id: r.id,
    name: r.name,
    scryfallOracleId: r.scryfall_oracle_id,
    imageUrl: r.image_url,
    expansionIds,
    expansionNames: expansionIds.length > 0 ? expansionNames(db, r.id) : [],
    languages: JSON.parse(r.languages) as Language[],
    minCondition: r.min_condition as Condition,
    foil: r.foil === 1,
    thresholdCents: r.threshold_cents,
    configVersion: r.config_version,
    lastPriceCents: r.last_price_cents,
    lastListing: r.last_listing ? (JSON.parse(r.last_listing) as Listing) : null,
    lastSyncedAt: r.last_synced_at,
    lastSyncStatus: r.last_sync_status as SyncStatus | null,
    lastError: r.last_error,
    alertState: r.alert_state as AlertState | null,
    lastNotifiedPriceCents: r.last_notified_price_cents,
    blueprintsResolvedAt: r.blueprints_resolved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listCards(db: Db): TrackedCard[] {
  const rows = db.prepare('SELECT * FROM tracked_cards ORDER BY name COLLATE NOCASE, id').all() as unknown as CardRecord[];
  return rows.map((r) => toCard(db, r));
}

export function getCard(db: Db, id: number): TrackedCard | null {
  const row = db.prepare('SELECT * FROM tracked_cards WHERE id = ?').get(id) as unknown as CardRecord | undefined;
  return row ? toCard(db, row) : null;
}

export function insertCard(db: Db, c: NewCard, now: Date = new Date()): TrackedCard {
  const iso = now.toISOString();
  const res = db
    .prepare(
      `INSERT INTO tracked_cards
        (name, scryfall_oracle_id, image_url, expansion_ids, languages, min_condition, foil, threshold_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.name,
      c.scryfallOracleId,
      c.imageUrl,
      JSON.stringify(c.expansionIds),
      JSON.stringify(c.languages),
      c.minCondition,
      c.foil ? 1 : 0,
      c.thresholdCents,
      iso,
      iso,
    );
  return getCard(db, Number(res.lastInsertRowid))!;
}

export function updateCard(db: Db, id: number, patch: CardPatch, now: Date = new Date()): TrackedCard {
  const keys = (Object.keys(patch) as (keyof CardPatch)[]).filter((k) => patch[k] !== undefined);
  const sets = [...keys.map((k) => `${COLUMNS[k]} = ?`), 'updated_at = ?'];
  const values: SqlValue[] = [...keys.map((k) => encode(k, patch[k])), now.toISOString()];
  const res = db.prepare(`UPDATE tracked_cards SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  if (Number(res.changes) === 0) throw new NotFoundError('Carta non trovata');
  return getCard(db, id)!;
}

export function deleteCard(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM tracked_cards WHERE id = ?').run(id).changes) > 0;
}

export function getBlueprints(db: Db, cardId: number): CardBlueprint[] {
  return db
    .prepare(
      `SELECT blueprint_id AS blueprintId, expansion_id AS expansionId, expansion_name AS expansionName
       FROM card_blueprints WHERE tracked_card_id = ? ORDER BY blueprint_id`,
    )
    .all(cardId) as unknown as CardBlueprint[];
}

export function replaceBlueprints(db: Db, cardId: number, blueprints: CardBlueprint[]): void {
  transaction(db, () => {
    db.prepare('DELETE FROM card_blueprints WHERE tracked_card_id = ?').run(cardId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO card_blueprints (tracked_card_id, blueprint_id, expansion_id, expansion_name) VALUES (?, ?, ?, ?)',
    );
    for (const b of blueprints) insert.run(cardId, b.blueprintId, b.expansionId, b.expansionName);
  });
}

export interface Snapshot {
  configVersion: number;
  syncedAt: string;
  priceCents: number | null;
}

export function insertSnapshot(db: Db, s: Snapshot & { cardId: number }): void {
  db.prepare('INSERT INTO price_snapshots (tracked_card_id, config_version, synced_at, price_cents) VALUES (?, ?, ?, ?)').run(
    s.cardId,
    s.configVersion,
    s.syncedAt,
    s.priceCents,
  );
}

export function listSnapshots(db: Db, cardId: number): Snapshot[] {
  return db
    .prepare(
      `SELECT config_version AS configVersion, synced_at AS syncedAt, price_cents AS priceCents
       FROM price_snapshots WHERE tracked_card_id = ? ORDER BY id`,
    )
    .all(cardId) as unknown as Snapshot[];
}
```

Nota: `node:sqlite` restituisce oggetti con prototype `null`. `toEqual` di Vitest li confronta per contenuto, quindi i test passano. Se un confronto fallisse per il prototype, mappare con `{ ...row }`.

`server/src/db/runs-repo.ts`:
```ts
import type { RunStatus, SyncRun, SyncTrigger } from '@ctzero/shared';
import type { Db } from './db';

interface RunRecord {
  id: number;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  cards_total: number;
  cards_done: number;
  cards_error: number;
  error: string | null;
  report_sent: number;
  report_error: string | null;
}

function toRun(r: RunRecord): SyncRun {
  return {
    id: r.id,
    trigger: r.trigger as SyncTrigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status as RunStatus,
    cardsTotal: r.cards_total,
    cardsDone: r.cards_done,
    cardsError: r.cards_error,
    error: r.error,
    reportSent: r.report_sent === 1,
    reportError: r.report_error,
  };
}

function one(db: Db, sql: string, ...params: (string | number)[]): SyncRun | null {
  const row = db.prepare(sql).get(...params) as unknown as RunRecord | undefined;
  return row ? toRun(row) : null;
}

export function startRun(db: Db, trigger: SyncTrigger, cardsTotal: number, now: Date = new Date()): SyncRun {
  const res = db
    .prepare(`INSERT INTO sync_runs (trigger, started_at, status, cards_total) VALUES (?, ?, 'running', ?)`)
    .run(trigger, now.toISOString(), cardsTotal);
  return getRun(db, Number(res.lastInsertRowid))!;
}

export function updateRunProgress(db: Db, id: number, cardsDone: number, cardsError: number): void {
  db.prepare('UPDATE sync_runs SET cards_done = ?, cards_error = ? WHERE id = ?').run(cardsDone, cardsError, id);
}

export interface RunOutcome {
  status: Exclude<RunStatus, 'running'>;
  error?: string | null;
  reportSent?: boolean;
  reportError?: string | null;
}

export function finishRun(db: Db, id: number, o: RunOutcome, now: Date = new Date()): void {
  db.prepare(
    'UPDATE sync_runs SET status = ?, finished_at = ?, error = ?, report_sent = ?, report_error = ? WHERE id = ?',
  ).run(o.status, now.toISOString(), o.error ?? null, o.reportSent ? 1 : 0, o.reportError ?? null, id);
}

export function getRun(db: Db, id: number): SyncRun | null {
  return one(db, 'SELECT * FROM sync_runs WHERE id = ?', id);
}

export function getRunningRun(db: Db): SyncRun | null {
  return one(db, `SELECT * FROM sync_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1`);
}

/** Ultimo giro terminato, con qualunque esito: base per la pianificazione. */
export function getLastFinishedRun(db: Db): SyncRun | null {
  return one(db, `SELECT * FROM sync_runs WHERE status != 'running' ORDER BY finished_at DESC, id DESC LIMIT 1`);
}

/** Chiude i giri rimasti 'running' (processo terminato a metà). */
export function failOrphanRuns(db: Db): number {
  const res = db
    .prepare(
      `UPDATE sync_runs SET status = 'failed', finished_at = started_at,
         error = 'Interrotto: il processo è stato chiuso durante il giro'
       WHERE status = 'running'`,
    )
    .run();
  return Number(res.changes);
}
```

`server/src/db/settings-repo.ts`:
```ts
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@ctzero/shared';
import { transaction, type Db } from './db';

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[];
  const raw: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      raw[r.key] = JSON.parse(r.value);
    } catch {
      // valore illeggibile: resta il default
    }
  }
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export function saveSettings(db: Db, s: Settings): void {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  transaction(db, () => {
    for (const [key, value] of Object.entries(s)) upsert.run(key, JSON.stringify(value));
  });
}
```

- [ ] **Step 5: Verificare**

Run: `npx vitest run server/src/db && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 7: Catalogo (Scryfall → blueprint CardTrader) e prezzo di una carta

**Files:**
- Create: `server/src/catalog/catalog.ts`, `server/src/pricing/card-pricer.ts`
- Test: `server/src/catalog/catalog.test.ts`, `server/src/pricing/card-pricer.test.ts`

**Interfaces:**
- Consumes: `CardTraderClient`, `MTG_GAME_ID`, `CtExpansion` (Task 5); `ScryfallClient`, `cardImage` (Task 5); `ValidationError` (Task 6); `cheapestListing`, `ListingFilter` (Task 2); `CardBlueprint`, `Printing`, `Listing` da shared
- Produces:
  - `interface CardLookup { name: string; oracleId: string; imageUrl: string | null; printings: Printing[]; scryfallIdsByExpansion: Map<number, Set<string>> }`
  - `class Catalog(ct, scryfall, now?: () => number)` con `mtgExpansions(): Promise<CtExpansion[]>` (cache 24 h), `lookup(name: string): Promise<CardLookup>`, `resolveBlueprints(lookup: CardLookup, expansionIds: number[]): Promise<CardBlueprint[]>` (`[]` = tutte; lancia `ValidationError` se il risultato è vuoto)
  - `type PriceResult = { status: 'ok'; priceCents: number; listing: Listing } | { status: 'no_offers' }`
  - `priceCard(ct: Pick<CardTraderClient, 'products'>, blueprints: CardBlueprint[], filter: ListingFilter): Promise<PriceResult>`

- [ ] **Step 1: Test che falliscono**

`server/src/catalog/catalog.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardTraderClient, CtBlueprint, CtExpansion } from '../clients/cardtrader';
import type { ScryfallCard, ScryfallClient } from '../clients/scryfall';
import { ValidationError } from '../errors';
import { Catalog } from './catalog';

const expansions: CtExpansion[] = [
  { id: 1, game_id: 1, code: 'mh2', name: 'Modern Horizons 2' },
  { id: 2, game_id: 1, code: 'M10', name: 'Magic 2010' },
  { id: 3, game_id: 5, code: 'mh2', name: 'Altro gioco' },
];
const print = (id: string, set: string): ScryfallCard => ({ id, oracle_id: 'o1', name: 'Ragavan', set, set_name: set });
const prints = [print('s-mh2', 'mh2'), print('s-m10', 'm10'), print('s-unk', 'zzz')];
const blueprintsByExpansion: Record<number, CtBlueprint[]> = {
  1: [
    { id: 100, name: 'Ragavan', expansion_id: 1, scryfall_id: 's-mh2' },
    { id: 101, name: 'Altra', expansion_id: 1, scryfall_id: 'altro' },
    { id: 102, name: 'Senza id', expansion_id: 1, scryfall_id: null },
  ],
  2: [{ id: 200, name: 'Ragavan', expansion_id: 2, scryfall_id: 's-m10' }],
};

let ct: { expansions: ReturnType<typeof vi.fn>; blueprints: ReturnType<typeof vi.fn> };
let scryfall: { named: ReturnType<typeof vi.fn>; prints: ReturnType<typeof vi.fn> };
let clock: number;
let catalog: Catalog;

beforeEach(() => {
  ct = {
    expansions: vi.fn(async () => expansions),
    blueprints: vi.fn(async (id: number) => blueprintsByExpansion[id] ?? []),
  };
  scryfall = {
    named: vi.fn(async () => ({ ...print('s-mh2', 'mh2'), name: 'Ragavan, Nimble Pilferer', image_uris: { small: 'img' } })),
    prints: vi.fn(async () => prints),
  };
  clock = 0;
  catalog = new Catalog(ct as unknown as CardTraderClient, scryfall as unknown as ScryfallClient, () => clock);
});

describe('Catalog.lookup', () => {
  it('mappa le stampe Scryfall sulle espansioni CardTrader di Magic', async () => {
    const lookup = await catalog.lookup('ragavan');
    expect(scryfall.named).toHaveBeenCalledWith('ragavan');
    expect(scryfall.prints).toHaveBeenCalledWith('o1');
    expect(lookup.name).toBe('Ragavan, Nimble Pilferer');
    expect(lookup.oracleId).toBe('o1');
    expect(lookup.imageUrl).toBe('img');
    expect(lookup.printings).toEqual([
      { expansionId: 1, expansionName: 'Modern Horizons 2', code: 'mh2' },
      { expansionId: 2, expansionName: 'Magic 2010', code: 'M10' },
    ]);
  });

  it('mette in cache le espansioni per 24 ore', async () => {
    await catalog.lookup('a');
    await catalog.lookup('b');
    expect(ct.expansions).toHaveBeenCalledTimes(1);
    clock = 25 * 3600 * 1000;
    await catalog.lookup('c');
    expect(ct.expansions).toHaveBeenCalledTimes(2);
  });
});

describe('Catalog.resolveBlueprints', () => {
  it('con espansione "qualsiasi" usa tutte le stampe', async () => {
    const lookup = await catalog.lookup('ragavan');
    await expect(catalog.resolveBlueprints(lookup, [])).resolves.toEqual([
      { blueprintId: 100, expansionId: 1, expansionName: 'Modern Horizons 2' },
      { blueprintId: 200, expansionId: 2, expansionName: 'Magic 2010' },
    ]);
  });

  it('con espansioni specifiche scarica solo quelle', async () => {
    const lookup = await catalog.lookup('ragavan');
    await expect(catalog.resolveBlueprints(lookup, [2])).resolves.toEqual([
      { blueprintId: 200, expansionId: 2, expansionName: 'Magic 2010' },
    ]);
    expect(ct.blueprints).toHaveBeenCalledTimes(1);
    expect(ct.blueprints).toHaveBeenCalledWith(2);
  });

  it('senza blueprint abbinati lancia ValidationError', async () => {
    const lookup = await catalog.lookup('ragavan');
    await expect(catalog.resolveBlueprints(lookup, [99])).rejects.toBeInstanceOf(ValidationError);
  });
});
```

`server/src/pricing/card-pricer.test.ts`:
```ts
import type { CardBlueprint } from '@ctzero/shared';
import { describe, expect, it, vi } from 'vitest';
import type { CtProduct } from '../clients/cardtrader-types';
import { makeProduct } from '../test-utils';
import { priceCard } from './card-pricer';
import type { ListingFilter } from './listings';

const blueprints: CardBlueprint[] = [
  { blueprintId: 100, expansionId: 1, expansionName: 'MH2' },
  { blueprintId: 200, expansionId: 2, expansionName: 'M10' },
];
const anyLang: ListingFilter = { minCondition: 'Near Mint', foil: false, languages: [] };

function fakeCt(byBlueprint: Record<number, CtProduct[]>) {
  return { products: vi.fn(async (id: number) => byBlueprint[id] ?? []) };
}

describe('priceCard', () => {
  it('prende la più economica tra tutti i blueprint', async () => {
    const ct = fakeCt({
      100: [makeProduct({ id: 1, blueprint_id: 100, price: { cents: 1500, currency: 'EUR' } })],
      200: [makeProduct({ id: 2, blueprint_id: 200, price: { cents: 1200, currency: 'EUR' } })],
    });
    const result = await priceCard(ct, blueprints, anyLang);
    expect(result).toMatchObject({ status: 'ok', priceCents: 1200, listing: { productId: 2, expansionName: 'M10' } });
    expect(ct.products).toHaveBeenCalledWith(100, { foil: false, language: undefined });
    expect(ct.products).toHaveBeenCalledTimes(2);
  });

  it('con più lingue fa una chiamata per lingua', async () => {
    const ct = fakeCt({});
    await priceCard(ct, blueprints, { ...anyLang, foil: true, languages: ['en', 'it'] });
    expect(ct.products).toHaveBeenCalledTimes(4);
    expect(ct.products).toHaveBeenCalledWith(200, { foil: true, language: 'it' });
  });

  it('senza inserzioni valide → no_offers', async () => {
    const ct = fakeCt({ 100: [makeProduct({ blueprint_id: 100, hub: false })] });
    await expect(priceCard(ct, blueprints, anyLang)).resolves.toEqual({ status: 'no_offers' });
  });

  it('senza blueprint non chiama la rete', async () => {
    const ct = fakeCt({});
    await expect(priceCard(ct, [], anyLang)).resolves.toEqual({ status: 'no_offers' });
    expect(ct.products).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/catalog server/src/pricing/card-pricer.test.ts`
Expected: FAIL, moduli mancanti.

- [ ] **Step 3: Implementare**

`server/src/catalog/catalog.ts`:
```ts
import type { CardBlueprint, Printing } from '@ctzero/shared';
import { MTG_GAME_ID, type CardTraderClient, type CtExpansion } from '../clients/cardtrader';
import { cardImage, type ScryfallClient } from '../clients/scryfall';
import { ValidationError } from '../errors';

const EXPANSIONS_TTL_MS = 24 * 3600 * 1000;

export interface CardLookup {
  name: string;
  oracleId: string;
  imageUrl: string | null;
  /** Espansioni CardTrader in cui la carta è stata stampata. */
  printings: Printing[];
  /** Per ogni espansione CardTrader, gli id Scryfall delle stampe della carta. */
  scryfallIdsByExpansion: Map<number, Set<string>>;
}

export class Catalog {
  private expansionsCache: { fetchedAt: number; list: CtExpansion[] } | null = null;

  constructor(
    private readonly ct: CardTraderClient,
    private readonly scryfall: ScryfallClient,
    private readonly now: () => number = Date.now,
  ) {}

  async mtgExpansions(): Promise<CtExpansion[]> {
    const cached = this.expansionsCache;
    if (cached && this.now() - cached.fetchedAt < EXPANSIONS_TTL_MS) return cached.list;
    const list = (await this.ct.expansions()).filter((e) => e.game_id === MTG_GAME_ID);
    this.expansionsCache = { fetchedAt: this.now(), list };
    return list;
  }

  async lookup(name: string): Promise<CardLookup> {
    const card = await this.scryfall.named(name);
    const prints = await this.scryfall.prints(card.oracle_id);
    const byCode = new Map((await this.mtgExpansions()).map((e) => [e.code.toLowerCase(), e]));
    const printings: Printing[] = [];
    const ids = new Map<number, Set<string>>();
    for (const p of prints) {
      const exp = byCode.get(p.set.toLowerCase());
      if (!exp) continue;
      let set = ids.get(exp.id);
      if (!set) {
        set = new Set();
        ids.set(exp.id, set);
        printings.push({ expansionId: exp.id, expansionName: exp.name, code: exp.code });
      }
      set.add(p.id);
    }
    return { name: card.name, oracleId: card.oracle_id, imageUrl: cardImage(card), printings, scryfallIdsByExpansion: ids };
  }

  /** `expansionIds` vuoto = tutte le espansioni in cui esiste la carta. */
  async resolveBlueprints(lookup: CardLookup, expansionIds: number[]): Promise<CardBlueprint[]> {
    const available = lookup.scryfallIdsByExpansion;
    const targets = expansionIds.length > 0 ? expansionIds.filter((id) => available.has(id)) : [...available.keys()];
    const names = new Map(lookup.printings.map((p) => [p.expansionId, p.expansionName]));
    const out: CardBlueprint[] = [];
    for (const expansionId of targets) {
      const wanted = available.get(expansionId)!;
      for (const bp of await this.ct.blueprints(expansionId)) {
        if (bp.scryfall_id && wanted.has(bp.scryfall_id)) {
          out.push({ blueprintId: bp.id, expansionId, expansionName: names.get(expansionId) ?? '' });
        }
      }
    }
    if (out.length === 0) {
      throw new ValidationError(`Nessuna stampa di "${lookup.name}" trovata su CardTrader per le espansioni selezionate`);
    }
    return out;
  }
}
```

`server/src/pricing/card-pricer.ts`:
```ts
import type { CardBlueprint, Listing } from '@ctzero/shared';
import type { CardTraderClient } from '../clients/cardtrader';
import type { CtProduct } from '../clients/cardtrader-types';
import { cheapestListing, type ListingFilter } from './listings';

export type PriceResult = { status: 'ok'; priceCents: number; listing: Listing } | { status: 'no_offers' };

export async function priceCard(
  ct: Pick<CardTraderClient, 'products'>,
  blueprints: CardBlueprint[],
  filter: ListingFilter,
): Promise<PriceResult> {
  // Una chiamata per lingua: il marketplace restituisce solo le 25 inserzioni più economiche.
  const languages: (string | undefined)[] = filter.languages.length > 0 ? filter.languages : [undefined];
  const products: CtProduct[] = [];
  for (const bp of blueprints) {
    for (const language of languages) {
      products.push(...(await ct.products(bp.blueprintId, { foil: filter.foil, language })));
    }
  }
  const names = new Map(blueprints.map((b) => [b.blueprintId, b.expansionName]));
  const listing = cheapestListing(products, filter, names);
  return listing ? { status: 'ok', priceCents: listing.priceCents, listing } : { status: 'no_offers' };
}
```

- [ ] **Step 4: Verificare**

Run: `npx vitest run server/src/catalog server/src/pricing && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 8: CardService (creazione, modifica, anteprima, valutazione silenziosa)

**Files:**
- Create: `server/src/cards/card-service.ts`
- Test: `server/src/cards/card-service.test.ts`

**Interfaces:**
- Consumes: repository (Task 6), `Catalog`/`CardLookup` (Task 7), `priceCard` (Task 7), `thresholdPresets` (Task 2), `evaluateSilently` (Task 3), `NotFoundError`/`errorMessage` (Task 6)
- Produces: `class CardService({ db, catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>, ct: Pick<CardTraderClient, 'products'>, now?: () => Date })` con:
  - `list(): TrackedCard[]`
  - `preview(f: CardFilters): Promise<PreviewResult>` (non scrive nulla)
  - `create(input: CardInput): Promise<TrackedCard>`
  - `update(id: number, input: CardUpdate): Promise<TrackedCard>`
  - `delete(id: number): void` (lancia `NotFoundError`)

- [ ] **Step 1: Test che falliscono**

`server/src/cards/card-service.test.ts`:
```ts
import type { CardBlueprint, CardInput } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardLookup } from '../catalog/catalog';
import { getBlueprints, getCard, listCards, listSnapshots } from '../db/cards-repo';
import { openDb, type Db } from '../db/db';
import { NotFoundError, ValidationError } from '../errors';
import { makeProduct } from '../test-utils';
import { CardService } from './card-service';

const t0 = new Date('2026-10-02T10:00:00.000Z');
const lookup: CardLookup = {
  name: 'Ragavan, Nimble Pilferer',
  oracleId: 'o1',
  imageUrl: 'img',
  printings: [{ expansionId: 1, expansionName: 'MH2', code: 'mh2' }],
  scryfallIdsByExpansion: new Map([[1, new Set(['s1'])]]),
};
const blueprints: CardBlueprint[] = [{ blueprintId: 100, expansionId: 1, expansionName: 'MH2' }];
const input: CardInput = {
  name: 'ragavan',
  expansionIds: [1],
  languages: ['en'],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 4000,
};
const { name: _name, ...update } = input;

let db: Db;
let price: number;
let catalog: { lookup: ReturnType<typeof vi.fn>; resolveBlueprints: ReturnType<typeof vi.fn> };
let ct: { products: ReturnType<typeof vi.fn> };
let service: CardService;

beforeEach(() => {
  db = openDb(':memory:');
  price = 3800;
  catalog = { lookup: vi.fn(async () => lookup), resolveBlueprints: vi.fn(async () => blueprints) };
  ct = {
    products: vi.fn(async () => [makeProduct({ blueprint_id: 100, price: { cents: price, currency: 'EUR' } })]),
  };
  service = new CardService({ db, catalog, ct, now: () => t0 });
});

describe('create', () => {
  it('salva, aggiorna subito e valuta in silenzio (sotto soglia)', async () => {
    const card = await service.create(input);
    expect(catalog.lookup).toHaveBeenCalledWith('ragavan');
    expect(card).toMatchObject({
      name: 'Ragavan, Nimble Pilferer',
      imageUrl: 'img',
      scryfallOracleId: 'o1',
      lastPriceCents: 3800,
      lastSyncStatus: 'ok',
      alertState: 'below',
      lastNotifiedPriceCents: 3800,
      blueprintsResolvedAt: t0.toISOString(),
      lastSyncedAt: t0.toISOString(),
    });
    expect(card.lastListing?.expansionName).toBe('MH2');
    expect(getBlueprints(db, card.id)).toEqual(blueprints);
    expect(listSnapshots(db, card.id)).toEqual([{ configVersion: 1, syncedAt: t0.toISOString(), priceCents: 3800 }]);
  });

  it('sopra soglia → above', async () => {
    price = 4500;
    const card = await service.create(input);
    expect(card).toMatchObject({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('se il prezzo fallisce la carta resta salvata con errore', async () => {
    ct.products.mockRejectedValueOnce(new Error('timeout'));
    const card = await service.create(input);
    expect(card).toMatchObject({ lastSyncStatus: 'error', lastError: 'timeout', alertState: null });
    expect(listCards(db)).toHaveLength(1);
  });

  it('senza blueprint non salva nulla', async () => {
    catalog.resolveBlueprints.mockRejectedValueOnce(new ValidationError('nessuna stampa'));
    await expect(service.create(input)).rejects.toBeInstanceOf(ValidationError);
    expect(listCards(db)).toEqual([]);
  });
});

describe('update', () => {
  it('solo soglia: nessuna chiamata esterna, stato ricalcolato', async () => {
    const card = await service.create(input);
    const updated = await service.update(card.id, { ...update, thresholdCents: 3000 });
    expect(updated).toMatchObject({ thresholdCents: 3000, alertState: 'above', lastNotifiedPriceCents: null, configVersion: 1 });
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
    expect(ct.products).toHaveBeenCalledTimes(1);
  });

  it("lingue nello stesso insieme ma in ordine diverso non contano come cambio filtri", async () => {
    const card = await service.create({ ...input, languages: ['en', 'it'] });
    await service.update(card.id, { ...update, languages: ['it', 'en'] });
    expect(catalog.lookup).toHaveBeenCalledTimes(1);
  });

  it('cambio filtri: reset stato, nuova versione, blueprint ricalcolati e nuovo prezzo', async () => {
    const card = await service.create(input);
    price = 5000;
    const updated = await service.update(card.id, { ...update, foil: true });
    expect(catalog.lookup).toHaveBeenLastCalledWith('Ragavan, Nimble Pilferer');
    expect(updated).toMatchObject({ foil: true, configVersion: 2, lastPriceCents: 5000, alertState: 'above' });
    expect(listSnapshots(db, card.id).map((s) => s.configVersion)).toEqual([1, 2]);
  });

  it('cambio filtri senza blueprint: la carta resta com’era', async () => {
    const card = await service.create(input);
    catalog.resolveBlueprints.mockRejectedValueOnce(new ValidationError('nessuna stampa'));
    await expect(service.update(card.id, { ...update, expansionIds: [99] })).rejects.toBeInstanceOf(ValidationError);
    expect(getCard(db, card.id)).toMatchObject({ expansionIds: [1], configVersion: 1, alertState: 'below' });
  });

  it('id inesistente → NotFoundError', async () => {
    await expect(service.update(999, update)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('delete', () => {
  it('id inesistente → NotFoundError', () => {
    expect(() => service.delete(999)).toThrow(NotFoundError);
  });
});

describe('preview', () => {
  it('calcola prezzo e preset senza salvare', async () => {
    const result = await service.preview({ name: 'ragavan', expansionIds: [], languages: [], minCondition: 'Near Mint', foil: false });
    expect(result.priceCents).toBe(3800);
    expect(result.blueprintCount).toBe(1);
    expect(result.presets[0]).toEqual({ label: '-10%', cents: 3420 });
    expect(result.listing?.expansionName).toBe('MH2');
    expect(listCards(db)).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/cards`
Expected: FAIL, modulo `./card-service` non trovato.

- [ ] **Step 3: Implementare**

`server/src/cards/card-service.ts`:
```ts
import type { CardBlueprint, CardFilters, CardInput, CardUpdate, PreviewResult, TrackedCard } from '@ctzero/shared';
import { evaluateSilently } from '../alerts/rules';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import {
  deleteCard,
  getCard,
  insertCard,
  insertSnapshot,
  listCards,
  replaceBlueprints,
  updateCard,
} from '../db/cards-repo';
import { transaction, type Db } from '../db/db';
import { NotFoundError, errorMessage } from '../errors';
import { priceCard } from '../pricing/card-pricer';
import { thresholdPresets } from '../pricing/presets';

export interface CardServiceDeps {
  db: Db;
  catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>;
  ct: Pick<CardTraderClient, 'products'>;
  now?: () => Date;
}

function sameSet<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function filtersChanged(card: TrackedCard, input: CardUpdate): boolean {
  return (
    !sameSet(card.expansionIds, input.expansionIds) ||
    !sameSet(card.languages, input.languages) ||
    card.minCondition !== input.minCondition ||
    card.foil !== input.foil
  );
}

export class CardService {
  constructor(private readonly deps: CardServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  list(): TrackedCard[] {
    return listCards(this.deps.db);
  }

  async preview(f: CardFilters): Promise<PreviewResult> {
    const lookup = await this.deps.catalog.lookup(f.name);
    const blueprints = await this.deps.catalog.resolveBlueprints(lookup, f.expansionIds);
    const result = await priceCard(this.deps.ct, blueprints, f);
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    return {
      priceCents,
      listing: result.status === 'ok' ? result.listing : null,
      presets: thresholdPresets(priceCents),
      blueprintCount: blueprints.length,
    };
  }

  async create(input: CardInput): Promise<TrackedCard> {
    const { db, catalog } = this.deps;
    const lookup = await catalog.lookup(input.name);
    const blueprints = await catalog.resolveBlueprints(lookup, input.expansionIds);
    const now = this.now();
    const card = transaction(db, () => {
      const created = insertCard(
        db,
        {
          name: lookup.name,
          scryfallOracleId: lookup.oracleId,
          imageUrl: lookup.imageUrl,
          expansionIds: input.expansionIds,
          languages: input.languages,
          minCondition: input.minCondition,
          foil: input.foil,
          thresholdCents: input.thresholdCents,
        },
        now,
      );
      replaceBlueprints(db, created.id, blueprints);
      return updateCard(db, created.id, { blueprintsResolvedAt: now.toISOString() }, now);
    });
    return this.refreshSilently(card, blueprints);
  }

  async update(id: number, input: CardUpdate): Promise<TrackedCard> {
    const { db, catalog } = this.deps;
    const card = getCard(db, id);
    if (!card) throw new NotFoundError('Carta non trovata');
    const now = this.now();

    if (!filtersChanged(card, input)) {
      return updateCard(
        db,
        id,
        { thresholdCents: input.thresholdCents, ...evaluateSilently(card.lastPriceCents, input.thresholdCents) },
        now,
      );
    }

    // Prima si risolvono i blueprint: se fallisce, la carta resta invariata.
    const lookup = await catalog.lookup(card.name);
    const blueprints = await catalog.resolveBlueprints(lookup, input.expansionIds);
    const updated = transaction(db, () => {
      replaceBlueprints(db, id, blueprints);
      return updateCard(
        db,
        id,
        {
          expansionIds: input.expansionIds,
          languages: input.languages,
          minCondition: input.minCondition,
          foil: input.foil,
          thresholdCents: input.thresholdCents,
          configVersion: card.configVersion + 1,
          lastPriceCents: null,
          lastListing: null,
          lastSyncedAt: null,
          lastSyncStatus: null,
          lastError: null,
          alertState: null,
          lastNotifiedPriceCents: null,
          blueprintsResolvedAt: now.toISOString(),
        },
        now,
      );
    });
    return this.refreshSilently(updated, blueprints);
  }

  delete(id: number): void {
    if (!deleteCard(this.deps.db, id)) throw new NotFoundError('Carta non trovata');
  }

  /** Aggiorna il prezzo di una sola carta senza inviare notifiche. */
  private async refreshSilently(card: TrackedCard, blueprints: CardBlueprint[]): Promise<TrackedCard> {
    const { db, ct } = this.deps;
    const now = this.now();
    const iso = now.toISOString();
    try {
      const result = await priceCard(ct, blueprints, card);
      const priceCents = result.status === 'ok' ? result.priceCents : null;
      return transaction(db, () => {
        insertSnapshot(db, { cardId: card.id, configVersion: card.configVersion, syncedAt: iso, priceCents });
        return updateCard(
          db,
          card.id,
          {
            lastPriceCents: priceCents,
            lastListing: result.status === 'ok' ? result.listing : null,
            lastSyncedAt: iso,
            lastSyncStatus: result.status,
            lastError: null,
            ...evaluateSilently(priceCents, card.thresholdCents),
          },
          now,
        );
      });
    } catch (e) {
      return updateCard(db, card.id, { lastSyncedAt: iso, lastSyncStatus: 'error', lastError: errorMessage(e) }, now);
    }
  }
}
```

- [ ] **Step 4: Verificare**

Run: `npx vitest run server/src/cards && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 9: SyncService (giro di aggiornamento)

**Files:**
- Create: `server/src/sync/sync-service.ts`
- Test: `server/src/sync/sync-service.test.ts`

**Interfaces:**
- Consumes: repository (Task 6), `priceCard` (Task 7), `Catalog` (Task 7), `evaluateAlert` (Task 3), `buildReport`/`buildFatalMessage`/`ReportItem`/`ReportError` (Task 4), `isFatalHttpError` (Task 5), `TelegramClient` (Task 5)
- Produces: `class SyncService({ db, catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>, ct: Pick<CardTraderClient, 'products'>, telegram: Pick<TelegramClient, 'sendMessage'>, now?: () => Date })` con:
  - `start(trigger: SyncTrigger): { started: boolean; run: SyncRun }` (se un giro è già in corso: `started: false` e il giro attivo)
  - `waitForIdle(): Promise<void>`
  - `onFinished(listener: (run: SyncRun) => void): void`

- [ ] **Step 1: Test che falliscono**

`server/src/sync/sync-service.test.ts`:
```ts
import { DEFAULT_SETTINGS, type CardBlueprint, type SyncTrigger, type TrackedCard } from '@ctzero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardLookup } from '../catalog/catalog';
import { HttpError } from '../clients/http';
import {
  deleteCard,
  getBlueprints,
  getCard,
  insertCard,
  listSnapshots,
  replaceBlueprints,
  updateCard,
  type NewCard,
} from '../db/cards-repo';
import { openDb, type Db } from '../db/db';
import { getRun } from '../db/runs-repo';
import { saveSettings } from '../db/settings-repo';
import { makeProduct } from '../test-utils';
import { SyncService } from './sync-service';

const t0 = new Date('2026-10-02T16:00:00.000Z');
const DAY = 24 * 3600 * 1000;

let db: Db;
let prices: Map<number, number | Error>;
let ct: { products: ReturnType<typeof vi.fn> };
let telegram: { sendMessage: ReturnType<typeof vi.fn> };
let catalog: { lookup: ReturnType<typeof vi.fn>; resolveBlueprints: ReturnType<typeof vi.fn> };
let service: SyncService;

beforeEach(() => {
  db = openDb(':memory:');
  prices = new Map();
  ct = {
    products: vi.fn(async (blueprintId: number) => {
      const p = prices.get(blueprintId);
      if (p instanceof Error) throw p;
      return p === undefined ? [] : [makeProduct({ blueprint_id: blueprintId, price: { cents: p, currency: 'EUR' } })];
    }),
  };
  telegram = { sendMessage: vi.fn(async () => {}) };
  catalog = { lookup: vi.fn(), resolveBlueprints: vi.fn() };
  service = new SyncService({ db, catalog, ct, telegram, now: () => t0 });
});

function addCard(name: string, blueprintId: number, thresholdCents: number, extra: Partial<NewCard> = {}): TrackedCard {
  const card = insertCard(
    db,
    {
      name,
      scryfallOracleId: name,
      imageUrl: null,
      expansionIds: [1],
      languages: [],
      minCondition: 'Near Mint',
      foil: false,
      thresholdCents,
      ...extra,
    },
    t0,
  );
  replaceBlueprints(db, card.id, [{ blueprintId, expansionId: 1, expansionName: 'MH2' }]);
  return updateCard(db, card.id, { blueprintsResolvedAt: t0.toISOString(), alertState: 'above' }, t0);
}

async function run(trigger: SyncTrigger = 'manual') {
  const { run: started } = service.start(trigger);
  await service.waitForIdle();
  return getRun(db, started.id)!;
}

describe('SyncService', () => {
  it('notifica le carte scese sotto soglia', async () => {
    const ragavan = addCard('Ragavan', 100, 4000);
    addCard('Bolt', 200, 100);
    prices.set(100, 3800).set(200, 500);
    const result = await run();
    expect(result).toMatchObject({ status: 'ok', cardsDone: 2, cardsError: 0, reportSent: true });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const text = telegram.sendMessage.mock.calls[0]![0] as string;
    expect(text).toContain('Sotto soglia');
    expect(text).toContain('Ragavan');
    expect(text).not.toContain('Bolt');
    expect(getCard(db, ragavan.id)).toMatchObject({
      alertState: 'below',
      lastNotifiedPriceCents: 3800,
      lastPriceCents: 3800,
      lastSyncStatus: 'ok',
      lastSyncedAt: t0.toISOString(),
    });
    expect(listSnapshots(db, ragavan.id)).toHaveLength(1);
    expect(catalog.lookup).not.toHaveBeenCalled();
  });

  it('nessun evento → nessun messaggio', async () => {
    addCard('Bolt', 200, 100);
    prices.set(200, 500);
    expect(await run()).toMatchObject({ status: 'ok', reportSent: false });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('errore su una carta → partial, il giro continua e il report ha la sezione Errori', async () => {
    const a = addCard('A', 100, 4000);
    addCard('B', 200, 100);
    prices.set(100, new HttpError(500, 'HTTP 500 da api.cardtrader.com')).set(200, 50);
    expect(await run()).toMatchObject({ status: 'partial', cardsDone: 2, cardsError: 1 });
    expect(getCard(db, a.id)).toMatchObject({
      lastSyncStatus: 'error',
      lastError: 'HTTP 500 da api.cardtrader.com',
      alertState: 'above',
    });
    const text = telegram.sendMessage.mock.calls[0]![0] as string;
    expect(text).toContain('❌');
    expect(text).toContain('HTTP 500');
    expect(text).toContain('Sotto soglia');
  });

  it('errore 401 → giro fallito, un solo avviso, carte successive non toccate', async () => {
    addCard('A', 100, 4000);
    const b = addCard('B', 200, 100);
    prices.set(100, new HttpError(401, 'HTTP 401 da api.cardtrader.com'));
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('401');
    expect(result.reportSent).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('Aggiornamento prezzi fallito');
    expect(ct.products).toHaveBeenCalledTimes(1);
    expect(getCard(db, b.id)!.lastSyncedAt).toBeNull();
  });

  it('un solo giro alla volta', async () => {
    addCard('A', 100, 4000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    ct.products.mockImplementationOnce(async () => {
      await gate;
      return [];
    });
    const first = service.start('manual');
    const second = service.start('scheduled');
    expect(first.started).toBe(true);
    expect(second).toEqual({ started: false, run: expect.objectContaining({ id: first.run.id }) });
    release();
    await service.waitForIdle();
    expect(getRun(db, first.run.id)!.status).toBe('ok');
  });

  it('una carta eliminata durante il giro viene saltata', async () => {
    addCard('A', 100, 4000);
    const b = addCard('B', 200, 100);
    ct.products.mockImplementationOnce(async () => {
      deleteCard(db, b.id);
      return [];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsDone: 2, cardsError: 0 });
    expect(ct.products).toHaveBeenCalledTimes(1);
  });

  it('una carta eliminata mentre viene prezzata non genera errori', async () => {
    const a = addCard('A', 100, 4000);
    ct.products.mockImplementationOnce(async () => {
      deleteCard(db, a.id);
      return [makeProduct({ blueprint_id: 100, price: { cents: 3000, currency: 'EUR' } })];
    });
    expect(await run()).toMatchObject({ status: 'ok', cardsError: 0 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('errore Telegram → reportError salvato, il giro resta ok', async () => {
    addCard('A', 100, 4000);
    prices.set(100, 3000);
    telegram.sendMessage.mockRejectedValueOnce(new Error('Telegram giù'));
    expect(await run()).toMatchObject({ status: 'ok', reportSent: false, reportError: 'Telegram giù' });
  });

  it('ri-risolve i blueprint delle carte "qualsiasi" dopo 7 giorni', async () => {
    const card = addCard('Bolt', 100, 4000, { expansionIds: [] });
    updateCard(db, card.id, { blueprintsResolvedAt: new Date(t0.getTime() - 8 * DAY).toISOString() }, t0);
    const lookup = { name: 'Bolt' } as CardLookup;
    const fresh: CardBlueprint[] = [{ blueprintId: 300, expansionId: 3, expansionName: 'M10' }];
    catalog.lookup.mockResolvedValueOnce(lookup);
    catalog.resolveBlueprints.mockResolvedValueOnce(fresh);
    prices.set(300, 3000);
    await run();
    expect(catalog.lookup).toHaveBeenCalledWith('Bolt');
    expect(catalog.resolveBlueprints).toHaveBeenCalledWith(lookup, []);
    expect(getBlueprints(db, card.id)).toEqual(fresh);
    expect(getCard(db, card.id)).toMatchObject({ blueprintsResolvedAt: t0.toISOString(), lastPriceCents: 3000 });
  });

  it('se la ri-risoluzione fallisce usa i blueprint esistenti', async () => {
    const card = addCard('Bolt', 100, 4000, { expansionIds: [] });
    updateCard(db, card.id, { blueprintsResolvedAt: new Date(t0.getTime() - 8 * DAY).toISOString() }, t0);
    catalog.lookup.mockRejectedValueOnce(new HttpError(0, 'Errore di rete verso api.scryfall.com'));
    prices.set(100, 4500);
    expect(await run()).toMatchObject({ status: 'ok' });
    expect(getCard(db, card.id)!.lastPriceCents).toBe(4500);
  });

  it('usa furtherDropPercent dalle impostazioni', async () => {
    saveSettings(db, { ...DEFAULT_SETTINGS, furtherDropPercent: 10 });
    const card = addCard('A', 100, 5000);
    updateCard(db, card.id, { alertState: 'below', lastNotifiedPriceCents: 4000 }, t0);
    prices.set(100, 3700); // -7,5%: sotto il 10%
    await run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    prices.set(100, 3600); // -10%
    await run();
    expect(telegram.sendMessage.mock.calls[0]![0]).toContain('Ulteriore calo');
  });

  it('avvisa i listener a fine giro', async () => {
    const listener = vi.fn();
    service.onFinished(listener);
    await run();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/sync`
Expected: FAIL, modulo `./sync-service` non trovato.

- [ ] **Step 3: Implementare**

`server/src/sync/sync-service.ts`:
```ts
import type { CardBlueprint, SyncRun, SyncTrigger, TrackedCard } from '@ctzero/shared';
import { buildFatalMessage, buildReport, type ReportError, type ReportItem } from '../alerts/report';
import { evaluateAlert } from '../alerts/rules';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { isFatalHttpError } from '../clients/http';
import type { TelegramClient } from '../clients/telegram';
import { getBlueprints, getCard, insertSnapshot, listCards, replaceBlueprints, updateCard } from '../db/cards-repo';
import { transaction, type Db } from '../db/db';
import { finishRun, getRun, getRunningRun, startRun, updateRunProgress } from '../db/runs-repo';
import { getSettings } from '../db/settings-repo';
import { errorMessage } from '../errors';
import { priceCard } from '../pricing/card-pricer';

const BLUEPRINT_REFRESH_MS = 7 * 24 * 3600 * 1000;

export interface SyncServiceDeps {
  db: Db;
  catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>;
  ct: Pick<CardTraderClient, 'products'>;
  telegram: Pick<TelegramClient, 'sendMessage'>;
  now?: () => Date;
}

export interface StartResult {
  started: boolean;
  run: SyncRun;
}

export class SyncService {
  private active: Promise<void> | null = null;
  private readonly listeners: ((run: SyncRun) => void)[] = [];

  constructor(private readonly deps: SyncServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  onFinished(listener: (run: SyncRun) => void): void {
    this.listeners.push(listener);
  }

  start(trigger: SyncTrigger): StartResult {
    const { db } = this.deps;
    const running = getRunningRun(db);
    if (running) return { started: false, run: running };
    const cardIds = listCards(db).map((c) => c.id);
    const run = startRun(db, trigger, cardIds.length, this.now());
    this.active = this.execute(run.id, cardIds).finally(() => {
      this.active = null;
      const finished = getRun(db, run.id);
      if (finished) for (const listener of this.listeners) listener(finished);
    });
    return { started: true, run };
  }

  async waitForIdle(): Promise<void> {
    await this.active;
  }

  /** Non rigetta mai: ogni errore finisce nell'esito del giro. */
  private async execute(runId: number, cardIds: number[]): Promise<void> {
    const { db, telegram } = this.deps;
    try {
      const { furtherDropPercent } = getSettings(db);
      const items: ReportItem[] = [];
      const errors: ReportError[] = [];
      let done = 0;

      for (const id of cardIds) {
        const card = getCard(db, id); // null se eliminata durante il giro
        if (card) {
          try {
            const item = await this.processCard(card, furtherDropPercent);
            if (item) items.push(item);
          } catch (e) {
            if (isFatalHttpError(e)) {
              await this.failRun(runId, errorMessage(e));
              return;
            }
            if (getCard(db, id)) {
              errors.push({ cardName: card.name, message: errorMessage(e) });
              const now = this.now();
              updateCard(db, id, { lastSyncedAt: now.toISOString(), lastSyncStatus: 'error', lastError: errorMessage(e) }, now);
            }
          }
        }
        done++;
        updateRunProgress(db, runId, done, errors.length);
      }

      const report = buildReport(items, errors, this.now());
      let reportSent = false;
      let reportError: string | null = null;
      if (report) {
        try {
          await telegram.sendMessage(report);
          reportSent = true;
        } catch (e) {
          reportError = errorMessage(e);
        }
      }
      finishRun(db, runId, { status: errors.length > 0 ? 'partial' : 'ok', reportSent, reportError }, this.now());
    } catch (e) {
      finishRun(db, runId, { status: 'failed', error: errorMessage(e) }, this.now());
    }
  }

  private async failRun(runId: number, message: string): Promise<void> {
    let reportSent = false;
    let reportError: string | null = null;
    try {
      await this.deps.telegram.sendMessage(buildFatalMessage(message, this.now()));
      reportSent = true;
    } catch (e) {
      reportError = errorMessage(e);
    }
    finishRun(this.deps.db, runId, { status: 'failed', error: message, reportSent, reportError }, this.now());
  }

  private async processCard(card: TrackedCard, furtherDropPercent: number): Promise<ReportItem | null> {
    const { db, ct } = this.deps;
    const blueprints = await this.blueprintsFor(card);
    const result = await priceCard(ct, blueprints, card);
    const now = this.now();
    const iso = now.toISOString();
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    const listing = result.status === 'ok' ? result.listing : null;
    const { next, event } = evaluateAlert(
      { alertState: card.alertState, lastNotifiedPriceCents: card.lastNotifiedPriceCents },
      result.status === 'ok' ? { status: 'ok', priceCents: result.priceCents } : { status: 'no_offers' },
      card.thresholdCents,
      furtherDropPercent,
    );
    transaction(db, () => {
      insertSnapshot(db, { cardId: card.id, configVersion: card.configVersion, syncedAt: iso, priceCents });
      updateCard(
        db,
        card.id,
        { lastPriceCents: priceCents, lastListing: listing, lastSyncedAt: iso, lastSyncStatus: result.status, lastError: null, ...next },
        now,
      );
    });
    return event ? { cardName: card.name, listing, event } : null;
  }

  /** Per le carte "qualsiasi espansione" ricalcola i blueprint ogni 7 giorni (nuove ristampe). */
  private async blueprintsFor(card: TrackedCard): Promise<CardBlueprint[]> {
    const { db, catalog } = this.deps;
    const current = getBlueprints(db, card.id);
    const resolvedAt = card.blueprintsResolvedAt ? Date.parse(card.blueprintsResolvedAt) : 0;
    if (card.expansionIds.length > 0 || this.now().getTime() - resolvedAt < BLUEPRINT_REFRESH_MS) return current;
    try {
      const lookup = await catalog.lookup(card.name);
      const fresh = await catalog.resolveBlueprints(lookup, []);
      const now = this.now();
      transaction(db, () => {
        replaceBlueprints(db, card.id, fresh);
        updateCard(db, card.id, { blueprintsResolvedAt: now.toISOString() }, now);
      });
      return fresh;
    } catch (e) {
      if (isFatalHttpError(e)) throw e;
      return current;
    }
  }
}
```

- [ ] **Step 4: Verificare**

Run: `npx vitest run server/src/sync && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 10: Scheduler

**Files:**
- Create: `server/src/scheduler/schedule.ts`, `server/src/scheduler/scheduler.ts`
- Test: `server/src/scheduler/schedule.test.ts`, `server/src/scheduler/scheduler.test.ts`

**Interfaces:**
- Consumes: `Settings` (shared), `getLastFinishedRun` (Task 6), `getSettings` (Task 6), `SyncService.start`/`onFinished` (Task 9)
- Produces:
  - `nextRunAt(lastFinishedAt: Date | null, s: Settings, now: Date): Date` (un risultato ≤ `now` significa "da eseguire subito")
  - `class Scheduler({ db, sync: Pick<SyncService, 'start' | 'onFinished'>, now?: () => Date, catchupDelayMs?: number })` con `start()`, `stop()`, `reschedule()`, `getNextRunAt(): Date | null`

- [ ] **Step 1: Test che falliscono**

`server/src/scheduler/schedule.test.ts`:
```ts
import { DEFAULT_SETTINGS, type Settings } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { nextRunAt } from './schedule';

const interval: Settings = { ...DEFAULT_SETTINGS, scheduleMode: 'interval', intervalHours: 6 };
const daily: Settings = { ...DEFAULT_SETTINGS, scheduleMode: 'daily', dailyTime: '09:00' };
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m); // ora locale, ottobre 2026

describe('nextRunAt — intervallo', () => {
  it('senza giri precedenti → subito', () => {
    expect(nextRunAt(null, interval, at(2, 12))).toEqual(at(2, 12));
  });

  it('ultimo giro + N ore', () => {
    expect(nextRunAt(at(2, 10), interval, at(2, 12))).toEqual(at(2, 16));
  });

  it('giro mancato → data nel passato', () => {
    expect(nextRunAt(at(2, 5), interval, at(2, 12)).getTime()).toBeLessThanOrEqual(at(2, 12).getTime());
  });
});

describe('nextRunAt — giornaliero', () => {
  it("prima dell'orario, con il giro di ieri fatto → oggi all'orario", () => {
    expect(nextRunAt(at(1, 9, 5), daily, at(2, 8))).toEqual(at(2, 9));
  });

  it("dopo l'orario, giro di oggi non fatto → dovuto (oggi 09:00)", () => {
    expect(nextRunAt(at(1, 9, 5), daily, at(2, 10))).toEqual(at(2, 9));
  });

  it("dopo l'orario, giro di oggi fatto → domani", () => {
    expect(nextRunAt(at(2, 9, 1), daily, at(2, 10))).toEqual(at(3, 9));
  });

  it('senza giri precedenti → dovuto (ultimo orario passato)', () => {
    expect(nextRunAt(null, daily, at(2, 8))).toEqual(at(1, 9));
  });
});
```

`server/src/scheduler/scheduler.test.ts`:
```ts
import { DEFAULT_SETTINGS, type SyncRun } from '@ctzero/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/db';
import { failOrphanRuns, finishRun, getRun, startRun } from '../db/runs-repo';
import { saveSettings } from '../db/settings-repo';
import { Scheduler } from './scheduler';

const HOUR = 3600 * 1000;
let db: Db;
let listeners: ((run: SyncRun) => void)[];
let sync: { start: ReturnType<typeof vi.fn>; onFinished: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, 12, 0));
  db = openDb(':memory:');
  listeners = [];
  sync = {
    start: vi.fn(() => ({ started: true, run: {} as SyncRun })),
    onFinished: vi.fn((l: (run: SyncRun) => void) => listeners.push(l)),
  };
});
afterEach(() => vi.useRealTimers());

const make = () => new Scheduler({ db, sync, catchupDelayMs: 30_000 });

function finishedRunAt(d: Date): SyncRun {
  const r = startRun(db, 'scheduled', 0, d);
  finishRun(db, r.id, { status: 'ok' }, d);
  return getRun(db, r.id)!;
}

describe('Scheduler', () => {
  it('al primo avvio fa un recupero dopo 30 secondi', () => {
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 30_000));
    vi.advanceTimersByTime(29_999);
    expect(sync.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sync.start).toHaveBeenCalledWith('catchup');
  });

  it('con un giro recente pianifica il prossimo intervallo', () => {
    finishedRunAt(new Date(Date.now() - HOUR));
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 5 * HOUR));
    vi.advanceTimersByTime(5 * HOUR);
    expect(sync.start).toHaveBeenCalledWith('scheduled');
  });

  it('a fine giro ripianifica dal giro appena concluso', () => {
    const s = make();
    s.start();
    vi.advanceTimersByTime(30_000);
    const run = finishedRunAt(new Date());
    listeners[0]!(run);
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 6 * HOUR));
  });

  it('reschedule applica le nuove impostazioni', () => {
    finishedRunAt(new Date(Date.now() - HOUR));
    const s = make();
    s.start();
    saveSettings(db, { ...DEFAULT_SETTINGS, scheduleMode: 'daily', dailyTime: '13:00' });
    s.reschedule();
    expect(s.getNextRunAt()).toEqual(new Date(2026, 9, 2, 13, 0));
  });

  it('stop annulla il timer', () => {
    const s = make();
    s.start();
    s.stop();
    vi.advanceTimersByTime(24 * HOUR);
    expect(sync.start).not.toHaveBeenCalled();
    expect(s.getNextRunAt()).toBeNull();
  });

  it('un giro orfano non impedisce il recupero all’avvio', () => {
    startRun(db, 'scheduled', 3, new Date(Date.now() - 7 * HOUR));
    failOrphanRuns(db);
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 30_000));
  });

  it('un giro fallito adesso non provoca giri a ripetizione', () => {
    const r = startRun(db, 'scheduled', 0, new Date());
    finishRun(db, r.id, { status: 'failed', error: 'HTTP 401' }, new Date());
    const s = make();
    s.start();
    expect(s.getNextRunAt()).toEqual(new Date(Date.now() + 6 * HOUR));
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/scheduler`
Expected: FAIL, moduli mancanti.

- [ ] **Step 3: Implementare**

`server/src/scheduler/schedule.ts`:
```ts
import type { Settings } from '@ctzero/shared';

const HOUR_MS = 3600 * 1000;

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function slotOn(day: Date, dailyTime: string): Date {
  const [hours, minutes] = dailyTime.split(':').map(Number);
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Prossima esecuzione prevista. Un risultato ≤ `now` significa che un giro è stato
 * saltato (PC spento) e va eseguito subito.
 */
export function nextRunAt(lastFinishedAt: Date | null, s: Settings, now: Date): Date {
  if (s.scheduleMode === 'interval') {
    return lastFinishedAt ? new Date(lastFinishedAt.getTime() + s.intervalHours * HOUR_MS) : now;
  }
  const today = slotOn(now, s.dailyTime);
  const latestSlot = today.getTime() <= now.getTime() ? today : addDays(today, -1);
  if (!lastFinishedAt || lastFinishedAt.getTime() < latestSlot.getTime()) return latestSlot;
  return addDays(latestSlot, 1);
}
```

`server/src/scheduler/scheduler.ts`:
```ts
import type { SyncTrigger } from '@ctzero/shared';
import type { Db } from '../db/db';
import { getLastFinishedRun } from '../db/runs-repo';
import { getSettings } from '../db/settings-repo';
import type { SyncService } from '../sync/sync-service';
import { nextRunAt } from './schedule';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface SchedulerDeps {
  db: Db;
  sync: Pick<SyncService, 'start' | 'onFinished'>;
  now?: () => Date;
  /** Attesa prima del giro di recupero all'avvio. */
  catchupDelayMs?: number;
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt: Date | null = null;
  private running = false;

  constructor(private readonly deps: SchedulerDeps) {
    // Ogni giro concluso (anche manuale) sposta la prossima esecuzione.
    deps.sync.onFinished(() => {
      if (this.running) this.plan(false);
    });
  }

  start(): void {
    this.running = true;
    this.plan(true);
  }

  stop(): void {
    this.running = false;
    this.clear();
    this.nextAt = null;
  }

  reschedule(): void {
    if (this.running) this.plan(false);
  }

  getNextRunAt(): Date | null {
    return this.nextAt;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private plan(isStartup: boolean): void {
    this.clear();
    const now = this.now();
    const last = getLastFinishedRun(this.deps.db);
    const due = nextRunAt(last?.finishedAt ? new Date(last.finishedAt) : null, getSettings(this.deps.db), now);
    let delay = due.getTime() - now.getTime();
    let trigger: SyncTrigger = 'scheduled';
    if (delay <= 0) {
      trigger = isStartup ? 'catchup' : 'scheduled';
      delay = isStartup ? (this.deps.catchupDelayMs ?? 30_000) : 0;
    }
    this.nextAt = new Date(now.getTime() + delay);
    this.timer = setTimeout(() => this.fire(trigger), Math.min(delay, MAX_TIMEOUT_MS));
  }

  private fire(trigger: SyncTrigger): void {
    this.timer = null;
    this.nextAt = null;
    // Se un giro è già in corso, la ripianificazione avverrà alla sua fine (onFinished).
    this.deps.sync.start(trigger);
  }
}
```

- [ ] **Step 4: Verificare**

Run: `npx vitest run server/src/scheduler && npm run typecheck`
Expected: PASS, nessun errore di tipo.

---

### Task 11: API REST e avvio del server

**Files:**
- Create: `server/src/api/app.ts`, `server/src/main.ts`
- Test: `server/src/api/app.test.ts`

**Interfaces:**
- Consumes: tutti i servizi precedenti; schemi zod da shared
- Produces:
  - `interface AppDeps { db; cards: Pick<CardService, 'list'|'create'|'update'|'delete'|'preview'>; sync: Pick<SyncService, 'start'>; scheduler: Pick<Scheduler, 'getNextRunAt'|'reschedule'>; catalog: Pick<Catalog, 'lookup'>; scryfall: Pick<ScryfallClient, 'autocomplete'>; telegram: Pick<TelegramClient, 'sendMessage'|'configured'>; cardtraderConfigured: boolean; webDistDir?: string; logger?: boolean }`
  - `buildApp(deps: AppDeps): FastifyInstance`
  - Rotte (tutte JSON, errori come `{ error: string }`):
    - `GET /api/cards` → `TrackedCard[]`
    - `POST /api/cards` (`CardInput`) → 201 `TrackedCard`
    - `PUT /api/cards/:id` (`CardUpdate`) → `TrackedCard`
    - `DELETE /api/cards/:id` → 204
    - `POST /api/cards/preview` (`CardFilters`) → `PreviewResult`
    - `GET /api/autocomplete?q=` → `string[]`
    - `GET /api/printings?name=` → `CardLookupDto`
    - `POST /api/sync` → 202 `{ run }` oppure 409 `{ error, run }`
    - `GET /api/sync/status` → `SyncStatusDto`
    - `GET /api/settings` / `PUT /api/settings` (`Settings`) → `Settings`
    - `GET /api/health` → `HealthDto`
    - `POST /api/telegram/test` → 204
  - Mappatura errori: `ZodError` → 400; `NotFoundError` → 404; `ValidationError` → 422; `HttpError` 404 → 404 "Carta non trovata"; altri `HttpError` → 502; altro → `statusCode` dell'errore o 500

- [ ] **Step 1: Test che falliscono**

`server/src/api/app.test.ts`:
```ts
import { DEFAULT_SETTINGS } from '@ctzero/shared';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../clients/http';
import { openDb } from '../db/db';
import { getSettings } from '../db/settings-repo';
import { NotFoundError, ValidationError } from '../errors';
import { buildApp, type AppDeps } from './app';

function setup() {
  const db = openDb(':memory:');
  const cards = {
    list: vi.fn(() => []),
    create: vi.fn(async (input: object) => ({ id: 1, ...input })),
    update: vi.fn(async (id: number, input: object) => ({ id, ...input })),
    delete: vi.fn(),
    preview: vi.fn(async () => ({ priceCents: 1000, listing: null, presets: [], blueprintCount: 1 })),
  };
  const sync = { start: vi.fn(() => ({ started: true, run: { id: 7 } })) };
  const scheduler = { getNextRunAt: vi.fn(() => new Date('2026-10-02T12:00:00.000Z')), reschedule: vi.fn() };
  const catalog = {
    lookup: vi.fn(async () => ({
      name: 'Ragavan',
      oracleId: 'o',
      imageUrl: 'img',
      printings: [{ expansionId: 1, expansionName: 'MH2', code: 'mh2' }],
      scryfallIdsByExpansion: new Map(),
    })),
  };
  const scryfall = { autocomplete: vi.fn(async () => ['Ragavan, Nimble Pilferer']) };
  const telegram = { configured: true, sendMessage: vi.fn(async () => {}) };
  const deps = { db, cards, sync, scheduler, catalog, scryfall, telegram, cardtraderConfigured: false };
  return { app: buildApp(deps as unknown as AppDeps), ...deps };
}

const body = {
  name: 'Ragavan',
  expansionIds: [],
  languages: [],
  minCondition: 'Near Mint',
  foil: false,
  thresholdCents: 4000,
};

describe('API carte', () => {
  it('GET /api/cards', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/cards' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /api/cards valido → 201', async () => {
    const { app, cards } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/cards', payload: body });
    expect(res.statusCode).toBe(201);
    expect(cards.create).toHaveBeenCalledWith(body);
  });

  it('POST /api/cards non valido → 400 con il campo in errore', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/cards', payload: { ...body, thresholdCents: -1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('thresholdCents');
  });

  it('PUT /api/cards/:id valida l’id e non passa il nome', async () => {
    const { app, cards } = setup();
    expect((await app.inject({ method: 'PUT', url: '/api/cards/abc', payload: body })).statusCode).toBe(400);
    const res = await app.inject({ method: 'PUT', url: '/api/cards/3', payload: body });
    expect(res.statusCode).toBe(200);
    const { name: _name, ...update } = body;
    expect(cards.update).toHaveBeenCalledWith(3, update);
  });

  it('DELETE inesistente → 404', async () => {
    const { app, cards } = setup();
    cards.delete.mockImplementationOnce(() => {
      throw new NotFoundError('Carta non trovata');
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/cards/9' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Carta non trovata' });
  });

  it('DELETE → 204', async () => {
    const { app, cards } = setup();
    expect((await app.inject({ method: 'DELETE', url: '/api/cards/9' })).statusCode).toBe(204);
    expect(cards.delete).toHaveBeenCalledWith(9);
  });

  it('preview: ValidationError → 422, HttpError upstream → 502', async () => {
    const { app, cards } = setup();
    const { thresholdCents: _t, ...filters } = body;
    cards.preview.mockRejectedValueOnce(new ValidationError('nessuna stampa'));
    expect((await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters })).statusCode).toBe(422);
    cards.preview.mockRejectedValueOnce(new HttpError(401, 'HTTP 401 da api.cardtrader.com'));
    const res = await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('401');
  });
});

describe('API catalogo', () => {
  it('GET /api/autocomplete', async () => {
    const { app, scryfall } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/autocomplete?q=rag' });
    expect(res.json()).toEqual(['Ragavan, Nimble Pilferer']);
    expect(scryfall.autocomplete).toHaveBeenCalledWith('rag');
  });

  it('GET /api/printings restituisce solo il DTO', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/printings?name=Ragavan' });
    expect(res.json()).toEqual({
      name: 'Ragavan',
      imageUrl: 'img',
      printings: [{ expansionId: 1, expansionName: 'MH2', code: 'mh2' }],
    });
  });

  it('GET /api/printings con carta inesistente → 404', async () => {
    const { app, catalog } = setup();
    catalog.lookup.mockRejectedValueOnce(new HttpError(404, 'HTTP 404 da api.scryfall.com'));
    const res = await app.inject({ method: 'GET', url: '/api/printings?name=Xyz' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Carta non trovata' });
  });
});

describe('API sync, impostazioni, health', () => {
  it('POST /api/sync → 202, già in corso → 409', async () => {
    const { app, sync } = setup();
    const ok = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toEqual({ run: { id: 7 } });
    expect(sync.start).toHaveBeenCalledWith('manual');
    sync.start.mockReturnValueOnce({ started: false, run: { id: 7 } });
    const busy = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toBe('Aggiornamento già in corso');
  });

  it('GET /api/sync/status', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/sync/status' });
    expect(res.json()).toEqual({ current: null, last: null, nextRunAt: '2026-10-02T12:00:00.000Z' });
  });

  it('PUT /api/settings valida, salva e ripianifica', async () => {
    const { app, db, scheduler } = setup();
    const bad = await app.inject({ method: 'PUT', url: '/api/settings', payload: { ...DEFAULT_SETTINGS, dailyTime: '25:00' } });
    expect(bad.statusCode).toBe(400);
    expect(scheduler.reschedule).not.toHaveBeenCalled();
    const next = { ...DEFAULT_SETTINGS, scheduleMode: 'daily', dailyTime: '08:15' };
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: next });
    expect(res.statusCode).toBe(200);
    expect(getSettings(db)).toEqual(next);
    expect(scheduler.reschedule).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual(next);
  });

  it('GET /api/health', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ cardtrader: false, telegram: true });
  });

  it('POST /api/telegram/test → 204', async () => {
    const { app, telegram } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/telegram/test' })).statusCode).toBe(204);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run server/src/api`
Expected: FAIL, modulo `./app` non trovato.

- [ ] **Step 3: Implementare `app.ts`**

`server/src/api/app.ts`:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import {
  cardFiltersSchema,
  cardInputSchema,
  cardUpdateSchema,
  settingsSchema,
  type CardLookupDto,
  type HealthDto,
  type SyncStatusDto,
} from '@ctzero/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CardService } from '../cards/card-service';
import type { Catalog } from '../catalog/catalog';
import { HttpError } from '../clients/http';
import type { ScryfallClient } from '../clients/scryfall';
import type { TelegramClient } from '../clients/telegram';
import type { Db } from '../db/db';
import { getLastFinishedRun, getRunningRun } from '../db/runs-repo';
import { getSettings, saveSettings } from '../db/settings-repo';
import { NotFoundError, ValidationError } from '../errors';
import type { Scheduler } from '../scheduler/scheduler';
import type { SyncService } from '../sync/sync-service';

export interface AppDeps {
  db: Db;
  cards: Pick<CardService, 'list' | 'create' | 'update' | 'delete' | 'preview'>;
  sync: Pick<SyncService, 'start'>;
  scheduler: Pick<Scheduler, 'getNextRunAt' | 'reschedule'>;
  catalog: Pick<Catalog, 'lookup'>;
  scryfall: Pick<ScryfallClient, 'autocomplete'>;
  telegram: Pick<TelegramClient, 'sendMessage' | 'configured'>;
  cardtraderConfigured: boolean;
  webDistDir?: string;
  logger?: boolean;
}

const idParams = z.object({ id: z.coerce.number().int().positive() });
const autocompleteQuery = z.object({ q: z.string().default('') });
const printingsQuery = z.object({ name: z.string().trim().min(1) });

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.status(400).send({ error: formatZodError(err) });
    if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
    if (err instanceof ValidationError) return reply.status(422).send({ error: err.message });
    if (err instanceof HttpError) {
      return err.status === 404
        ? reply.status(404).send({ error: 'Carta non trovata' })
        : reply.status(502).send({ error: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: (err as Error).message });
  });

  app.get('/api/cards', async () => deps.cards.list());

  app.post('/api/cards', async (req, reply) => {
    const card = await deps.cards.create(cardInputSchema.parse(req.body));
    return reply.status(201).send(card);
  });

  app.put('/api/cards/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return deps.cards.update(id, cardUpdateSchema.parse(req.body));
  });

  app.delete('/api/cards/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    deps.cards.delete(id);
    return reply.status(204).send();
  });

  app.post('/api/cards/preview', async (req) => deps.cards.preview(cardFiltersSchema.parse(req.body)));

  app.get('/api/autocomplete', async (req) => deps.scryfall.autocomplete(autocompleteQuery.parse(req.query).q));

  app.get('/api/printings', async (req): Promise<CardLookupDto> => {
    const lookup = await deps.catalog.lookup(printingsQuery.parse(req.query).name);
    return { name: lookup.name, imageUrl: lookup.imageUrl, printings: lookup.printings };
  });

  app.post('/api/sync', async (_req, reply) => {
    const result = deps.sync.start('manual');
    return result.started
      ? reply.status(202).send({ run: result.run })
      : reply.status(409).send({ error: 'Aggiornamento già in corso', run: result.run });
  });

  app.get(
    '/api/sync/status',
    async (): Promise<SyncStatusDto> => ({
      current: getRunningRun(deps.db),
      last: getLastFinishedRun(deps.db),
      nextRunAt: deps.scheduler.getNextRunAt()?.toISOString() ?? null,
    }),
  );

  app.get('/api/settings', async () => getSettings(deps.db));

  app.put('/api/settings', async (req) => {
    const settings = settingsSchema.parse(req.body);
    saveSettings(deps.db, settings);
    deps.scheduler.reschedule();
    return settings;
  });

  app.get(
    '/api/health',
    async (): Promise<HealthDto> => ({ cardtrader: deps.cardtraderConfigured, telegram: deps.telegram.configured }),
  );

  app.post('/api/telegram/test', async (_req, reply) => {
    await deps.telegram.sendMessage('✅ <b>CTZero Tracker</b>: messaggio di test');
    return reply.status(204).send();
  });

  if (deps.webDistDir && existsSync(join(deps.webDistDir, 'index.html'))) {
    app.register(fastifyStatic, { root: deps.webDistDir });
    // Fallback SPA: le rotte del router Vue servono index.html.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.status(404).send({ error: 'Not found' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
```

- [ ] **Step 4: Verificare le rotte**

Run: `npx vitest run server/src/api && npm run typecheck`
Expected: PASS, nessun errore di tipo.

- [ ] **Step 5: Implementare `main.ts`**

`server/src/main.ts`:
```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './api/app';
import { CardService } from './cards/card-service';
import { Catalog } from './catalog/catalog';
import { CardTraderClient } from './clients/cardtrader';
import { ScryfallClient } from './clients/scryfall';
import { TelegramClient } from './clients/telegram';
import { openDb } from './db/db';
import { failOrphanRuns } from './db/runs-repo';
import { Scheduler } from './scheduler/scheduler';
import { SyncService } from './sync/sync-service';

const root = resolve(import.meta.dirname, '../..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3000);
const db = openDb(process.env.DB_PATH ? resolve(root, process.env.DB_PATH) : resolve(root, 'data/ctzero.db'));
const orphans = failOrphanRuns(db);

const ct = new CardTraderClient(process.env.CARDTRADER_TOKEN ?? '');
const scryfall = new ScryfallClient();
const telegram = new TelegramClient(process.env.TELEGRAM_BOT_TOKEN ?? '', process.env.TELEGRAM_CHAT_ID ?? '');
const catalog = new Catalog(ct, scryfall);
const cards = new CardService({ db, catalog, ct });
const sync = new SyncService({ db, catalog, ct, telegram });
const scheduler = new Scheduler({ db, sync });

const app = buildApp({
  db,
  cards,
  sync,
  scheduler,
  catalog,
  scryfall,
  telegram,
  cardtraderConfigured: ct.configured,
  webDistDir: resolve(root, 'web/dist'),
  logger: true,
});

await app.listen({ port, host: '127.0.0.1' });
if (orphans > 0) app.log.warn(`${orphans} giri interrotti marcati come falliti`);
scheduler.start();
app.log.info(`CTZero Tracker su http://localhost:${port}`);

async function shutdown(): Promise<void> {
  scheduler.stop();
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

- [ ] **Step 6: Smoke test del server senza token**

Run (in background): `DB_PATH=data/smoke.db npm run dev:server`
Poi: `curl -s localhost:3000/api/health && curl -s localhost:3000/api/sync/status && curl -s localhost:3000/api/settings`
Expected: `{"cardtrader":false,"telegram":false}`, uno status con `nextRunAt` circa 30 s nel futuro e i default delle impostazioni. Dopo circa 30 s, `curl -s localhost:3000/api/sync/status` mostra `last.status` = `"ok"` (0 carte; nessun messaggio Telegram perché il report è vuoto). Fermare il server e cancellare `data/smoke.db*`.

---

### Task 12: Frontend: scaffolding, layout, Impostazioni e helper

**Files:**
- Create: `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`
- Create: `web/src/main.ts`, `web/src/App.vue`, `web/src/router.ts`, `web/src/style.css`, `web/src/api.ts`, `web/src/card-status.ts`
- Create: `web/src/components/HealthBanner.vue`, `web/src/pages/SettingsPage.vue`, `web/src/pages/CardsPage.vue` (provvisoria, sostituita nel Task 13)
- Modify: `package.json` (script `typecheck`)
- Test: `web/src/card-status.test.ts`

**Interfaces:**
- Consumes: DTO da `@ctzero/shared`; API del Task 11
- Produces:
  - `api.get<T>(path)`, `api.post<T>(path, body?)`, `api.put<T>(path, body)`, `api.del(path)`; `class ApiError extends Error { status: number }`
  - `type CardStatus = 'below' | 'above' | 'no_offers' | 'error' | 'pending'`, `cardStatus(c: TrackedCard): CardStatus`, `STATUS_META: Record<CardStatus, { label: string; severity: 'success' | 'secondary' | 'warn' | 'danger' | 'info' }>`, `deltaPercent(c: TrackedCard): number | null`, `sortForDisplay(cards: TrackedCard[]): TrackedCard[]`, `formatDateTime(iso: string | null): string`

- [ ] **Step 1: File di progetto web**

`web/package.json`:
```json
{
  "name": "@ctzero/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@ctzero/shared": "*",
    "@primeuix/themes": "^1.2.5",
    "primeicons": "^7.0.0",
    "primevue": "^4.5.5",
    "vue": "^3.5.43",
    "vue-router": "^4.6.4"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.9",
    "vite": "^8.3.2",
    "vue-tsc": "^3.3.12"
  }
}
```

`web/index.html`:
```html
<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CTZero Tracker</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/vite.config.ts`:
```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "jsx": "preserve",
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.vue"],
  "exclude": ["src/**/*.test.ts"]
}
```

Nel `package.json` di root, sostituire lo script `typecheck` con:
```json
"typecheck": "tsc --noEmit && npm run typecheck -w @ctzero/web"
```

Run: `npm install`
Expected: installa le dipendenze del workspace web senza errori.

- [ ] **Step 2: Test degli helper (falliscono)**

`web/src/card-status.test.ts`:
```ts
import type { TrackedCard } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import { cardStatus, deltaPercent, formatDateTime, sortForDisplay } from './card-status';

function card(overrides: Partial<TrackedCard>): TrackedCard {
  return {
    id: 1,
    name: 'X',
    scryfallOracleId: 'o',
    imageUrl: null,
    expansionIds: [],
    expansionNames: [],
    languages: [],
    minCondition: 'Near Mint',
    foil: false,
    thresholdCents: 1000,
    configVersion: 1,
    lastPriceCents: null,
    lastListing: null,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastError: null,
    alertState: null,
    lastNotifiedPriceCents: null,
    blueprintsResolvedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('cardStatus', () => {
  it('copre tutti i casi', () => {
    expect(cardStatus(card({}))).toBe('pending');
    expect(cardStatus(card({ lastSyncStatus: 'error', alertState: 'below' }))).toBe('error');
    expect(cardStatus(card({ lastSyncStatus: 'ok', alertState: 'below' }))).toBe('below');
    expect(cardStatus(card({ lastSyncStatus: 'no_offers', alertState: 'above' }))).toBe('no_offers');
    expect(cardStatus(card({ lastSyncStatus: 'ok', alertState: 'above' }))).toBe('above');
  });
});

describe('deltaPercent', () => {
  it('differenza percentuale rispetto alla soglia, un decimale', () => {
    expect(deltaPercent(card({ lastPriceCents: 1100 }))).toBe(10);
    expect(deltaPercent(card({ lastPriceCents: 875 }))).toBe(-12.5);
    expect(deltaPercent(card({ lastPriceCents: null }))).toBeNull();
  });
});

describe('sortForDisplay', () => {
  it('sotto soglia in cima, poi per nome', () => {
    const sorted = sortForDisplay([
      card({ id: 1, name: 'Zeta', lastSyncStatus: 'ok', alertState: 'above' }),
      card({ id: 2, name: 'Beta', lastSyncStatus: 'ok', alertState: 'below' }),
      card({ id: 3, name: 'Alfa', lastSyncStatus: 'ok', alertState: 'above' }),
      card({ id: 4, name: 'Gamma', lastSyncStatus: 'error' }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual([2, 3, 1, 4]);
  });
});

describe('formatDateTime', () => {
  it('trattino se assente', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('2026-10-02T16:05:00.000Z')).toMatch(/02\/10\/2026/);
  });
});
```

Run: `npx vitest run web`
Expected: FAIL, modulo `./card-status` non trovato.

- [ ] **Step 3: Implementare gli helper e il client API**

`web/src/card-status.ts`:
```ts
import type { TrackedCard } from '@ctzero/shared';

export type CardStatus = 'below' | 'above' | 'no_offers' | 'error' | 'pending';

export const STATUS_META: Record<
  CardStatus,
  { label: string; severity: 'success' | 'secondary' | 'warn' | 'danger' | 'info' }
> = {
  below: { label: 'Sotto soglia', severity: 'success' },
  above: { label: 'Sopra soglia', severity: 'secondary' },
  no_offers: { label: 'Nessuna offerta', severity: 'warn' },
  error: { label: 'Errore', severity: 'danger' },
  pending: { label: 'In attesa', severity: 'info' },
};

const ORDER: Record<CardStatus, number> = { below: 0, above: 1, no_offers: 2, pending: 3, error: 4 };

export function cardStatus(c: TrackedCard): CardStatus {
  if (c.lastSyncStatus === 'error') return 'error';
  if (c.lastSyncStatus === null) return 'pending';
  if (c.alertState === 'below') return 'below';
  if (c.lastSyncStatus === 'no_offers') return 'no_offers';
  return 'above';
}

/** Differenza % del prezzo rispetto alla soglia (negativa = sotto soglia). */
export function deltaPercent(c: TrackedCard): number | null {
  if (c.lastPriceCents === null) return null;
  return Math.round(((c.lastPriceCents - c.thresholdCents) / c.thresholdCents) * 1000) / 10;
}

export function sortForDisplay(cards: TrackedCard[]): TrackedCard[] {
  return [...cards].sort(
    (a, b) => ORDER[cardStatus(a)] - ORDER[cardStatus(b)] || a.name.localeCompare(b.name, 'it'),
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

`web/src/api.ts`:
```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Errore HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: (path: string) => request<void>('DELETE', path),
};
```

Run: `npx vitest run web`
Expected: PASS.

- [ ] **Step 4: Bootstrap, layout, router, stile**

`web/src/main.ts`:
```ts
import Aura from '@primeuix/themes/aura';
import 'primeicons/primeicons.css';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './style.css';

createApp(App)
  .use(router)
  .use(PrimeVue, { theme: { preset: Aura } })
  .use(ToastService)
  .use(ConfirmationService)
  .directive('tooltip', Tooltip)
  .mount('#app');
```

`web/src/router.ts`:
```ts
import { createRouter, createWebHistory } from 'vue-router';
import CardsPage from './pages/CardsPage.vue';
import SettingsPage from './pages/SettingsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: CardsPage },
    { path: '/impostazioni', component: SettingsPage },
  ],
});
```

`web/src/App.vue`:
```vue
<script setup lang="ts">
import ConfirmDialog from 'primevue/confirmdialog';
import Toast from 'primevue/toast';
import HealthBanner from './components/HealthBanner.vue';
</script>

<template>
  <Toast />
  <ConfirmDialog />
  <header class="topbar">
    <span class="brand">🃏 CTZero Tracker</span>
    <nav>
      <RouterLink to="/">Carte</RouterLink>
      <RouterLink to="/impostazioni">Impostazioni</RouterLink>
    </nav>
  </header>
  <main class="content">
    <HealthBanner />
    <RouterView />
  </main>
</template>
```

`web/src/style.css`:
```css
:root {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color-scheme: light;
}
body {
  margin: 0;
  background: #f6f7f9;
  color: #1f2937;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.brand {
  font-weight: 700;
  font-size: 1.1rem;
}
.topbar nav {
  display: flex;
  gap: 1rem;
}
.topbar a {
  color: #374151;
  text-decoration: none;
}
.topbar a.router-link-active {
  font-weight: 600;
  color: #10b981;
}
.content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem;
}
.banner {
  margin-bottom: 1rem;
}
.muted {
  color: #6b7280;
  font-size: 0.875rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1rem;
}
.field.inline {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}
.field label {
  font-weight: 600;
  font-size: 0.875rem;
}
.price-up {
  color: #b91c1c;
}
.price-down {
  color: #047857;
}
.card-thumb {
  width: 146px;
  border-radius: 8px;
}
.row-thumb {
  width: 48px;
  border-radius: 3px;
  display: block;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
```

`web/src/components/HealthBanner.vue`:
```vue
<script setup lang="ts">
import type { HealthDto } from '@ctzero/shared';
import Message from 'primevue/message';
import { onMounted, ref } from 'vue';
import { api } from '../api';

const health = ref<HealthDto | null>(null);

onMounted(async () => {
  try {
    health.value = await api.get<HealthDto>('/api/health');
  } catch {
    health.value = null;
  }
});
</script>

<template>
  <Message v-if="health && !health.cardtrader" severity="error" class="banner">
    Token CardTrader mancante: imposta <code>CARDTRADER_TOKEN</code> nel file <code>.env</code> e riavvia.
  </Message>
  <Message v-if="health && !health.telegram" severity="warn" class="banner">
    Telegram non configurato: imposta <code>TELEGRAM_BOT_TOKEN</code> e <code>TELEGRAM_CHAT_ID</code> nel file
    <code>.env</code> e riavvia.
  </Message>
</template>
```

`web/src/pages/CardsPage.vue` (provvisoria, sostituita nel Task 13):
```vue
<template>
  <h1>Carte tracciate</h1>
</template>
```

- [ ] **Step 5: Pagina Impostazioni**

`web/src/pages/SettingsPage.vue`:
```vue
<script setup lang="ts">
import type { Settings } from '@ctzero/shared';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import { useToast } from 'primevue/usetoast';
import { onMounted, ref } from 'vue';
import { api } from '../api';

const toast = useToast();
const settings = ref<Settings | null>(null);
const saving = ref(false);
const testing = ref(false);
const modeOptions = [
  { label: 'Ogni N ore', value: 'interval' },
  { label: 'Ogni giorno alle', value: 'daily' },
];

onMounted(async () => {
  try {
    settings.value = await api.get<Settings>('/api/settings');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Errore', detail: (e as Error).message, life: 5000 });
  }
});

async function save() {
  if (!settings.value) return;
  saving.value = true;
  try {
    settings.value = await api.put<Settings>('/api/settings', settings.value);
    toast.add({ severity: 'success', summary: 'Impostazioni salvate', life: 3000 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Errore', detail: (e as Error).message, life: 5000 });
  } finally {
    saving.value = false;
  }
}

async function testTelegram() {
  testing.value = true;
  try {
    await api.post('/api/telegram/test');
    toast.add({ severity: 'success', summary: 'Messaggio di test inviato', life: 3000 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Invio fallito', detail: (e as Error).message, life: 5000 });
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <h1>Impostazioni</h1>
  <form v-if="settings" class="settings-form" @submit.prevent="save">
    <div class="field">
      <label>Pianificazione</label>
      <SelectButton
        v-model="settings.scheduleMode"
        :options="modeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
      />
    </div>
    <div v-if="settings.scheduleMode === 'interval'" class="field">
      <label for="hours">Intervallo (ore)</label>
      <InputNumber v-model="settings.intervalHours" input-id="hours" :min="1" :max="168" show-buttons />
    </div>
    <div v-else class="field">
      <label for="time">Orario</label>
      <InputText id="time" v-model="settings.dailyTime" type="time" />
    </div>
    <div class="field">
      <label for="drop">Notifica "ulteriore calo" a partire da</label>
      <InputNumber v-model="settings.furtherDropPercent" input-id="drop" :min="1" :max="90" suffix=" %" />
    </div>
    <div class="actions">
      <Button type="submit" label="Salva" icon="pi pi-check" :loading="saving" />
      <Button
        type="button"
        label="Invia messaggio di test Telegram"
        icon="pi pi-send"
        severity="secondary"
        :loading="testing"
        @click="testTelegram"
      />
    </div>
  </form>
</template>

<style scoped>
.settings-form {
  max-width: 28rem;
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
```

- [ ] **Step 6: Verificare typecheck e build**

Run: `npm run typecheck && npm run build`
Expected: nessun errore; `web/dist/index.html` creato.
Se `vue-tsc` segnala che `InputNumber` emette `number | null` verso un campo `number`, aggiungere un fallback nel salvataggio (`intervalHours ?? 6`, `furtherDropPercent ?? 5`) invece di allargare i tipi di `Settings`.

- [ ] **Step 7: Verifica manuale**

Run (in due terminali): `npm run dev:server` e `npm run dev:web`; aprire `http://localhost:5173/impostazioni`.
Expected: banner rosso e giallo (token mancanti); il form carica i default; salvando "Ogni giorno alle 08:15" compare il toast di conferma e, ricaricando, il valore resta. "Invia messaggio di test" mostra un toast d'errore "Telegram non configurato…".

---

### Task 13: Frontend: pagina Carte e stato degli aggiornamenti

**Files:**
- Create: `web/src/components/SyncHeader.vue`
- Modify: `web/src/pages/CardsPage.vue` (sostituzione completa)
- Create: `web/src/components/CardDialog.vue` (provvisorio, sostituito nel Task 14)

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 12); `cardStatus`, `STATUS_META`, `deltaPercent`, `sortForDisplay`, `formatDateTime` (Task 12); `SyncStatusDto`, `SyncRun`, `TrackedCard`, `CONDITION_ABBR`, `LANGUAGE_LABELS`, `formatEuro` (shared)
- Produces:
  - `<SyncHeader @finished>`: emette `finished` quando compare un nuovo giro concluso
  - `<CardDialog v-model:visible :card="TrackedCard | null" @saved="(card: TrackedCard) => void">` (contratto implementato nel Task 14)

- [ ] **Step 1: Dialog provvisorio (per compilare la pagina)**

`web/src/components/CardDialog.vue`:
```vue
<script setup lang="ts">
import type { TrackedCard } from '@ctzero/shared';
import Dialog from 'primevue/dialog';

defineProps<{ card: TrackedCard | null }>();
const visible = defineModel<boolean>('visible', { required: true });
defineEmits<{ saved: [card: TrackedCard] }>();
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Carta">In arrivo nel Task 14.</Dialog>
</template>
```

- [ ] **Step 2: SyncHeader**

`web/src/components/SyncHeader.vue`:
```vue
<script setup lang="ts">
import type { SyncRun, SyncStatusDto } from '@ctzero/shared';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ApiError, api } from '../api';
import { formatDateTime } from '../card-status';

const emit = defineEmits<{ finished: [] }>();
const toast = useToast();
const status = ref<SyncStatusDto | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSeenRunId: number | null | undefined;

const RUN_META: Record<SyncRun['status'], { label: string; severity: 'success' | 'warn' | 'danger' | 'info' }> = {
  ok: { label: 'OK', severity: 'success' },
  partial: { label: 'Con errori', severity: 'warn' },
  failed: { label: 'Fallito', severity: 'danger' },
  running: { label: 'In corso', severity: 'info' },
};

const running = computed(() => status.value?.current ?? null);
const progress = computed(() => {
  const run = running.value;
  return run && run.cardsTotal > 0 ? Math.round((run.cardsDone / run.cardsTotal) * 100) : 0;
});

async function refresh() {
  try {
    status.value = await api.get<SyncStatusDto>('/api/sync/status');
    const lastId = status.value.last?.id ?? null;
    // Un nuovo giro concluso (manuale o pianificato): la pagina ricarica le carte.
    if (lastSeenRunId !== undefined && lastId !== lastSeenRunId) emit('finished');
    lastSeenRunId = lastId;
  } catch {
    // si riprova al prossimo giro di polling
  }
  clearTimeout(timer);
  timer = setTimeout(refresh, running.value ? 2000 : 30000);
}

async function syncNow() {
  try {
    await api.post('/api/sync');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) {
      toast.add({ severity: 'error', summary: 'Aggiornamento non avviato', detail: (e as Error).message, life: 5000 });
    }
  }
  await refresh();
}

onMounted(refresh);
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div class="sync-header">
    <div class="sync-info">
      <div v-if="status?.last">
        Ultimo aggiornamento: <strong>{{ formatDateTime(status.last.finishedAt) }}</strong>
        <Tag
          :value="RUN_META[status.last.status].label"
          :severity="RUN_META[status.last.status].severity"
          class="run-tag"
        />
        <span v-if="status.last.error" class="muted"> — {{ status.last.error }}</span>
        <span v-if="status.last.reportError" class="muted"> — report non inviato: {{ status.last.reportError }}</span>
      </div>
      <div v-else>Nessun aggiornamento eseguito finora</div>
      <div class="muted">Prossimo aggiornamento: {{ formatDateTime(status?.nextRunAt ?? null) }}</div>
    </div>
    <div class="sync-action">
      <div v-if="running" class="progress">
        <ProgressBar :value="progress" :show-value="false" />
        <small>{{ running.cardsDone }}/{{ running.cardsTotal }} carte</small>
      </div>
      <Button
        label="Aggiorna ora"
        icon="pi pi-refresh"
        :loading="running !== null"
        :disabled="running !== null"
        @click="syncNow"
      />
    </div>
  </div>
</template>

<style scoped>
.sync-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}
.run-tag {
  margin-left: 0.5rem;
}
.sync-action {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.progress {
  width: 12rem;
  text-align: center;
}
</style>
```

- [ ] **Step 3: Pagina Carte**

`web/src/pages/CardsPage.vue`:
```vue
<script setup lang="ts">
import { CONDITION_ABBR, LANGUAGE_LABELS, formatEuro, type TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { STATUS_META, cardStatus, deltaPercent, formatDateTime, sortForDisplay } from '../card-status';
import CardDialog from '../components/CardDialog.vue';
import SyncHeader from '../components/SyncHeader.vue';

const toast = useToast();
const confirm = useConfirm();
const cards = ref<TrackedCard[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<TrackedCard | null>(null);
const rows = computed(() => sortForDisplay(cards.value));

async function load() {
  loading.value = true;
  try {
    cards.value = await api.get<TrackedCard[]>('/api/cards');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Errore', detail: (e as Error).message, life: 5000 });
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editing.value = null;
  dialogVisible.value = true;
}

function openEdit(card: TrackedCard) {
  editing.value = card;
  dialogVisible.value = true;
}

function onSaved(card: TrackedCard) {
  toast.add({ severity: 'success', summary: `${card.name} salvata`, life: 3000 });
  load();
}

function confirmDelete(card: TrackedCard) {
  confirm.require({
    message: `Smettere di tracciare "${card.name}"?`,
    header: 'Conferma',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Elimina', severity: 'danger' },
    rejectProps: { label: 'Annulla', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.del(`/api/cards/${card.id}`);
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Errore', detail: (e as Error).message, life: 5000 });
      }
      await load();
    },
  });
}

function filterChips(card: TrackedCard): string[] {
  return [
    card.expansionNames.length > 0 ? card.expansionNames.join(', ') : 'Qualsiasi espansione',
    card.languages.length > 0 ? card.languages.map((l) => LANGUAGE_LABELS[l]).join(', ') : 'Qualsiasi lingua',
    `≥ ${CONDITION_ABBR[card.minCondition]}`,
    card.foil ? 'Foil' : 'Non foil',
  ];
}

function formatDelta(card: TrackedCard): string {
  const d = deltaPercent(card);
  if (d === null) return '—';
  return `${d > 0 ? '+' : ''}${d.toLocaleString('it-IT')}%`;
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Carte tracciate</h1>
    <Button label="Aggiungi carta" icon="pi pi-plus" @click="openNew" />
  </div>

  <SyncHeader @finished="load" />

  <DataTable :value="rows" :loading="loading" data-key="id" striped-rows>
    <template #empty>Nessuna carta tracciata. Aggiungine una con "Aggiungi carta".</template>
    <Column header="" style="width: 64px">
      <template #body="{ data }">
        <img v-if="data.imageUrl" :src="data.imageUrl" :alt="data.name" class="row-thumb" />
      </template>
    </Column>
    <Column field="name" header="Carta">
      <template #body="{ data }">
        <strong>{{ data.name }}</strong>
        <div class="chips">
          <Tag v-for="chip in filterChips(data)" :key="chip" :value="chip" severity="secondary" />
        </div>
      </template>
    </Column>
    <Column header="Prezzo CT Zero">
      <template #body="{ data }">
        <template v-if="data.lastPriceCents !== null">
          <strong>{{ formatEuro(data.lastPriceCents) }}</strong>
          <div v-if="data.lastListing" class="muted">
            {{ data.lastListing.expansionName }} · {{ data.lastListing.condition }} ·
            {{ data.lastListing.language.toUpperCase() }}
          </div>
        </template>
        <span v-else>—</span>
      </template>
    </Column>
    <Column header="Soglia">
      <template #body="{ data }">{{ formatEuro(data.thresholdCents) }}</template>
    </Column>
    <Column header="Δ soglia">
      <template #body="{ data }">
        <span :class="(deltaPercent(data) ?? 0) <= 0 ? 'price-down' : 'price-up'">{{ formatDelta(data) }}</span>
      </template>
    </Column>
    <Column header="Stato">
      <template #body="{ data }">
        <Tag
          v-tooltip.top="data.lastError ?? undefined"
          :value="STATUS_META[cardStatus(data)].label"
          :severity="STATUS_META[cardStatus(data)].severity"
        />
      </template>
    </Column>
    <Column header="Aggiornata">
      <template #body="{ data }">{{ formatDateTime(data.lastSyncedAt) }}</template>
    </Column>
    <Column header="" style="width: 9rem">
      <template #body="{ data }">
        <div class="row-actions">
          <a v-if="data.lastListing" :href="data.lastListing.url" target="_blank" rel="noopener">
            <Button v-tooltip.top="'Apri su CardTrader'" icon="pi pi-external-link" text rounded />
          </a>
          <Button v-tooltip.top="'Modifica'" icon="pi pi-pencil" text rounded @click="openEdit(data)" />
          <Button
            v-tooltip.top="'Elimina'"
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            @click="confirmDelete(data)"
          />
        </div>
      </template>
    </Column>
  </DataTable>

  <CardDialog v-model:visible="dialogVisible" :card="editing" @saved="onSaved" />
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.row-actions {
  display: flex;
  align-items: center;
}
</style>
```

- [ ] **Step 4: Verificare typecheck e build**

Run: `npm run typecheck && npm run build`
Expected: nessun errore.

- [ ] **Step 5: Verifica manuale**

Run: `npm run dev:server` e `npm run dev:web`; aprire `http://localhost:5173/`.
Expected: tabella vuota con il messaggio "Nessuna carta tracciata…"; l'intestazione mostra "Prossimo aggiornamento". Cliccando "Aggiorna ora" il pulsante va in caricamento, poi compare "Ultimo aggiornamento … OK" (0 carte). "Aggiungi carta" apre il dialog provvisorio.

---

### Task 14: Frontend: dialog Aggiungi/Modifica carta con anteprima e preset

**Files:**
- Modify: `web/src/components/CardDialog.vue` (sostituzione completa)

**Interfaces:**
- Consumes: `GET /api/autocomplete`, `GET /api/printings`, `POST /api/cards/preview`, `POST /api/cards`, `PUT /api/cards/:id`; `CONDITIONS`, `LANGUAGES`, `LANGUAGE_LABELS`, `euroToCents`, `formatEuro`, `CardLookupDto`, `PreviewResult`, `TrackedCard`, `Condition`, `Language` (shared)
- Produces: stesso contratto del Task 13 (`v-model:visible`, `card`, `@saved`)

- [ ] **Step 1: Implementare il dialog**

`web/src/components/CardDialog.vue`:
```vue
<script setup lang="ts">
import {
  CONDITIONS,
  LANGUAGES,
  LANGUAGE_LABELS,
  euroToCents,
  formatEuro,
  type CardLookupDto,
  type Condition,
  type Language,
  type PreviewResult,
  type TrackedCard,
} from '@ctzero/shared';
import AutoComplete, { type AutoCompleteCompleteEvent, type AutoCompleteOptionSelectEvent } from 'primevue/autocomplete';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ card: TrackedCard | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [card: TrackedCard] }>();

const name = ref('');
const suggestions = ref<string[]>([]);
const lookup = ref<CardLookupDto | null>(null);
const expansionIds = ref<number[]>([]);
const languages = ref<Language[]>([]);
const minCondition = ref<Condition>('Near Mint');
const foil = ref(false);
const preview = ref<PreviewResult | null>(null);
const thresholdEuro = ref<number | null>(null);
const error = ref<string | null>(null);
const loadingLookup = ref(false);
const loadingPreview = ref(false);
const saving = ref(false);

const isEdit = computed(() => props.card !== null);
const conditionOptions = [...CONDITIONS];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));
const expansionOptions = computed(() => lookup.value?.printings ?? []);
const canSave = computed(() => lookup.value !== null && thresholdEuro.value !== null && thresholdEuro.value > 0);

watch(visible, (open) => {
  if (open) void reset();
});

// Un'anteprima calcolata con filtri diversi non è più valida.
watch([expansionIds, languages, minCondition, foil], () => {
  preview.value = null;
});

// Se il nome viene modificato dopo la selezione, la carta caricata non vale più.
watch(name, (value) => {
  if (lookup.value && value !== lookup.value.name) {
    lookup.value = null;
    preview.value = null;
  }
});

async function reset() {
  const c = props.card;
  error.value = null;
  suggestions.value = [];
  lookup.value = null;
  name.value = c?.name ?? '';
  expansionIds.value = c ? [...c.expansionIds] : [];
  languages.value = c ? [...c.languages] : [];
  minCondition.value = c?.minCondition ?? 'Near Mint';
  foil.value = c?.foil ?? false;
  thresholdEuro.value = c ? c.thresholdCents / 100 : null;
  preview.value = null;
  if (c) await loadLookup(c.name);
}

async function complete(event: AutoCompleteCompleteEvent) {
  try {
    suggestions.value = await api.get<string[]>(`/api/autocomplete?q=${encodeURIComponent(event.query)}`);
  } catch (e) {
    suggestions.value = [];
    error.value = (e as Error).message;
  }
}

async function onSelect(event: AutoCompleteOptionSelectEvent) {
  expansionIds.value = [];
  await loadLookup(event.value as string);
}

async function loadLookup(cardName: string) {
  loadingLookup.value = true;
  error.value = null;
  try {
    lookup.value = await api.get<CardLookupDto>(`/api/printings?name=${encodeURIComponent(cardName)}`);
    name.value = lookup.value.name;
  } catch (e) {
    lookup.value = null;
    error.value = (e as Error).message;
  } finally {
    loadingLookup.value = false;
  }
}

function filters() {
  return {
    expansionIds: expansionIds.value,
    languages: languages.value,
    minCondition: minCondition.value,
    foil: foil.value,
  };
}

async function calculate() {
  loadingPreview.value = true;
  error.value = null;
  try {
    preview.value = await api.post<PreviewResult>('/api/cards/preview', { name: name.value, ...filters() });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingPreview.value = false;
  }
}

async function save() {
  if (!canSave.value || thresholdEuro.value === null) return;
  saving.value = true;
  error.value = null;
  const payload = { ...filters(), thresholdCents: euroToCents(thresholdEuro.value) };
  try {
    const saved = props.card
      ? await api.put<TrackedCard>(`/api/cards/${props.card.id}`, payload)
      : await api.post<TrackedCard>('/api/cards', { name: name.value, ...payload });
    emit('saved', saved);
    visible.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="isEdit ? 'Modifica carta' : 'Aggiungi carta'"
    :style="{ width: '46rem' }"
  >
    <div class="field">
      <label for="card-name">Carta</label>
      <AutoComplete
        v-model="name"
        input-id="card-name"
        :suggestions="suggestions"
        :disabled="isEdit"
        :delay="300"
        :min-length="2"
        placeholder="Es. Lightning Bolt"
        fluid
        @complete="complete"
        @option-select="onSelect"
      />
    </div>

    <p v-if="loadingLookup" class="muted">Caricamento delle stampe…</p>

    <div v-if="lookup" class="lookup">
      <img v-if="lookup.imageUrl" :src="lookup.imageUrl" :alt="lookup.name" class="card-thumb" />
      <div class="filters">
        <div class="field">
          <label for="expansions">Espansioni</label>
          <MultiSelect
            v-model="expansionIds"
            input-id="expansions"
            :options="expansionOptions"
            option-label="expansionName"
            option-value="expansionId"
            placeholder="Qualsiasi espansione"
            display="chip"
            filter
            fluid
          />
        </div>
        <div class="field">
          <label for="languages">Lingue</label>
          <MultiSelect
            v-model="languages"
            input-id="languages"
            :options="languageOptions"
            option-label="label"
            option-value="code"
            placeholder="Qualsiasi lingua"
            display="chip"
            fluid
          />
        </div>
        <div class="field">
          <label for="condition">Condizione minima</label>
          <Select v-model="minCondition" input-id="condition" :options="conditionOptions" fluid />
        </div>
        <div class="field inline">
          <ToggleSwitch v-model="foil" input-id="foil" />
          <label for="foil">Foil</label>
        </div>
      </div>
    </div>

    <div v-if="lookup" class="pricing">
      <Button
        label="Calcola prezzo"
        icon="pi pi-calculator"
        severity="secondary"
        :loading="loadingPreview"
        @click="calculate"
      />
      <div v-if="preview" class="preview">
        <p v-if="preview.listing">
          Prezzo attuale CT Zero: <strong>{{ formatEuro(preview.listing.priceCents) }}</strong> —
          {{ preview.listing.expansionName }}, {{ preview.listing.condition }},
          {{ preview.listing.language.toUpperCase() }}
          <a :href="preview.listing.url" target="_blank" rel="noopener">apri</a>
        </p>
        <p v-else>Nessuna offerta CT Zero valida al momento ({{ preview.blueprintCount }} stampe controllate).</p>
        <div class="presets">
          <Button
            v-for="preset in preview.presets"
            :key="preset.label"
            :label="`${preset.label} · ${formatEuro(preset.cents)}`"
            size="small"
            outlined
            @click="thresholdEuro = preset.cents / 100"
          />
        </div>
      </div>
      <div class="field">
        <label for="threshold">Soglia di notifica</label>
        <InputNumber
          v-model="thresholdEuro"
          input-id="threshold"
          mode="currency"
          currency="EUR"
          locale="it-IT"
          :min="0.01"
        />
      </div>
    </div>

    <Message v-if="error" severity="error">{{ error }}</Message>

    <template #footer>
      <Button label="Annulla" severity="secondary" text @click="visible = false" />
      <Button label="Salva" icon="pi pi-check" :disabled="!canSave" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.lookup {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}
.filters {
  flex: 1;
}
.pricing {
  border-top: 1px solid #e5e7eb;
  padding-top: 1rem;
  margin-top: 0.5rem;
}
.preview {
  margin: 0.75rem 0;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
```

- [ ] **Step 2: Verificare typecheck e build**

Run: `npm run typecheck && npm run build`
Expected: nessun errore.

- [ ] **Step 3: Verifica manuale (senza token)**

Run: `npm run dev:server` e `npm run dev:web`; aprire `http://localhost:5173/`, cliccare "Aggiungi carta" e scrivere "light".
Expected: suggerimenti da Scryfall (es. "Lightning Bolt"). Selezionandone uno compare un errore "HTTP 401 … CARDTRADER_TOKEN non configurato" (le espansioni vengono da CardTrader): è il comportamento corretto senza token. La verifica completa è nel Task 15.

---

### Task 15: README, verifica completa e smoke test reale

**Files:**
- Create: `README.md`

- [ ] **Step 1: README**

`README.md`:
````markdown
# CTZero Tracker

Traccia il prezzo minimo **CardTrader Zero** di carte Magic e ti avvisa su Telegram quando scende sotto la soglia scelta.

## Requisiti
- Node.js 24 o superiore

## Configurazione
1. `cp .env.example .env`
2. **CardTrader**: genera il token API da https://www.cardtrader.com/it/full_api_app e mettilo in `CARDTRADER_TOKEN`.
3. **Telegram**:
   - su Telegram scrivi a `@BotFather`, comando `/newbot`, e copia il token in `TELEGRAM_BOT_TOKEN`;
   - manda un messaggio qualsiasi al tuo bot;
   - apri `https://api.telegram.org/bot<TOKEN>/getUpdates` e copia `message.chat.id` in `TELEGRAM_CHAT_ID`.
4. `npm install`

## Uso
- `npm start` → compila la UI e avvia tutto su http://localhost:3000
- Lo scheduler gira solo mentre il processo è acceso. All'avvio, se un aggiornamento è stato saltato, ne parte uno dopo circa 30 secondi.
- Pianificazione e percentuale di "ulteriore calo" si cambiano dalla pagina **Impostazioni**.

## Sviluppo
- `npm run dev:server` (API su :3000, riavvio automatico)
- `npm run dev:web` (UI su :5173 con proxy verso l'API)
- `npm test`, `npm run typecheck`

## Dati
Tutto è in `data/ctzero.db` (SQLite). Per ripartire da zero basta cancellare la cartella `data/`.

## Limiti noti
- CardTrader restituisce solo le 25 inserzioni più economiche per stampa: se sono tutte non-Zero o in condizioni peggiori del minimo, la carta risulta "Nessuna offerta" anche se esistono offerte valide più care.
- Le spese di spedizione non sono considerate.
````

- [ ] **Step 2: Verifica automatica completa**

Run: `npm test && npm run typecheck && npm run build`
Expected: tutti i test PASS, nessun errore di tipo, build della UI riuscita.

- [ ] **Step 3: Avvio in modalità produzione**

Run (in background): `npm start`
Poi: `curl -s localhost:3000/api/health` e `curl -s localhost:3000/ | head -5` e `curl -s localhost:3000/impostazioni | head -5`
Expected: JSON di health; l'HTML della UI sia su `/` sia su `/impostazioni` (fallback SPA).

- [ ] **Step 4: Smoke test reale (richiede l'utente)**

Chiedere all'utente di compilare `.env` con token CardTrader, bot token e chat id Telegram. Poi, con `npm start`:
1. **Impostazioni → "Invia messaggio di test"** → il messaggio arriva su Telegram.
2. **Aggiungi carta** "Lightning Bolt" → compaiono le espansioni CardTrader; scegline una; lingua Inglese; "Calcola prezzo" → prezzo CT Zero e preset; scegli una soglia **sopra** il prezzo attuale → Salva → in tabella lo stato è "Sotto soglia" e **non** arriva nessun messaggio (valutazione silenziosa).
3. Aggiungi una seconda carta con soglia **sotto** il prezzo → stato "Sopra soglia".
4. Modifica la seconda carta portando la soglia sopra il prezzo → stato "Sotto soglia", nessun messaggio.
5. Da `sqlite3 data/ctzero.db "UPDATE tracked_cards SET alert_state='above'"` (oppure eliminando e ricreando una carta con soglia bassa e poi alzandola) forzare uno stato "above"; poi **"Aggiorna ora"** → arriva il report "🟢 Sotto soglia" con il link funzionante a CardTrader.
6. Riavvia il processo e verifica che "Prossimo aggiornamento" sia coerente con la pianificazione.

Expected: ogni passo come descritto. Riportare all'utente l'esito di ciascun passo; le modifiche restano non committate.
