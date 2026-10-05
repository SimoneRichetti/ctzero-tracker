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
    // Compare against the last notified price, so small drops accumulate.
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
    return { next: { ...ABOVE }, event: { kind: 'back_above', priceCents: price, thresholdCents } };
  }
  return { next: { ...ABOVE }, event: null };
}

/** Evaluation without notification: used when a card is created/edited. */
export function evaluateSilently(priceCents: number | null, thresholdCents: number): AlertSnapshot {
  if (priceCents !== null && priceCents <= thresholdCents) {
    return { alertState: 'below', lastNotifiedPriceCents: priceCents };
  }
  return { ...ABOVE };
}
