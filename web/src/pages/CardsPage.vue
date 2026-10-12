<script setup lang="ts">
import { CONDITION_ABBR, LANGUAGE_LABELS, formatEuro, type BulkResult, type CardGroup, type TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { bulkCards } from '../bulk-cards';
import { STATUS_META, cardStatus, deltaPercent, formatDateTime, sortForDisplay } from '../card-status';
import BulkFiltersDialog from '../components/BulkFiltersDialog.vue';
import BulkGroupDialog from '../components/BulkGroupDialog.vue';
import BulkThresholdDialog from '../components/BulkThresholdDialog.vue';
import CardDialog from '../components/CardDialog.vue';
import GroupsDialog from '../components/GroupsDialog.vue';
import SyncHeader from '../components/SyncHeader.vue';
import { filterByGroup, groupFilterQuery, parseGroupFilter, summarize, type GroupFilter } from '../group-summary';

const toast = useToast();
const confirm = useConfirm();
const cards = ref<TrackedCard[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<TrackedCard | null>(null);
const route = useRoute();
const router = useRouter();
const groups = ref<CardGroup[]>([]);
const groupsDialogVisible = ref(false);

const groupFilter = computed(() => parseGroupFilter(route.query.group, groups.value.map((g) => g.id)));
const groupOptions = computed(() => [
  { label: 'All cards', value: 'all' as GroupFilter },
  { label: 'No group', value: 'none' as GroupFilter },
  ...groups.value.map((g) => ({ label: `${g.name} (${g.cardCount})`, value: g.id as GroupFilter })),
]);
const groupNames = computed(() => new Map(groups.value.map((g) => [g.id, g.name])));
const rows = computed(() => sortForDisplay(filterByGroup(cards.value, groupFilter.value)));
const summary = computed(() => summarize(rows.value));
const defaultGroupId = computed(() => (typeof groupFilter.value === 'number' ? groupFilter.value : null));

function setGroupFilter(value: GroupFilter) {
  void router.replace({ query: { ...route.query, group: groupFilterQuery(value) } });
}

const PREVIEW_WIDTH = 244;
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH * (680 / 488));
const preview = ref<{ src: string; alt: string; top: number; left: number } | null>(null);

// Stored images are Scryfall's "small" size (146px): swap to "normal" (488px) so the enlarged preview stays sharp.
function largeImage(url: string): string {
  return url.replace('/small/', '/normal/');
}

function showPreview(event: MouseEvent, card: TrackedCard) {
  if (!card.imageUrl) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const margin = 8;
  const top = Math.min(
    Math.max(margin, rect.top + rect.height / 2 - PREVIEW_HEIGHT / 2),
    window.innerHeight - PREVIEW_HEIGHT - margin,
  );
  preview.value = { src: largeImage(card.imageUrl), alt: card.name, top, left: rect.right + 12 };
}

function hidePreview() {
  preview.value = null;
}

async function load() {
  loading.value = true;
  // Loaded on their own: a failure on groups must not leave the card list empty.
  const groupsLoaded = loadGroups();
  try {
    cards.value = await api.get<TrackedCard[]>('/api/cards');
    // Re-derive the selection from fresh data: drops deleted cards and avoids stale snapshots.
    selected.value = cards.value.filter((c) => selected.value.some((s) => s.id === c.id));
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  } finally {
    loading.value = false;
  }
  await groupsLoaded;
}

function openNew() {
  editing.value = null;
  dialogVisible.value = true;
}

function openEdit(card: TrackedCard) {
  editing.value = card;
  dialogVisible.value = true;
}

function onSaved(card: TrackedCard) {
  toast.add({ severity: 'success', summary: `${card.name} saved`, life: 3000 });
  load();
}

function confirmDelete(card: TrackedCard) {
  confirm.require({
    message: `Stop tracking "${card.name}"?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.del(`/api/cards/${card.id}`);
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
      }
      await load();
    },
  });
}

const selected = ref<TrackedCard[]>([]);
const bulkDialog = ref<'threshold' | 'group' | 'filters' | null>(null);
const bulkVisible = (kind: 'threshold' | 'group' | 'filters') =>
  computed({
    get: () => bulkDialog.value === kind,
    set: (open: boolean) => (bulkDialog.value = open ? kind : null),
  });
const thresholdVisible = bulkVisible('threshold');
const groupVisible = bulkVisible('group');
const filtersVisible = bulkVisible('filters');

// The selection only makes sense within the group being shown.
watch(groupFilter, () => (selected.value = []));

async function loadGroups() {
  try {
    groups.value = await api.get<CardGroup[]>('/api/groups');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  }
}

function onBulkDone(result: BulkResult, verb = 'updated') {
  const skipped = result.skipped.length > 0 ? `, ${result.skipped.length} skipped (${result.skipped[0]!.reason})` : '';
  toast.add({ severity: 'success', summary: `${result.updated.length} cards ${verb}${skipped}`, life: 4000 });
  selected.value = [];
  void load();
}

function onFiltersDone() {
  selected.value = [];
  void load();
}

function confirmBulkDelete() {
  const ids = selected.value.map((c) => c.id);
  confirm.require({
    message: `Stop tracking ${ids.length} cards?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        onBulkDone(await bulkCards(ids, { type: 'delete' }), 'removed');
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
        // Earlier chunks may have gone through.
        void load();
      }
    },
  });
}

