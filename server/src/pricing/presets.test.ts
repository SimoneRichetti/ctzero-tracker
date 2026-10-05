import { describe, expect, it } from 'vitest';
import { thresholdPresets } from './presets';

describe('thresholdPresets', () => {
  it('propone -10/-20/-30% e 1 €', () => {
    expect(thresholdPresets(4000)).toEqual([
      { label: '-10%', cents: 3600 },
      { label: '-20%', cents: 3200 },
      { label: '-30%', cents: 2800 },
      { label: '1 €', cents: 100 },
    ]);
  });

  it('arrotonda al centesimo', () => {
    expect(thresholdPresets(3333).map((p) => p.cents)).toEqual([3000, 2666, 2333, 100]);
  });

  it('omette 1 € se il prezzo non lo supera', () => {
    expect(thresholdPresets(100).map((p) => p.label)).toEqual(['-10%', '-20%', '-30%']);
  });

  it('senza prezzo propone solo 1 €', () => {
    expect(thresholdPresets(null)).toEqual([{ label: '1 €', cents: 100 }]);
  });
});
