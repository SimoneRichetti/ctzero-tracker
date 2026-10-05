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
const host = process.env.HOST ?? '127.0.0.1';
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

await app.listen({ port, host });
if (orphans > 0) app.log.warn(`${orphans} giri interrotti marcati come falliti`);
scheduler.start({ catchup: orphans > 0 });
app.log.info(`CTZero Tracker on http://localhost:${port}`);

async function shutdown(): Promise<void> {
  scheduler.stop();
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
