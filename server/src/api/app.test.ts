import { DEFAULT_SETTINGS } from '@ctzero/shared';
import { describe, expect, it, vi } from 'vitest';
import { HttpError, RateLimitError } from '../clients/http';
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
    bulk: vi.fn(() => ({ updated: [1], skipped: [] })),
  };
  const importer = {
    resolve: vi.fn(async () => ({
      name: 'Sol Ring',
      imageUrl: null,
      expansionIds: [],
      priceCents: 250,
      listing: null,
      alreadyTracked: false,
    })),
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
  const product = {
    blueprintId: 279368,
    name: 'Modern Horizons 3: Play Booster Box',
    expansionId: 3627,
    expansionName: 'Modern Horizons 3',
    categoryName: 'Booster Box',
    imageUrl: null,
  };
  const sealed = {
    list: vi.fn(() => []),
    create: vi.fn(async (input: object) => ({ id: 1, ...input })),
    update: vi.fn(async (id: number, input: object) => ({ id, ...input })),
    delete: vi.fn(),
    preview: vi.fn(async () => ({ priceCents: 19000, listing: null, presets: [], blueprintCount: 1 })),
  };
  const sealedCatalog = {
    listExpansions: vi.fn(async () => [{ id: 3627, code: 'mh3', name: 'Modern Horizons 3' }]),
    sealedProducts: vi.fn(async () => [product]),
    sealedProduct: vi.fn(async () => product),
  };
  const deps = { db, cards, importer, sealed, sealedCatalog, sync, scheduler, catalog, scryfall, telegram, cardtraderConfigured: false };
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

describe('cards API', () => {
  it('GET /api/cards', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/cards' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /api/cards valid → 201', async () => {
    const { app, cards } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/cards', payload: body });
    expect(res.statusCode).toBe(201);
    expect(cards.create).toHaveBeenCalledWith(body);
  });

  it('POST /api/cards invalid → 400 with the offending field', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/cards', payload: { ...body, thresholdCents: -1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('thresholdCents');
  });

  it('PUT /api/cards/:id validates the id and does not pass the name', async () => {
    const { app, cards } = setup();
    expect((await app.inject({ method: 'PUT', url: '/api/cards/abc', payload: body })).statusCode).toBe(400);
    const res = await app.inject({ method: 'PUT', url: '/api/cards/3', payload: body });
    expect(res.statusCode).toBe(200);
    const { name: _name, ...update } = body;
    expect(cards.update).toHaveBeenCalledWith(3, update);
  });

  it('DELETE nonexistent → 404', async () => {
    const { app, cards } = setup();
    cards.delete.mockImplementationOnce(() => {
      throw new NotFoundError('Card not found');
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/cards/9' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Card not found' });
  });

  it('DELETE → 204', async () => {
    const { app, cards } = setup();
    expect((await app.inject({ method: 'DELETE', url: '/api/cards/9' })).statusCode).toBe(204);
    expect(cards.delete).toHaveBeenCalledWith(9);
  });

  it('preview: ValidationError → 422, fatal HttpError → 503, other HttpError → 502', async () => {
    const { app, cards } = setup();
    const { thresholdCents: _t, ...filters } = body;
    cards.preview.mockRejectedValueOnce(new ValidationError('no printings'));
    expect((await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters })).statusCode).toBe(422);
    cards.preview.mockRejectedValueOnce(new HttpError(401, 'HTTP 401 da api.cardtrader.com'));
    const fatal = await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters });
    expect(fatal.statusCode).toBe(503);
    expect(fatal.json().error).toContain('401');
    cards.preview.mockRejectedValueOnce(new HttpError(500, 'HTTP 500 da api.cardtrader.com'));
    expect((await app.inject({ method: 'POST', url: '/api/cards/preview', payload: filters })).statusCode).toBe(502);
  });

  it('a rate limit from an upstream service → 429 with its message', async () => {
    const { app, importer } = setup();
    importer.resolve.mockRejectedValueOnce(new RateLimitError('Scryfall rate limit reached: wait 30 seconds and try again'));
    const payload = { name: 'Sol Ring', setCode: null, respectSet: false, languages: [], minCondition: 'Near Mint', foil: false };
    const res = await app.inject({ method: 'POST', url: '/api/import/resolve', payload });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'Scryfall rate limit reached: wait 30 seconds and try again' });
  });
});

