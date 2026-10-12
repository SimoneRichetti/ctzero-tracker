import { describe, expect, it } from 'vitest';
import { thresholdChoice } from './threshold-choice';

describe('thresholdChoice', () => {
  it('percent mode accepts 1–90 and ignores the amount', () => {
    expect(thresholdChoice('percent', 10, null)).toEqual({ mode: 'percent', percent: 10 });
    expect(thresholdChoice('percent', 0, 5)).toBeNull();
    expect(thresholdChoice('percent', 91, 5)).toBeNull();
    expect(thresholdChoice('percent', null, 5)).toBeNull();
  });

  it('fixed mode converts to cents and enforces the minimum threshold', () => {
    expect(thresholdChoice('fixed', 10, 1.5)).toEqual({ mode: 'fixed', cents: 150 });
    expect(thresholdChoice('fixed', 10, 0.11)).toEqual({ mode: 'fixed', cents: 11 });
    expect(thresholdChoice('fixed', 10, 0.1)).toBeNull();
    expect(thresholdChoice('fixed', 10, null)).toBeNull();
  });
});
