import { describe, expect, it, vi } from 'vitest';
import type { CtBlueprint, CtExpansion } from '../clients/cardtrader';
import type { CtProduct } from '../clients/cardtrader-types';
import { ValidationError } from '../errors';
import { makeProduct } from '../test-utils';
import { SealedCatalog, decodeEntities, parseBlueprintRef } from './sealed-catalog';

const expansions: CtExpansion[] = [
  { id: 3627, game_id: 1, code: 'mh3', name: 'Modern Horizons 3' },
  { id: 990, game_id: 1, code: 'sld', name: 'Secret Lair Drop Series' },
];

const img = (id: number) => `https://cardtrader.com/uploads/blueprints/image/${id}/preview_x.jpg`;
const blueprintsByExpansion: Record<number, CtBlueprint[]> = {
  3627: [
    { id: 279368, name: 'Modern Horizons 3: Play Booster Box', expansion_id: 3627, category_id: 4, scryfall_id: null, image_url: img(279368) },
    { id: 279369, name: 'Modern Horizons 3: Collector Booster Box', expansion_id: 3627, category_id: 4, scryfall_id: null, image_url: img(279369) },
    { id: 279300, name: 'Emrakul, the World Anew', expansion_id: 3627, category_id: 1, scryfall_id: 's1', image_url: img(279300) },
    { id: 279400, name: 'Modern Horizons 3 D20 Die', expansion_id: 3627, category_id: 22, scryfall_id: null, image_url: img(279400) },
    { id: 279401, name: 'Modern Horizons 3: Fat Pack Bundle', expansion_id: 3627, category_id: 23, scryfall_id: null, image_url: null },
  ],
  990: [
    { id: 62421, name: 'Secret Lair x Beadle &amp; Grimm&#39;s', expansion_id: 990, category_id: 13, scryfall_id: null, image_url: img(62421) },
  ],
};

function setup(listings: Record<number, CtProduct[]> = {}) {
  const ct = {
    blueprints: vi.fn(async (expansionId: number) => blueprintsByExpansion[expansionId] ?? []),
    products: vi.fn(async (blueprintId: number) => listings[blueprintId] ?? []),
  };
  const clock = { now: 0 };
  const expansionsFn = vi.fn(async (_maxAgeMs?: number) => expansions);
  return { ct, clock, expansionsFn, catalog: new SealedCatalog(ct, expansionsFn, () => clock.now) };
}

describe('decodeEntities', () => {
  it('decodes the entities CardTrader uses', () => {
    expect(decodeEntities('A &amp; B &quot;C&quot; D&#39;s &lt;x&gt;')).toBe(`A & B "C" D's <x>`);
    expect(decodeEntities('plain')).toBe('plain');
  });
});

describe('parseBlueprintRef', () => {
  it('extracts the id from CardTrader links', () => {
    expect(parseBlueprintRef('https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit')).toBe(389300);
    expect(parseBlueprintRef('  https://www.cardtrader.com/cards/279368?share=1  ')).toBe(279368);
    expect(parseBlueprintRef('https://www.cardtrader.com/it/cards/279368')).toBe(279368);
  });

  it('accepts a bare numeric id', () => {
    expect(parseBlueprintRef(' 279368 ')).toBe(279368);
  });

  it('rejects anything else', () => {
    expect(() => parseBlueprintRef('https://www.cardtrader.com/en/cards/the-hobbit-play-booster-box')).toThrow(ValidationError);
    expect(() => parseBlueprintRef('hello')).toThrow(ValidationError);
    expect(() => parseBlueprintRef('0')).toThrow(ValidationError);
    expect(() => parseBlueprintRef('')).toThrow(ValidationError);
  });
});

