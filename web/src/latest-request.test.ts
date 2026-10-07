import { describe, expect, it } from 'vitest';
import { latestRequest } from './latest-request';

describe('latestRequest', () => {
  it('only the most recent request is current', () => {
    const tracker = latestRequest();
    const first = tracker.start();
    expect(first()).toBe(true);
    const second = tracker.start();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('cancel invalidates the pending request', () => {
    const tracker = latestRequest();
    const pending = tracker.start();
    tracker.cancel();
    expect(pending()).toBe(false);
  });
});
