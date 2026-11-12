import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { matchingIds, toggleVisible, useAdditiveSelectAll } from './additive-select-all';

const expansions = [
  { id: 1, name: 'Star Trek' },
  { id: 2, name: 'Star Trek Commander' },
  { id: 3, name: 'Marvel Super Heroes' },
  { id: 4, name: 'Pokémon? No, Modern Horizons' },
];
const label = (e: { name: string }) => e.name;
const id = (e: { id: number }) => e.id;

describe('matchingIds', () => {
  it('matches like PrimeVue "contains": case and accents ignored, empty = all', () => {
    expect(matchingIds(expansions, label, id, 'star TREK')).toEqual([1, 2]);
    expect(matchingIds(expansions, label, id, 'pokemon')).toEqual([4]);
    expect(matchingIds(expansions, label, id, '  ')).toEqual([1, 2, 3, 4]);
  });
});

describe('toggleVisible', () => {
  it('adds without duplicates and removes only the visible ids', () => {
    expect(toggleVisible([1, 2], [2, 3], true)).toEqual([1, 2, 3]);
    expect(toggleVisible([1, 2, 3], [2, 3], false)).toEqual([1]);
  });
});

describe('useAdditiveSelectAll', () => {
  it('selecting all on two different searches keeps both', () => {
    const model = ref<number[]>([]);
    const s = useAdditiveSelectAll(model, ref(expansions), label, id);
    s.onFilter({ value: 'star trek' });
    expect(s.selectAll).toBe(false);
    s.onSelectAllChange({ checked: true });
    expect(s.selectAll).toBe(true);
    s.onFilter({ value: 'marvel' });
    expect(s.selectAll).toBe(false);
    s.onSelectAllChange({ checked: true });
    expect(model.value).toEqual([1, 2, 3]);
    s.onSelectAllChange({ checked: false });
    expect(model.value).toEqual([1, 2]);
  });

  it('with no option matching, select all is unchecked and changes nothing', () => {
    const model = ref<number[]>([1]);
    const s = useAdditiveSelectAll(model, ref(expansions), label, id);
    s.onFilter({ value: 'zzz' });
    expect(s.selectAll).toBe(false);
    s.onSelectAllChange({ checked: true });
    expect(model.value).toEqual([1]);
  });
});
