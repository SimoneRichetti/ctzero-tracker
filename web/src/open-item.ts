import { computed, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * The item shown in the detail panel, kept in `?item=` so it survives a reload and can be linked.
 * An id that is not in the (successfully loaded) list is dropped from the URL.
 */
export function useOpenItem<T extends { id: number }>(list: Ref<T[]>, isLoaded: () => boolean) {
  const route = useRoute();
  const router = useRouter();

  const openId = computed(() => {
    const raw = Number(route.query.item);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  });
  const openItem = computed(() => list.value.find((i) => i.id === openId.value) ?? null);

  function open(id: number) {
    void router.replace({ query: { ...route.query, item: String(id) } });
  }

  function close() {
    const { item: _item, ...rest } = route.query;
    void router.replace({ query: rest });
  }

  watch([openId, isLoaded, list], () => {
    if (openId.value !== null && isLoaded() && !openItem.value) close();
  });

  return { openId, openItem, open, close };
}
