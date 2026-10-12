import type { DecklistLine, ImportResolveResult } from '@ctzero/shared';
import { describe, expect, it } from 'vitest';
import {
  buildReviewRows,
  canInclude,
  createPayload,
  proposeThreshold,
  rowsToCreate,
  setRowThreshold,
} from './import-review';

const line = (name: string, lineNo: number, foil = false): DecklistLine => ({ name, setCode: null, foil, lineNo });
const result = (over: Partial<ImportResolveResult> = {}): ImportResolveResult => ({
  name: 'Sol Ring',
  imageUrl: null,
  expansionIds: [],
  priceCents: 1000,
  listing: null,
  alreadyTracked: false,
  ...over,
});
const percent = { mode: 'percent' as const, percent: 10 };

describe('proposeThreshold', () => {
  it('percent of the current price, or the fixed amount', () => {
    expect(proposeThreshold(1000, percent)).toBe(900);
    expect(proposeThreshold(null, percent)).toBeNull();
    expect(proposeThreshold(null, { mode: 'fixed', cents: 500 })).toBe(500);
  });
});

describe('buildReviewRows', () => {
  const a = line('sol ring', 1);
  const b = line('Bolt', 2, true);
  const c = line('Xyz', 3);
  const d = line('Signet', 4);
  const e = line('Tower', 5);
  const f = line('Unresolved', 6);
  const outcome = {
    results: [
      { item: a, value: result() },
      { item: b, value: result({ name: 'Lightning Bolt', priceCents: null }) },
      { item: d, value: result({ name: 'Arcane Signet', alreadyTracked: true }) },
    ],
    errors: [
      { item: c, message: 'Card "Xyz" not found', status: 404 },
      { item: e, message: 'HTTP 502', status: 502 },
    ],
  };
  const rows = buildReviewRows([a, b, c, d, e, f], outcome, percent, false);

  it('keeps list order and drops lines never resolved (aborted)', () => {
    expect(rows.map((r) => r.line.lineNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it('sets status, default inclusion and proposed threshold', () => {
    expect(rows.map((r) => [r.status, r.include, r.thresholdCents])).toEqual([
      ['ok', true, 900],
      ['no_offers', false, null],
      ['not_found', false, null],
      ['tracked', false, 900],
      ['error', false, null],
    ]);
    expect(rows[2]!.error).toBe('Card "Xyz" not found');
  });

  it('foil comes from the line or the default', () => {
    expect(rows[1]!.foil).toBe(true);
    expect(buildReviewRows([a], outcome, percent, true)[0]!.foil).toBe(true);
  });

  it('fixed mode includes no-offer cards with the fixed threshold', () => {
    const fixed = buildReviewRows([b], outcome, { mode: 'fixed', cents: 300 }, false);
    expect(fixed[0]).toMatchObject({ status: 'no_offers', include: true, thresholdCents: 300 });
  });
});

describe('inclusion and threshold edits', () => {
  it('matches lines by identity: an equal but different line object is treated as unresolved', () => {
    const rows = buildReviewRows(
      [line('Bolt', 1)],
      { results: [{ item: line('Bolt', 1), value: result({ priceCents: null }) }], errors: [] },
      percent,
      false,
    );
    expect(rows).toEqual([]);
  });

  it('setRowThreshold: a manual threshold includes a no-offer row; clearing it excludes the row', () => {
    const l = line('Bolt', 1);
    const [row] = buildReviewRows([l], { results: [{ item: l, value: result({ priceCents: null }) }], errors: [] }, percent, false);
    expect(canInclude(row!)).toBe(false);
    setRowThreshold(row!, 250);
    expect(row).toMatchObject({ thresholdCents: 250, include: true });
    setRowThreshold(row!, null);
    expect(row).toMatchObject({ thresholdCents: null, include: false });
  });

  it('setRowThreshold: a threshold below the minimum excludes the row', () => {
    const l = line('Bolt', 1);
    const [row] = buildReviewRows([l], { results: [{ item: l, value: result({ priceCents: 50 }) }], errors: [] }, percent, false);
    setRowThreshold(row!, 10);
    expect(row).toMatchObject({ thresholdCents: null, include: false });
  });

  it('rowsToCreate keeps only included rows with a result and a threshold', () => {
    const l1 = line('A', 1);
    const l2 = line('B', 2);
    const rows = buildReviewRows(
      [l1, l2],
      { results: [{ item: l1, value: result() }, { item: l2, value: result({ alreadyTracked: true }) }], errors: [] },
      percent,
      false,
    );
    expect(rowsToCreate(rows).map((r) => r.line.name)).toEqual(['A']);
    rows[1]!.include = true;
    expect(rowsToCreate(rows)).toHaveLength(2);
  });
});

describe('createPayload', () => {
  it('builds the card input with the resolved name and expansions', () => {
    const l = line('sol ring', 1, true);
    const [row] = buildReviewRows([l], { results: [{ item: l, value: result({ expansionIds: [7] }) }], errors: [] }, percent, false);
    expect(createPayload(row!, { languages: ['en'], minCondition: 'Near Mint', groupId: 4 })).toEqual({
      name: 'Sol Ring',
      expansionIds: [7],
      languages: ['en'],
      minCondition: 'Near Mint',
      foil: true,
      thresholdCents: 900,
      groupId: 4,
    });
  });
});
