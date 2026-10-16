<script setup lang="ts" generic="R extends TrackedCardRow | TrackedSealedRow">
import { formatEuro, type TrackedCardRow, type TrackedSealedRow } from '@ctzero/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cardStatus } from '../card-status';
import { summarize } from '../group-summary';
import { SORT_OPTIONS, STATUS_TABS, filterByTab, matchesSearch, parseSort, parseTab, sortItems, tabCounts, type SortKey, type StatusTab } from '../list-filters';
import { cardMetaLine, cardTraderUrl, formatChange, largeImageUrl, listingLine, sealedMetaLine } from '../row-format';
import PriceSparkline from './PriceSparkline.vue';
import SegmentedControl from './SegmentedControl.vue';
import StatusPill from './StatusPill.vue';
import TargetGap from './TargetGap.vue';

type Row = TrackedCardRow | TrackedSealedRow;

const props = defineProps<{
  kind: 'card' | 'sealed';
  /** Every item of the view; status filter, search and sort are applied here. */
  items: R[];
  loading: boolean;
  /** Show the group of each card (the "All cards" view). */
  groupNames?: Map<number, string>;
  openId: number | null;
  emptyText: string;
}>();
const selection = defineModel<R[]>('selection', { required: true });
const emit = defineEmits<{ open: [id: number] }>();

const route = useRoute();
const router = useRouter();

const tab = computed(() => parseTab(route.query.status));
const sort = computed(() => parseSort(route.query.sort));
const search = ref(typeof route.query.q === 'string' ? route.query.q : '');

function setQuery(patch: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } });
}

const tabModel = computed({
  get: () => tab.value,
  set: (v: StatusTab) => setQuery({ status: v === 'all' ? undefined : v }),
});
const sortModel = computed({
  get: () => sort.value,
  set: (v: SortKey) => setQuery({ sort: v === 'status' ? undefined : v }),
});
watch(search, (q) => setQuery({ q: q.trim() ? q : undefined }));
watch(
  () => route.query.q,
  (q) => {
    const value = typeof q === 'string' ? q : '';
    if (value !== search.value) search.value = value;
  },
);

// The selection only makes sense among the rows shown.
watch([tab, () => route.query.q], () => (selection.value = []));

const summary = computed(() => summarize(props.items));
const searched = computed(() => props.items.filter((i) => matchesSearch(i.name, search.value)));
const counts = computed(() => tabCounts(searched.value));
const tabOptions = computed(() => STATUS_TABS.map((t) => ({ ...t, count: counts.value[t.value] })));
const rows = computed(() => sortItems(filterByTab(searched.value, tab.value), sort.value));

/** Display values of each visible row, computed once per change instead of on every render. */
const info = computed(
  () =>
    new Map(
      rows.value.map((row) => {
        const card = props.kind === 'card' ? (row as TrackedCardRow) : null;
        return [
          row.id,
          {
            meta: card ? cardMetaLine(card) : sealedMetaLine(row as TrackedSealedRow),
            group: card && card.groupId !== null ? props.groupNames?.get(card.groupId) : undefined,
            listing: listingLine(props.kind, row.lastListing),
            change: formatChange(row.trend.change7dPct),
            url: cardTraderUrl(row),
          },
        ];
      }),
    ),
);
const rowInfo = (row: Row) => info.value.get(row.id)!;

function rowClass(row: Row) {
  return row.id === props.openId ? 'is-open' : undefined;
}

// Hover preview: stored images are small thumbnails, swapped for a larger version.
const preview = ref<{ src: string; alt: string; top: number; left: number; width: number } | null>(null);

function showPreview(event: MouseEvent, row: Row) {
  if (!row.imageUrl) return;
  const card = props.kind === 'card';
  const width = card ? 244 : 300;
  const height = card ? Math.round(width * (680 / 488)) : 300;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const margin = 8;
  const top = Math.min(Math.max(margin, rect.top + rect.height / 2 - height / 2), window.innerHeight - height - margin);
  preview.value = { src: largeImageUrl(props.kind, row.imageUrl), alt: row.name, top, left: rect.right + 12, width };
}
</script>

