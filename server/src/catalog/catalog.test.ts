import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardTraderClient, CtBlueprint, CtExpansion } from '../clients/cardtrader';
import type { ScryfallCard, ScryfallClient } from '../clients/scryfall';
import { HttpError } from '../clients/http';
import { NotFoundError, ValidationError } from '../errors';
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
  it('maps Scryfall printings to Magic CardTrader expansions', async () => {
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

  it('card not found on Scryfall → NotFoundError', async () => {
    scryfall.named.mockRejectedValueOnce(new HttpError(404, 'HTTP 404 da api.scryfall.com'));
    await expect(catalog.lookup('Xyz')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('caches expansions for 24 hours', async () => {
    await catalog.lookup('a');
    await catalog.lookup('b');
    expect(ct.expansions).toHaveBeenCalledTimes(1);
    clock = 25 * 3600 * 1000;
    await catalog.lookup('c');
    expect(ct.expansions).toHaveBeenCalledTimes(2);
  });

  it('with a maximum age, refetches expansions older than that', async () => {
    await catalog.mtgExpansions();
    clock = 5 * 60 * 1000;
    await catalog.mtgExpansions(10 * 60 * 1000);
    expect(ct.expansions).toHaveBeenCalledTimes(1);
    clock = 11 * 60 * 1000;
    await catalog.mtgExpansions(10 * 60 * 1000);
    expect(ct.expansions).toHaveBeenCalledTimes(2);
  });
});

describe('Catalog.resolveBlueprints', () => {
  it('with "any" expansion uses all printings', async () => {
    const lookup = await catalog.lookup('ragavan');
    await expect(catalog.resolveBlueprints(lookup, [])).resolves.toEqual([
      { blueprintId: 100, expansionId: 1, expansionName: 'Modern Horizons 2' },
      { blueprintId: 200, expansionId: 2, expansionName: 'Magic 2010' },
    ]);
  });

  it('with specific expansions fetches only those', async () => {
    const lookup = await catalog.lookup('ragavan');
    await expect(catalog.resolveBlueprints(lookup, [2])).resolves.toEqual([
      { blueprintId: 200, expansionId: 2, expansionName: 'Magic 2010' },
    ]);
    expect(ct.blueprints).toHaveBeenCalledTimes(1);
    expect(ct.blueprints).toHaveBeenCalledWith(2);
  });

  it('without matched blueprints throws ValidationError', async () => {
    const lookup = await catalog.lookup('ragavan');
    await expect(catalog.resolveBlueprints(lookup, [99])).rejects.toBeInstanceOf(ValidationError);
  });
});