describe('groups API', () => {
  it('CRUD', async () => {
    const { app } = setup();
    const created = await app.inject({ method: 'POST', url: '/api/groups', payload: { name: ' Atraxa ' } });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect(created.json()).toMatchObject({ name: 'Atraxa', cardCount: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/groups' })).json()).toHaveLength(1);
    const renamed = await app.inject({ method: 'PUT', url: `/api/groups/${id}`, payload: { name: 'Wishlist' } });
    expect(renamed.json().name).toBe('Wishlist');
    expect((await app.inject({ method: 'DELETE', url: `/api/groups/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/groups/${id}` })).statusCode).toBe(404);
  });

  it('duplicate name → 422, empty name → 400, rename unknown → 404', async () => {
    const { app } = setup();
    await app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'Deck' } });
    expect((await app.inject({ method: 'POST', url: '/api/groups', payload: { name: 'deck' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/groups', payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/groups/99', payload: { name: 'X' } })).statusCode).toBe(404);
  });
});

describe('bulk and import API', () => {
  it('POST /api/cards/bulk validates and forwards', async () => {
    const { app, cards } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/cards/bulk', payload: { ids: [1, 1], action: { type: 'delete' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: [1], skipped: [] });
    expect(cards.bulk).toHaveBeenCalledWith({ ids: [1], action: { type: 'delete' } });
    expect((await app.inject({ method: 'POST', url: '/api/cards/bulk', payload: { ids: [], action: { type: 'delete' } } })).statusCode).toBe(400);
  });

  it('POST /api/import/resolve validates and forwards', async () => {
    const { app, importer } = setup();
    const payload = { name: 'Sol Ring', setCode: 'c21', respectSet: true, languages: [], minCondition: 'Near Mint', foil: false };
    const res = await app.inject({ method: 'POST', url: '/api/import/resolve', payload });
    expect(res.statusCode).toBe(200);
    // setGuessed defaults to false when omitted
    expect(importer.resolve).toHaveBeenCalledWith({ ...payload, setGuessed: false });
    expect((await app.inject({ method: 'POST', url: '/api/import/resolve', payload: { name: '' } })).statusCode).toBe(400);
  });
});

