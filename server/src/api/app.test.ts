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
    catalog.lookup.mockRejectedValueOnce(new NotFoundError('Carta "Xyz" non trovata'));
    const res = await app.inject({ method: 'GET', url: '/api/printings?name=Xyz' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Carta "Xyz" non trovata' });
  });

  it('un 404 di un altro servizio resta un errore upstream con il suo messaggio', async () => {
    const { app, telegram } = setup();
    telegram.sendMessage.mockRejectedValueOnce(new HttpError(404, 'HTTP 404 da api.telegram.org: Not Found'));
    const res = await app.inject({ method: 'POST', url: '/api/telegram/test' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'HTTP 404 da api.telegram.org: Not Found' });
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
