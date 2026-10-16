import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { finishModel, fromFinish, toFinish } from './finish-choice';

describe('finish choice', () => {
  it('round-trips every foil value', () => {
    for (const foil of [null, true, false]) expect(fromFinish(toFinish(foil))).toBe(foil);
  });

  it('the model writes through to the foil ref', () => {
    const foil = ref<boolean | null>(null);
    const model = finishModel(foil);
    expect(model.value).toBe('any');
    model.value = 'nonfoil';
    expect(foil.value).toBe(false);
  });
});