describe('catalog API', () => {
  it('GET /api/autocomplete', async () => {
    const { app, scryfall } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/autocomplete?q=rag' });
    expect(res.json()).toEqual(['Ragavan, Nimble Pilferer']);
    expect(scryfall.autocomplete).toHaveBeenCalledWith('rag');
  });

  it('GET /api/printings returns only the DTO', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/printings?name=Ragavan' });
    expect(res.json()).toEqual({
      name: 'Ragavan',
      imageUrl: 'img',
      printings: [{ expansionId: 1, expansionName: 'MH2', code: 'mh2' }],
    });
  });

  it('GET /api/printings with nonexistent card → 404', async () => {
    const { app, catalog } = setup();
    catalog.lookup.mockRejectedValueOnce(new NotFoundError('Card "Xyz" not found'));
    const res = await app.inject({ method: 'GET', url: '/api/printings?name=Xyz' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Card "Xyz" not found' });
  });

  it('a 404 from another service stays an upstream error with its message', async () => {
    const { app, telegram } = setup();
    telegram.sendMessage.mockRejectedValueOnce(new HttpError(404, 'HTTP 404 da api.telegram.org: Not Found'));
    const res = await app.inject({ method: 'POST', url: '/api/telegram/test' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'HTTP 404 da api.telegram.org: Not Found' });
  });
});

describe('sync, settings, health API', () => {
  it('POST /api/sync → 202, already running → 409', async () => {
    const { app, sync } = setup();
    const ok = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toEqual({ run: { id: 7 } });
    expect(sync.start).toHaveBeenCalledWith('manual');
    sync.start.mockReturnValueOnce({ started: false, run: { id: 7 } });
    const busy = await app.inject({ method: 'POST', url: '/api/sync' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toBe('Update already in progress');
  });

  it('GET /api/sync/status', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/sync/status' });
    expect(res.json()).toEqual({ current: null, last: null, nextRunAt: '2026-10-02T12:00:00.000Z' });
  });

  it('PUT /api/settings validates, saves and reschedules', async () => {
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

describe('sealed API', () => {
  const sealedBody = { blueprintId: 279368, languages: ['en'], thresholdCents: 20000 };

  it('CRUD routes delegate to the service', async () => {
    const { app, sealed } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/sealed' })).json()).toEqual([]);
    const created = await app.inject({ method: 'POST', url: '/api/sealed', payload: sealedBody });
    expect(created.statusCode).toBe(201);
    expect(sealed.create).toHaveBeenCalledWith(sealedBody);
    const updated = await app.inject({ method: 'PUT', url: '/api/sealed/3', payload: sealedBody });
    expect(updated.statusCode).toBe(200);
    expect(sealed.update).toHaveBeenCalledWith(3, { languages: ['en'], thresholdCents: 20000 });
    expect((await app.inject({ method: 'DELETE', url: '/api/sealed/3' })).statusCode).toBe(204);
    expect(sealed.delete).toHaveBeenCalledWith(3);
  });

  it('POST /api/sealed invalid → 400', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/sealed', payload: { ...sealedBody, blueprintId: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('blueprintId');
  });

  it('POST /api/sealed/preview', async () => {
    const { app, sealed } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/sealed/preview', payload: { blueprintId: 279368, languages: [] } });
    expect(res.statusCode).toBe(200);
    expect(sealed.preview).toHaveBeenCalledWith({ blueprintId: 279368, languages: [] });
  });

  it('GET /api/expansions and /api/sealed/catalog', async () => {
    const { app, sealedCatalog } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/expansions' })).json()).toEqual([
      { id: 3627, code: 'mh3', name: 'Modern Horizons 3' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/sealed/catalog?expansionId=3627' });
    expect(res.statusCode).toBe(200);
    expect(sealedCatalog.sealedProducts).toHaveBeenCalledWith(3627);
    expect((await app.inject({ method: 'GET', url: '/api/sealed/catalog?expansionId=abc' })).statusCode).toBe(400);
  });

  it('GET /api/sealed/resolve parses the link', async () => {
    const { app, sealedCatalog } = setup();
    const ref = encodeURIComponent('https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit');
    const res = await app.inject({ method: 'GET', url: `/api/sealed/resolve?ref=${ref}` });
    expect(res.statusCode).toBe(200);
    expect(sealedCatalog.sealedProduct).toHaveBeenCalledWith(389300);
  });

  it('GET /api/sealed/resolve with an unrecognized link → 422', async () => {
    const { app, sealedCatalog } = setup();
    const ref = encodeURIComponent('https://www.cardtrader.com/en/cards/the-hobbit-play-booster-box');
    const res = await app.inject({ method: 'GET', url: `/api/sealed/resolve?ref=${ref}` });
    expect(res.statusCode).toBe(422);
    expect(sealedCatalog.sealedProduct).not.toHaveBeenCalled();
  });

  it('catalog validation errors → 422', async () => {
    const { app, sealedCatalog } = setup();
    sealedCatalog.sealedProduct.mockRejectedValueOnce(new ValidationError('CardTrader item 5 is not a sealed product'));
    const res = await app.inject({ method: 'GET', url: '/api/sealed/resolve?ref=5' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'CardTrader item 5 is not a sealed product' });
  });
});
