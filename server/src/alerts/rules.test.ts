import { describe, expect, it } from 'vitest';
import { evaluateAlert, evaluateSilently, type AlertSnapshot } from './rules';

const T = 4000;
const fresh: AlertSnapshot = { alertState: null, lastNotifiedPriceCents: null };
const above: AlertSnapshot = { alertState: 'above', lastNotifiedPriceCents: null };
const below3900: AlertSnapshot = { alertState: 'below', lastNotifiedPriceCents: 3900 };

describe('evaluateAlert', () => {
  it('prima discesa sotto soglia → evento below', () => {
    const r = evaluateAlert(fresh, { status: 'ok', priceCents: 3900 }, T, 5);
    expect(r.event).toEqual({ kind: 'below', priceCents: 3900, thresholdCents: T });
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3900 });
  });

  it('prezzo pari alla soglia conta come sotto', () => {
    expect(evaluateAlert(above, { status: 'ok', priceCents: T }, T, 5).event?.kind).toBe('below');
  });

  it('già sotto, calo inferiore alla percentuale → nessun evento, stato invariato', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 3800 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(below3900);
  });

  it('già sotto, calo pari alla percentuale → further_drop', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 3705 }, T, 5);
    expect(r.event).toEqual({ kind: 'further_drop', priceCents: 3705, previousCents: 3900 });
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3705 });
  });

  it("i cali piccoli si accumulano rispetto all'ultimo prezzo notificato", () => {
    const step1 = evaluateAlert(below3900, { status: 'ok', priceCents: 3800 }, T, 5);
    expect(step1.event).toBeNull();
    const step2 = evaluateAlert(step1.next, { status: 'ok', priceCents: 3700 }, T, 5);
    expect(step2.event).toEqual({ kind: 'further_drop', priceCents: 3700, previousCents: 3900 });
  });

  it('da sotto a sopra soglia → back_above', () => {
    const r = evaluateAlert(below3900, { status: 'ok', priceCents: 4100 }, T, 5);
    expect(r.event).toEqual({ kind: 'back_above', priceCents: 4100, thresholdCents: T });
    expect(r.next).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
  });

  it('da sotto a nessuna offerta → back_above senza prezzo', () => {
    const r = evaluateAlert(below3900, { status: 'no_offers' }, T, 5);
    expect(r.event).toEqual({ kind: 'back_above', priceCents: null, thresholdCents: T });
    expect(r.next.alertState).toBe('above');
  });

  it('sopra soglia e resta sopra → niente', () => {
    const r = evaluateAlert(above, { status: 'ok', priceCents: 4500 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(above);
  });

  it('nessuna offerta senza essere mai stata sotto → above silenzioso', () => {
    const r = evaluateAlert(fresh, { status: 'no_offers' }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual(above);
  });

  it('sotto con prezzo notificato mancante usa il prezzo attuale come riferimento', () => {
    const r = evaluateAlert({ alertState: 'below', lastNotifiedPriceCents: null }, { status: 'ok', priceCents: 3000 }, T, 5);
    expect(r.event).toBeNull();
    expect(r.next).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3000 });
  });
});

describe('evaluateSilently', () => {
  it('sotto o pari soglia → below con il prezzo come riferimento', () => {
    expect(evaluateSilently(3900, T)).toEqual({ alertState: 'below', lastNotifiedPriceCents: 3900 });
    expect(evaluateSilently(T, T)).toEqual({ alertState: 'below', lastNotifiedPriceCents: T });
  });

  it('sopra soglia o senza prezzo → above', () => {
    expect(evaluateSilently(4100, T)).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
    expect(evaluateSilently(null, T)).toEqual({ alertState: 'above', lastNotifiedPriceCents: null });
  });
});