describe('SealedCatalog', () => {
  it('lists expansions sorted by name', async () => {
    const { catalog } = setup();
    expect(await catalog.listExpansions()).toEqual([
      { id: 3627, code: 'mh3', name: 'Modern Horizons 3' },
      { id: 990, code: 'sld', name: 'Secret Lair Drop Series' },
    ]);
  });

  it('keeps only whitelisted sealed categories, sorted by name', async () => {
    const { catalog } = setup();
    expect(await catalog.sealedProducts(3627)).toEqual([
      {
        blueprintId: 279369,
        name: 'Modern Horizons 3: Collector Booster Box',
        expansionId: 3627,
        expansionName: 'Modern Horizons 3',
        categoryName: 'Booster Box',
        imageUrl: img(279369),
      },
      {
        blueprintId: 279401,
        name: 'Modern Horizons 3: Fat Pack Bundle',
        expansionId: 3627,
        expansionName: 'Modern Horizons 3',
        categoryName: 'Bundle',
        imageUrl: null,
      },
      {
        blueprintId: 279368,
        name: 'Modern Horizons 3: Play Booster Box',
        expansionId: 3627,
        expansionName: 'Modern Horizons 3',
        categoryName: 'Booster Box',
        imageUrl: img(279368),
      },
    ]);
  });

  it('decodes HTML entities in names', async () => {
    const { catalog } = setup();
    expect((await catalog.sealedProducts(990))[0]).toMatchObject({ name: "Secret Lair x Beadle & Grimm's", categoryName: 'Boxed Set' });
  });

  it('unknown expansion → ValidationError', async () => {
    const { catalog } = setup();
    await expect(catalog.sealedProducts(42)).rejects.toThrow(ValidationError);
  });

  it('resolves a blueprint id through its listings', async () => {
    const listing = makeProduct({ blueprint_id: 279368, expansion: { id: 3627, code: 'mh3', name_en: 'Modern Horizons 3' } });
    const { catalog, ct } = setup({ 279368: [listing] });
    await expect(catalog.sealedProduct(279368)).resolves.toMatchObject({ blueprintId: 279368, categoryName: 'Booster Box' });
    expect(ct.products).toHaveBeenCalledWith(279368, {});
  });

  it('with its expansion id, a product without listings is resolved from the expansion', async () => {
    const { catalog, ct } = setup();
    await expect(catalog.sealedProduct(279368, 3627)).resolves.toMatchObject({ blueprintId: 279368, categoryName: 'Booster Box' });
    expect(ct.products).not.toHaveBeenCalled();
  });

  it('with its expansion id, a blueprint outside that expansion is rejected', async () => {
    const { catalog } = setup();
    await expect(catalog.sealedProduct(62421, 3627)).rejects.toThrow(/not a sealed product/);
  });

  it('a product without listings cannot be identified', async () => {
    const { catalog } = setup();
    await expect(catalog.sealedProduct(279368)).rejects.toThrow(/select it from its expansion/);
  });

  it('a single card is not a sealed product', async () => {
    const listing = makeProduct({ blueprint_id: 279300, expansion: { id: 3627, code: 'mh3', name_en: 'Modern Horizons 3' } });
    const { catalog } = setup({ 279300: [listing] });
    await expect(catalog.sealedProduct(279300)).rejects.toThrow(/not a sealed product/);
  });

  it('caches the products of an expansion for 10 minutes', async () => {
    const { catalog, ct, clock } = setup();
    await catalog.sealedProducts(3627);
    await catalog.sealedProduct(279368, 3627);
    expect(ct.blueprints).toHaveBeenCalledTimes(1);
    clock.now = 11 * 60 * 1000;
    await catalog.sealedProducts(3627);
    expect(ct.blueprints).toHaveBeenCalledTimes(2);
  });

  it('an expansion missing from the cached list is looked up again in a recent list', async () => {
    const { catalog, expansionsFn } = setup();
    const fresh: CtExpansion = { id: 5000, game_id: 1, code: 'new', name: 'Brand New Set' };
    blueprintsByExpansion[5000] = [
      { id: 500001, name: 'Brand New Set: Play Booster Box', expansion_id: 5000, category_id: 4, scryfall_id: null, image_url: null },
    ];
    expansionsFn.mockImplementation(async (maxAgeMs?: number) => (maxAgeMs === undefined ? expansions : [...expansions, fresh]));
    await expect(catalog.sealedProducts(5000)).resolves.toMatchObject([{ blueprintId: 500001, expansionName: 'Brand New Set' }]);
    expect(expansionsFn).toHaveBeenLastCalledWith(10 * 60 * 1000);
    delete blueprintsByExpansion[5000];
  });
});
