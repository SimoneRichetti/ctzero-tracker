import { computed, reactive, ref, type Ref } from 'vue';

/**
 * PrimeVue's MultiSelect "select all" replaces the selection with the filtered options,
 * so selecting "star trek" and then "marvel" loses the first ones. These helpers make it
 * add (or remove) only the options matching the current filter, keeping the rest.
 */

/** Same normalization as PrimeVue's "contains" filter: no accents, lower case. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
}

/** Ids of the options whose label contains `filter` (all of them when it is empty). */
export function matchingIds<T>(options: T[], label: (o: T) => string, id: (o: T) => number, filter: string): number[] {
  const f = normalize(filter.trim());
  return options.filter((o) => f === '' || normalize(label(o)).includes(f)).map(id);
}

/** Adds the visible ids to the selection (`checked`) or removes them, leaving the others alone. */
export function toggleVisible(selected: number[], visible: number[], checked: boolean): number[] {
  if (checked) return [...new Set([...selected, ...visible])];
  const hidden = new Set(visible);
  return selected.filter((id) => !hidden.has(id));
}

/** Bind to a filtered MultiSelect: `:select-all`, `@filter` and `@selectall-change`. */
export function useAdditiveSelectAll<T>(
  model: Ref<number[]>,
  options: Ref<T[]>,
  label: (o: T) => string,
  id: (o: T) => number,
) {
  const filter = ref('');
  const visible = computed(() => matchingIds(options.value, label, id, filter.value));
  const selectAll = computed(() => visible.value.length > 0 && visible.value.every((v) => model.value.includes(v)));
  return reactive({
    selectAll,
    onFilter: (e: { value: string }) => {
      filter.value = e.value ?? '';
    },
    onSelectAllChange: (e: { checked: boolean }) => {
      model.value = toggleVisible(model.value, visible.value, e.checked);
    },
  });
}
