import { FilterMatchMode, FilterService } from '@primevue/core/api';
import { computed, reactive, ref, type Ref } from 'vue';

/**
 * PrimeVue's MultiSelect "select all" replaces the selection with the filtered options,
 * so selecting "star trek" and then "marvel" loses the first ones. These helpers make it
 * add (or remove) only the options matching the current filter, keeping the rest.
 */

/** Ids of the options whose label contains `filter` (all of them when it is empty): the same call MultiSelect makes. */
export function matchingIds<T extends object>(options: T[], optionLabel: keyof T, optionValue: keyof T, filter: string): number[] {
  const shown: T[] = filter ? FilterService.filter(options, [String(optionLabel)], filter, FilterMatchMode.CONTAINS) : options;
  return shown.map((o) => Number(o[optionValue]));
}

/** Adds the visible ids to the selection (`checked`) or removes them, leaving the others alone. */
export function toggleVisible(selected: number[], visible: number[], checked: boolean): number[] {
  if (checked) return [...new Set([...selected, ...visible])];
  const hidden = new Set(visible);
  return selected.filter((id) => !hidden.has(id));
}

/**
 * Spread on a filtered MultiSelect with `v-bind`; `optionLabel`/`optionValue` are the MultiSelect's own.
 * PrimeVue doesn't report when its filter is cleared (closing with reset-filter-on-hide, or a remount),
 * so its filter is reset on hide and ours is forgotten on every open, when PrimeVue's is always empty too.
 */
export function useAdditiveSelectAll<T extends object>(model: Ref<number[]>, options: Ref<T[]>, optionLabel: keyof T, optionValue: keyof T) {
  const filter = ref('');
  const visible = computed(() => matchingIds(options.value, optionLabel, optionValue, filter.value));
  const selectAll = computed(() => visible.value.length > 0 && visible.value.every((v) => model.value.includes(v)));
  return reactive({
    selectAll,
    resetFilterOnHide: true,
    onShow: () => {
      filter.value = '';
    },
    onFilter: (e: { value: string }) => {
      filter.value = e.value ?? '';
    },
    onSelectallChange: (e: { checked: boolean }) => {
      model.value = toggleVisible(model.value, visible.value, e.checked);
    },
  });
}
