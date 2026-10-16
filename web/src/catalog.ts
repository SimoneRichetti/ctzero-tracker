import type { CardGroup, HealthDto, TrackedCardRow, TrackedSealedRow } from '@ctzero/shared';
import { computed, reactive, ref } from 'vue';
import { api } from './api';
import { latestRequest } from './latest-request';
import { cardNavCounts, countItems } from './nav-summary';

/**
 * Tracked items and groups, shared by the sidebar (counts) and the pages (lists).
 * Each list loads on its own: a failure on one does not empty the others.
 */
const cards = ref<TrackedCardRow[]>([]);
const sealed = ref<TrackedSealedRow[]>([]);
const groups = ref<CardGroup[]>([]);
const health = ref<HealthDto | null>(null);
const loading = reactive({ cards: false, sealed: false });
/** True once the first load of each list is done, so the pages can tell "empty" from "not loaded yet". */
const loaded = reactive({ cards: false, sealed: false, groups: false });

let onError: (message: string) => void = () => {};
const requests = { cards: latestRequest(), sealed: latestRequest(), groups: latestRequest() };

/** Set once by App.vue, which can show toasts. */
export function setCatalogErrorHandler(handler: (message: string) => void) {
  onError = handler;
}

type ListKey = keyof typeof requests;

/** Fetches one list; a response overtaken by a newer reload of the same list is dropped. */
async function load<T>(key: ListKey, path: string, assign: (data: T) => void) {
  const isLatest = requests[key].start();
  if (key !== 'groups') loading[key] = true;
  try {
    const data = await api.get<T>(path);
    if (isLatest()) assign(data);
  } catch (e) {
    if (isLatest()) onError((e as Error).message);
  } finally {
    if (isLatest()) {
      if (key !== 'groups') loading[key] = false;
      loaded[key] = true;
    }
  }
}

const reloadCards = () => load<TrackedCardRow[]>('cards', '/api/cards', (d) => (cards.value = d));
const reloadSealed = () => load<TrackedSealedRow[]>('sealed', '/api/sealed', (d) => (sealed.value = d));
const reloadGroups = () => load<CardGroup[]>('groups', '/api/groups', (d) => (groups.value = d));

async function loadHealth() {
  try {
    health.value = await api.get<HealthDto>('/api/health');
  } catch {
    health.value = null;
  }
}

/** Cards and groups change together (group counts, moves): reload both. */
function reloadCardsAndGroups() {
  return Promise.all([reloadCards(), reloadGroups()]).then(() => undefined);
}

function reloadAll() {
  return Promise.all([reloadCards(), reloadSealed(), reloadGroups()]).then(() => undefined);
}

const sortedGroups = computed(() => [...groups.value].sort((a, b) => a.name.localeCompare(b.name, 'en')));
const groupNames = computed(() => new Map(groups.value.map((g) => [g.id, g.name])));
const navCounts = computed(() => ({
  cards: cardNavCounts(
    cards.value,
    groups.value.map((g) => g.id),
  ),
  sealed: countItems(sealed.value),
}));

export function useCatalog() {
  return {
    cards,
    sealed,
    groups: sortedGroups,
    groupNames,
    health,
    loading,
    loaded,
    navCounts,
    reloadCards,
    reloadSealed,
    reloadGroups,
    reloadCardsAndGroups,
    reloadAll,
    loadHealth,
  };
}
