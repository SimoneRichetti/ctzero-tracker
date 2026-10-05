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
    if (err instanceof HttpError) return reply.status(502).send({ error: err.message });
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
      : reply.status(409).send({ error: 'Update already in progress', run: result.run });
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
    await deps.telegram.sendMessage('✅ <b>CTZero Tracker</b>: test message');
    return reply.status(204).send();
  });

  if (deps.webDistDir && existsSync(join(deps.webDistDir, 'index.html'))) {
    app.register(fastifyStatic, { root: deps.webDistDir });
    // SPA fallback: Vue router routes serve index.html.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.status(404).send({ error: 'Not found' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