<template>
  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Tracked</div>
      <div class="kpi-value mono">{{ summary.count }}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Below target</div>
      <div class="kpi-value mono accent">{{ summary.below }}</div>
      <div class="kpi-sub">at or under the price you set</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Current total</div>
      <div class="kpi-value mono">{{ formatEuro(summary.totalPriceCents) }}</div>
      <div class="kpi-sub">
        target total {{ formatEuro(summary.totalThresholdCents) }}<template v-if="summary.missingPrice > 0"> · {{ summary.missingPrice }} without price</template>
      </div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Needs attention</div>
      <div class="kpi-value mono" :class="{ warn: summary.problems > 0 }">{{ summary.problems }}</div>
      <div class="kpi-sub">no offers or failed update</div>
    </div>
  </div>

  <div class="toolbar">
    <SegmentedControl v-model="tabModel" :options="tabOptions" label="Filter by status" />
    <div class="toolbar-right">
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" type="search" :placeholder="kind === 'card' ? 'Search cards' : 'Search products'" aria-label="Search" />
      </IconField>
      <Select v-model="sortModel" :options="SORT_OPTIONS" option-label="label" option-value="value" aria-label="Sort by" class="sort">
        <template #value="{ value }">Sort: {{ SORT_OPTIONS.find((o) => o.value === value)?.label }}</template>
      </Select>
    </div>
  </div>

  <DataTable
    v-model:selection="selection"
    :value="rows"
    :loading="loading && items.length === 0"
    data-key="id"
    :row-class="rowClass"
    class="ct-table"
    scrollable
  >
    <template #empty>{{ items.length === 0 ? emptyText : 'Nothing matches these filters.' }}</template>
    <Column selection-mode="multiple" header-style="width: 3rem" />
    <Column :header="kind === 'card' ? 'Card' : 'Product'">
      <template #body="{ data }">
        <div class="item">
          <img
            v-if="data.imageUrl"
            :src="data.imageUrl"
            :alt="data.name"
            class="thumb"
            :class="kind"
            loading="lazy"
            @mouseenter="showPreview($event, data)"
            @mouseleave="preview = null"
          />
          <div v-else class="thumb placeholder" :class="kind" aria-hidden="true"></div>
          <div class="item-text">
            <button type="button" class="item-name" @click="emit('open', data.id)">{{ data.name }}</button>
            <div class="item-meta">
              <span v-if="rowInfo(data).group" class="group-chip"><i class="pi pi-folder" aria-hidden="true"></i>{{ rowInfo(data).group }}</span>
              <span>{{ rowInfo(data).meta }}</span>
            </div>
          </div>
        </div>
      </template>
    </Column>
    <Column header="CT Zero price" style="width: 11rem">
      <template #body="{ data }">
        <div class="price mono">{{ data.lastPriceCents === null ? '—' : formatEuro(data.lastPriceCents) }}</div>
        <StatusPill v-tooltip.top="data.lastError ?? undefined" :status="cardStatus(data)" class="pill" />
        <div v-if="rowInfo(data).listing" class="listing">{{ rowInfo(data).listing }}</div>
      </template>
    </Column>
    <Column header="Target" style="width: 11.5rem">
      <template #body="{ data }">
        <div class="mono">{{ formatEuro(data.thresholdCents) }}</div>
        <TargetGap :item="data" />
      </template>
    </Column>
    <Column header="7 days" style="width: 10rem">
      <template #body="{ data }">
        <button
          v-if="data.trend.sparkline.length > 1"
          type="button"
          class="trend"
          :class="`tone-${rowInfo(data).change.tone}`"
          :aria-label="`Price history of ${data.name}`"
          @click="emit('open', data.id)"
        >
          <PriceSparkline :points="data.trend.sparkline" />
          <span class="mono">{{ rowInfo(data).change.text }}</span>
        </button>
        <span v-else-if="data.lastSyncStatus === 'error'" v-tooltip.top="data.lastError ?? undefined" class="no-trend">Update failed</span>
        <span v-else class="no-trend">No data yet</span>
      </template>
    </Column>
    <Column style="width: 6rem">
      <template #header><span class="visually-hidden">Actions</span></template>
      <template #body="{ data }">
        <div class="actions">
          <a :href="rowInfo(data).url" target="_blank" rel="noopener" :aria-label="`Open ${data.name} on CardTrader`" v-tooltip.top="'Open on CardTrader'">
            <i class="pi pi-external-link" aria-hidden="true"></i>
          </a>
          <Button icon="pi pi-angle-right" text rounded severity="secondary" :aria-label="`Open details of ${data.name}`" @click="emit('open', data.id)" />
        </div>
      </template>
    </Column>
  </DataTable>

  <Teleport to="body">
    <img
      v-if="preview"
      :src="preview.src"
      :alt="preview.alt"
      class="hover-preview"
      :class="kind"
      :style="{ top: `${preview.top}px`, left: `${preview.left}px`, width: `${preview.width}px` }"
    />
  </Teleport>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1px;
  margin-bottom: 20px;
  background: var(--ct-line);
  border: 1px solid var(--ct-line);
  border-radius: 14px;
  overflow: hidden;
}
.kpi {
  padding: 16px 20px;
  background: var(--ct-panel);
}
.kpi-label {
  font-size: 12.5px;
  color: var(--ct-muted);
}
.kpi-value {
  margin-top: 2px;
  font-size: 26px;
  font-weight: 500;
}
.kpi-value.accent {
  color: var(--ct-accent-text);
}
.kpi-value.warn {
  color: var(--ct-warn);
}
.kpi-sub {
  font-size: 12px;
  color: var(--ct-muted);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.toolbar-right {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sort {
  min-width: 13rem;
}
@media (max-width: 600px) {
  .toolbar-right {
    width: 100%;
  }
  .toolbar-right > * {
    flex: 1;
  }
  .kpi {
    padding: 12px 14px;
  }
  .kpi-value {
    font-size: 22px;
  }
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.thumb {
  flex: none;
  width: 36px;
  height: 50px;
  object-fit: cover;
  border-radius: 3px;
  cursor: zoom-in;
}
.thumb.sealed {
  width: 50px;
  height: 50px;
  object-fit: contain;
  border-radius: 8px;
  background: var(--ct-chip);
}
.thumb.placeholder {
  background: var(--ct-chip);
  cursor: default;
}
.item-text {
  min-width: 0;
}
.item-name {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ct-ink);
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.item-name:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--ct-muted);
}
.group-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--ct-chip);
  color: var(--ct-ink);
  font-size: 12px;
}
.group-chip i {
  font-size: 10px;
}
.price {
  font-size: 15px;
  font-weight: 500;
}
.pill {
  margin-top: 3px;
}
.listing {
  max-width: 11rem;
  overflow: hidden;
  font-size: 12px;
  color: var(--ct-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trend {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px -6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  white-space: nowrap;
  cursor: pointer;
}
.trend:hover {
  background: var(--ct-chip);
}
.no-trend {
  font-size: 12.5px;
  color: var(--ct-muted);
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.actions a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  color: var(--ct-muted);
}
.actions a:hover {
  background: var(--ct-chip);
  color: var(--ct-ink);
}
.hover-preview {
  position: fixed;
  z-index: 1100;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.hover-preview.sealed {
  max-height: 300px;
  object-fit: contain;
  background: #fff;
}
</style>