function filterChips(card: TrackedCard): string[] {
  const group = groupFilter.value === 'all' && card.groupId !== null ? groupNames.value.get(card.groupId) : undefined;
  return [
    ...(group ? [`📁 ${group}`] : []),
    card.expansionNames.length > 0 ? card.expansionNames.join(', ') : 'Any expansion',
    card.languages.length > 0 ? card.languages.map((l) => LANGUAGE_LABELS[l]).join(', ') : 'Any language',
    `≥ ${CONDITION_ABBR[card.minCondition]}`,
    card.foil ? 'Foil' : 'Non-foil',
  ];
}

function formatDelta(card: TrackedCard): string {
  const d = deltaPercent(card);
  if (d === null) return '—';
  return `${d > 0 ? '+' : ''}${d.toLocaleString('en-US')}%`;
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Tracked cards</h1>
    <div class="header-actions">
      <Button label="Import list" icon="pi pi-upload" severity="secondary" outlined @click="router.push('/import')" />
      <Button label="Add card" icon="pi pi-plus" @click="openNew" />
    </div>
  </div>

  <SyncHeader @finished="load" />

  <div class="group-toolbar">
    <Select
      :model-value="groupFilter"
      :options="groupOptions"
      option-label="label"
      option-value="value"
      aria-label="Group"
      class="group-select"
      @update:model-value="setGroupFilter"
    />
    <Button label="Manage groups" icon="pi pi-folder" severity="secondary" text @click="groupsDialogVisible = true" />
  </div>

  <div class="summary">
    <span><strong>{{ summary.count }}</strong> cards</span>
    <span><strong>{{ summary.below }}</strong> below threshold</span>
    <span v-if="summary.problems > 0"><strong>{{ summary.problems }}</strong> no offers / error</span>
    <span>
      Current total <strong>{{ formatEuro(summary.totalPriceCents) }}</strong>
      <span v-if="summary.missingPrice > 0" class="muted">({{ summary.missingPrice }} without price)</span>
    </span>
    <span>Threshold total <strong>{{ formatEuro(summary.totalThresholdCents) }}</strong></span>
  </div>

  <div v-if="selected.length > 0" class="bulk-bar">
    <strong>{{ selected.length }} selected</strong>
    <Button label="Threshold…" icon="pi pi-euro" size="small" outlined @click="bulkDialog = 'threshold'" />
    <Button label="Filters…" icon="pi pi-filter" size="small" outlined @click="bulkDialog = 'filters'" />
    <Button label="Move to group…" icon="pi pi-folder" size="small" outlined @click="bulkDialog = 'group'" />
    <Button label="Delete" icon="pi pi-trash" size="small" severity="danger" outlined @click="confirmBulkDelete" />
    <Button label="Clear selection" size="small" text @click="selected = []" />
  </div>

  <DataTable v-model:selection="selected" :value="rows" :loading="loading" data-key="id" striped-rows>
    <template #empty>
      <template v-if="groupFilter !== 'all'">No cards in this group.</template>
      <template v-else>No tracked cards. Add one with "Add card".</template>
    </template>
    <Column selection-mode="multiple" header-style="width: 3rem" />
    <Column header="" style="width: 64px">
      <template #body="{ data }">
        <img
          v-if="data.imageUrl"
          :src="data.imageUrl"
          :alt="data.name"
          class="row-thumb"
          @mouseenter="showPreview($event, data)"
          @mouseleave="hidePreview"
        />
      </template>
    </Column>
    <Column field="name" header="Card">
      <template #body="{ data }">
        <strong>{{ data.name }}</strong>
        <div class="chips">
          <Tag v-for="chip in filterChips(data)" :key="chip" :value="chip" severity="secondary" />
        </div>
      </template>
    </Column>
    <Column header="CT Zero price">
      <template #body="{ data }">
        <template v-if="data.lastPriceCents !== null">
          <strong>{{ formatEuro(data.lastPriceCents) }}</strong>
          <div v-if="data.lastListing" class="muted">
            {{ data.lastListing.expansionName }} · {{ data.lastListing.condition }} ·
            {{ data.lastListing.language.toUpperCase() }}
          </div>
        </template>
        <span v-else>—</span>
      </template>
    </Column>
    <Column header="Threshold">
      <template #body="{ data }">{{ formatEuro(data.thresholdCents) }}</template>
    </Column>
    <Column header="Δ threshold">
      <template #body="{ data }">
        <span :class="(deltaPercent(data) ?? 0) <= 0 ? 'price-down' : 'price-up'">{{ formatDelta(data) }}</span>
      </template>
    </Column>
    <Column header="Status">
      <template #body="{ data }">
        <Tag
          v-tooltip.top="data.lastError ?? undefined"
          :value="STATUS_META[cardStatus(data)].label"
          :severity="STATUS_META[cardStatus(data)].severity"
        />
      </template>
    </Column>
    <Column header="Updated">
      <template #body="{ data }">{{ formatDateTime(data.lastSyncedAt) }}</template>
    </Column>
    <Column header="" style="width: 9rem">
      <template #body="{ data }">
        <div class="row-actions">
          <a v-if="data.lastListing" :href="data.lastListing.url" target="_blank" rel="noopener">
            <Button v-tooltip.top="'Open on CardTrader'" icon="pi pi-external-link" text rounded />
          </a>
          <Button v-tooltip.top="'Edit'" icon="pi pi-pencil" text rounded @click="openEdit(data)" />
          <Button
            v-tooltip.top="'Delete'"
            icon="pi pi-trash"
            text
            rounded
            severity="danger"
            @click="confirmDelete(data)"
          />
        </div>
      </template>
    </Column>
  </DataTable>

  <CardDialog
    v-model:visible="dialogVisible"
    :card="editing"
    :groups="groups"
    :default-group-id="defaultGroupId"
    @saved="onSaved"
  />
  <GroupsDialog v-model:visible="groupsDialogVisible" :groups="groups" @changed="load" />

  <BulkThresholdDialog v-model:visible="thresholdVisible" :cards="selected" @done="onBulkDone" />
  <BulkGroupDialog
    v-model:visible="groupVisible"
    :cards="selected"
    :groups="groups"
    @done="onBulkDone"
    @groups-changed="loadGroups"
  />
  <BulkFiltersDialog v-model:visible="filtersVisible" :cards="selected" @done="onFiltersDone" />

  <Teleport to="body">
    <img
      v-if="preview"
      :src="preview.src"
      :alt="preview.alt"
      class="card-preview"
      :style="{ top: `${preview.top}px`, left: `${preview.left}px`, width: `${PREVIEW_WIDTH}px` }"
    />
  </Teleport>
</template>

<style scoped>
.bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 8px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header-actions {
  display: flex;
  gap: 0.5rem;
}
.group-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.group-select {
  min-width: 16rem;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  margin-bottom: 1rem;
}
.row-actions {
  display: flex;
  align-items: center;
}
.row-thumb {
  cursor: zoom-in;
}
.card-preview {
  position: fixed;
  z-index: 1100;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
</style>
