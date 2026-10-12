import {
  MIN_THRESHOLD_CENTS,
  percentBelow,
  type CardInput,
  type Condition,
  type DecklistLine,
  type ImportResolveResult,
  type Language,
} from '@ctzero/shared';
import type { BatchOutcome } from './batch-runner';
import type { ThresholdChoice } from './threshold-choice';

export type RowStatus = 'ok' | 'tracked' | 'no_offers' | 'not_found' | 'error';

export interface ReviewRow {
  line: DecklistLine;
  /** Foil used to resolve the line: the line's marker or the import default (null = any). */
  foil: boolean | null;
  result: ImportResolveResult | null;
  error: string | null;
  status: RowStatus;
  include: boolean;
  thresholdCents: number | null;
}

export function proposeThreshold(priceCents: number | null, def: ThresholdChoice): number | null {
  if (def.mode === 'fixed') return def.cents;
  return priceCents === null ? null : percentBelow(priceCents, def.percent);
}

/**
 * One row per resolved line, in list order. Lines are matched by identity with the batch items;
 * lines never reached (batch stopped) are left out.
 */
export function buildReviewRows(
  lines: DecklistLine[],
  outcome: Pick<BatchOutcome<DecklistLine, ImportResolveResult>, 'results' | 'errors'>,
  def: ThresholdChoice,
  defaultFoil: boolean | null,
): ReviewRow[] {
  const results = new Map(outcome.results.map((r) => [r.item, r.value]));
  const errors = new Map(outcome.errors.map((e) => [e.item, e]));
  const rows: ReviewRow[] = [];
  for (const line of lines) {
    const foil = line.foil || defaultFoil;
    const result = results.get(line);
    if (result) {
      const status: RowStatus = result.alreadyTracked ? 'tracked' : result.priceCents === null ? 'no_offers' : 'ok';
      const thresholdCents = proposeThreshold(result.priceCents, def);
      rows.push({ line, foil, result, error: null, status, thresholdCents, include: status !== 'tracked' && thresholdCents !== null });
      continue;
    }
    const error = errors.get(line);
    if (error) {
      rows.push({
        line,
        foil,
        result: null,
        error: error.message,
        status: error.status === 404 ? 'not_found' : 'error',
        include: false,
        thresholdCents: null,
      });
    }
  }
  return rows;
}

export function canInclude(row: ReviewRow): boolean {
  return row.result !== null && row.thresholdCents !== null && row.thresholdCents >= MIN_THRESHOLD_CENTS;
}

/**
 * Entering a valid threshold includes the row; clearing it or going below the minimum excludes it.
 * Rows of cards already tracked are only included by ticking them, never by editing the threshold.
 * The value is kept as typed, so the input is not wiped by partial values such as 0 on the way to 0.50.
 */
export function setRowThreshold(row: ReviewRow, cents: number | null): void {
  row.thresholdCents = cents;
  row.include = canInclude(row) && (row.status !== 'tracked' || row.include);
}

export function rowsToCreate(rows: ReviewRow[]): ReviewRow[] {
  return rows.filter((r) => r.include && canInclude(r));
}

export function createPayload(
  row: ReviewRow,
  opts: { languages: Language[]; minCondition: Condition; groupId: number | null },
): CardInput {
  return {
    name: row.result!.name,
    expansionIds: row.result!.expansionIds,
    languages: opts.languages,
    minCondition: opts.minCondition,
    foil: row.foil,
    thresholdCents: row.thresholdCents!,
    groupId: opts.groupId,
  };
}
