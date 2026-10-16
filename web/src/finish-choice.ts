import { computed, type Ref } from 'vue';

/**
 * The foil filter is `boolean | null`, but PrimeVue's Select shows `null` as "nothing selected":
 * the select works on these keys instead.
 */
export type Finish = 'any' | 'foil' | 'nonfoil';

export const FINISH_OPTIONS: { label: string; value: Finish }[] = [
  { label: 'Foil or non-foil', value: 'any' },
  { label: 'Foil only', value: 'foil' },
  { label: 'Non-foil only', value: 'nonfoil' },
];

export function toFinish(foil: boolean | null): Finish {
  return foil === null ? 'any' : foil ? 'foil' : 'nonfoil';
}

export function fromFinish(finish: Finish): boolean | null {
  return finish === 'any' ? null : finish === 'foil';
}

/** A two-way model for a Select bound to a `boolean | null` foil value. */
export function finishModel(foil: Ref<boolean | null>) {
  return computed({
    get: () => toFinish(foil.value),
    set: (v: Finish) => (foil.value = fromFinish(v)),
  });
}
