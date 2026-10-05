import { describe, expect, it } from 'vitest';
import { evaluateAlert, evaluateSilently, type AlertSnapshot } from './rules';

const T = 4000;
const fresh: AlertSnapshot = { alertState: null, lastNotifiedPriceCents: null };
const above: AlertSnapshot = { alertState: 'above', lastNotifiedPriceCents: null };
const below3900: AlertSnapshot = { alertState: 'below', lastNotifiedPriceCents: 3900 };

describe('evaluateAlert', () => {
  it('first drop below threshold → below event', () => {
    const r = evaluateAlert(fresh, { status: 'ok', priceCents: 3900 }, T, 5);
    expect(r.event).toEqual({ kind: 'below', priceCents: 3900, thresholdCents: T });
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3900 });
  });

  it('price equal to threshold counts as below', () => {
    expect(evaluateAlert(above, { status: 'ok', priceCents: T }, T, 5).event?.kind).toBe('below');
  });

  it('already below, drop smaller than percentage → no event, state unchanged', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 3800 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(below3900);
  });

  it('already below, drop equal to percentage → further_drop', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 3705 }, T, 5);
    expect(r.event).toEqual({ kind: 'further_drop', priceCents: 3705, previousCents: 3900 });
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3705 });
  });

  it('small drops accumulate relative to the last notified price', () => {
    const step1 = evaluateAlert(below3900, { status: 'ok', priceCents: 3800 }, T, 5);
    expect(step1.event).toBeNull();
    const step2 = evaluateAlert(step1.next, { status: 'ok', priceCents: 3700 }, T, 5);
    expect(step2.event).toEqual({ kind: 'further_drop', priceCents: 3700, previousCents: 3900 });
  });

  it('from below to above threshold → back_above', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 4100 }, T, 5);
    expect(r.event).toEqual({ kind: 'back_above', priceCents: 4100, thresholdCents: T });
    expect(r.next).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('from below to no offers → back_above without price', () => {
    const r = evaluateAlert(below3900, { status: 'no_offers' }, T, 5);
    expect(r.event).toEqual({ kind: 'back_above', priceCents: null, thresholdCents: T });
    expect(r.next.alertState).toBe('above');
  });

  it('above threshold and stays above → nothing', () => {
    const r = evaluateAlert(above, { status: 'ok', priceCents: 4500 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(above);
  });

  it('no offers without ever being below → silent above', () => {
    const r = evaluateAlert(fresh, { status: 'no_offers' }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(above);
  });

  it('below with missing notified price uses the current price as reference', () => {
    const r = evaluateAlert({ alertState: 'below', lastNotifiedPriceCents: null }, { status: 'ok', priceCents: 3000 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3000 });
  });
});

describe('evaluateSilently', () => {
  it('below or equal to threshold → below with the price as reference', () => {
    expect(evaluateSilently(3900, T)).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3900 });
    expect(evaluateSilently(T, T)).toEqual({ alertState: 'below', lastNotifiedPriceCents: T });
  });

  it('above threshold or without price → above', () => {
    expect(evaluateSilently(4100, T)).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
    expect(evaluateSilently(null, T)).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
  });
});
