<script setup lang="ts">
import type { BulkResult, TrackedCard, TrackedCardRow } from '@ctzero/shared';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { BulkStoppedError, bulkCards } from '../bulk-cards';
import { useCatalog } from '../catalog';
import BulkBar from '../components/BulkBar.vue';
import BulkFiltersDialog from '../components/BulkFiltersDialog.vue';
import BulkGroupDialog from '../components/BulkGroupDialog.vue';
import BulkThresholdDialog from '../components/BulkThresholdDialog.vue';
import CardDialog from '../components/CardDialog.vue';
import ItemDrawer from '../components/ItemDrawer.vue';
import TrackedList from '../components/TrackedList.vue';
import { filterByGroup, parseGroupFilter } from '../group-summary';

/** 'all', 'none' (ungrouped) or a group id from `/groups/:id`. */
const props = defineProps<{ scope: string }>();

const toast = useToast();
const confirm = useConfirm();
const route = useRoute();
const router = useRouter();
const { cards, groups, groupNames, loading, loaded, reloadCardsAndGroups, reloadGroups } = useCatalog();

const groupFilter = computed(() =>
  parseGroupFilter(
    props.scope === 'all' ? undefined : props.scope,
    groups.value.map((g) => g.id),
  ),
);
const group = computed(() => (typeof groupFilter.value === 'number' ? groups.value.find((g) => g.id === groupFilter.value) ?? null : null));
const items = computed(() => filterByGroup(cards.value, groupFilter.value));

// A group that does not exist (deleted, maybe from another tab) sends back to all cards.
watch(
  [() => props.scope, () => loaded.groups, groups],
  () => {
    if (loaded.groups && props.scope !== 'all' && props.scope !== 'none' && groupFilter.value === 'all') void router.replace('/cards');
  },
  { immediate: true },
);

const eyebrow = computed(() => (group.value ? 'Group' : 'Cards'));
const title = computed(() => group.value?.name ?? (groupFilter.value === 'none' ? 'Ungrouped cards' : 'All cards'));
const emptyText = computed(() =>
  group.value
    ? 'No cards in this group yet. Add one, import a list into it, or move cards here from another view.'
    : groupFilter.value === 'none'
      ? 'Every card is in a group.'
      : 'No tracked cards yet. Add one with "Add card" or import a list.',
);

// ---------- detail panel (?item=) ----------
const openId = computed(() => {
  const raw = Number(route.query.item);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});
const openItem = computed(() => cards.value.find((c) => c.id === openId.value) ?? null);
watch([openId, () => loaded.cards, cards], () => {
  if (openId.value !== null && loaded.cards && !openItem.value) closeItem();
});

function openCard(id: number) {
  void router.replace({ query: { ...route.query, item: String(id) } });
}

function closeItem() {
  const { item: _item, ...rest } = route.query;
  void router.replace({ query: rest });
}

function onSaved(card: TrackedCard) {
  toast.add({ severity: 'success', summary: `${card.name} saved`, life: 3000 });
  void reloadCardsAndGroups();
}

function onDeleted(card: TrackedCardRow) {
  toast.add({ severity: 'success', summary: `Stopped tracking ${card.name}`, life: 3000 });
  closeItem();
  void reloadCardsAndGroups();
}

// ---------- add ----------
const addVisible = ref(false);

function onAdded(card: TrackedCard) {
  toast.add({ severity: 'success', summary: `${card.name} added`, life: 3000 });
  void reloadCardsAndGroups();
}

const importLink = computed(() => (group.value ? `/import?group=${group.value.id}` : '/import'));

// ---------- group menu ----------
const menu = ref<InstanceType<typeof Menu> | null>(null);
const renaming = ref(false);
const newName = ref('');
const renameInput = ref<{ $el: HTMLInputElement } | null>(null);
const menuItems = [
  { label: 'Rename', icon: 'pi pi-pencil', command: () => void startRename() },
  { label: 'Delete group', icon: 'pi pi-trash', command: () => confirmDeleteGroup() },
];

async function startRename() {
  if (!group.value) return;
  newName.value = group.value.name;
  renaming.value = true;
  await nextTick();
  renameInput.value?.$el.select();
}

async function rename() {
  const g = group.value;
  const name = newName.value.trim();
  // Enter submits and then the input blurs: rename only once.
  if (!renaming.value) return;
  renaming.value = false;
  if (!g || !name || name === g.name) return;
  try {
    await api.put(`/api/groups/${g.id}`, { name });
    await reloadGroups();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Group not renamed', detail: (e as Error).message, life: 5000 });
  }
}

function confirmDeleteGroup() {
  const g = group.value;
  if (!g) return;
  confirm.require({
    message: `Delete group "${g.name}"? Its ${g.cardCount} cards stay tracked, without a group.`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.del(`/api/groups/${g.id}`);
        await router.push('/cards');
        await reloadCardsAndGroups();
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Group not deleted', detail: (e as Error).message, life: 5000 });
      }
    },
  });
}

// ---------- bulk ----------
const selected = ref<TrackedCardRow[]>([]);
const bulkDialog = ref<'threshold' | 'group' | 'filters' | null>(null);
const bulkVisible = (kind: 'threshold' | 'group' | 'filters') =>
  computed({
    get: () => bulkDialog.value === kind,
    set: (open: boolean) => (bulkDialog.value = open ? kind : null),
  });
const thresholdVisible = bulkVisible('threshold');
const groupVisible = bulkVisible('group');
const filtersVisible = bulkVisible('filters');

// The selection only makes sense within the view being shown.
watch(() => props.scope, () => (selected.value = []));
// Re-derive it from fresh data: drops deleted cards and avoids stale snapshots.
watch(cards, (list) => {
  const ids = new Set(selected.value.map((c) => c.id));
  selected.value = list.filter((c) => ids.has(c.id));
});

/** `stoppedBy`: the bulk action stopped part way; the cards it did not reach stay selected. */
function onBulkDone(result: BulkResult, stoppedBy?: string, verb = 'updated') {
  const skipped = result.skipped.length > 0 ? `, ${result.skipped.length} skipped (${result.skipped[0]!.reason})` : '';
  if (stoppedBy) {
    toast.add({
      severity: 'warn',
      summary: `Stopped after ${result.updated.length} cards ${verb}${skipped}`,
      detail: `${stoppedBy}. The cards not processed are still selected.`,
      life: 8000,
    });
    const processed = new Set([...result.updated, ...result.skipped.map((s) => s.id)]);
    selected.value = selected.value.filter((c) => !processed.has(c.id));
  } else {
    toast.add({ severity: 'success', summary: `${result.updated.length} cards ${verb}${skipped}`, life: 4000 });
    selected.value = [];
  }
  void reloadCardsAndGroups();
}

function onFiltersDone() {
  selected.value = [];
  void reloadCardsAndGroups();
}

function confirmBulkDelete() {
  const ids = selected.value.map((c) => c.id);
  confirm.require({
    message: `Stop tracking ${ids.length} cards?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Stop tracking', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        onBulkDone(await bulkCards(ids, { type: 'delete' }), undefined, 'removed');
      } catch (e) {
        if (e instanceof BulkStoppedError) onBulkDone(e.partial, e.message, 'removed');
        else toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
      }
    },
  });
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div class="title-block">
        <div class="eyebrow">{{ eyebrow }}</div>
        <div class="title-row">
          <form v-if="renaming" @submit.prevent="rename">
            <InputText
              ref="renameInput"
              v-model="newName"
              aria-label="Group name"
              maxlength="80"
              class="rename"
              @blur="rename"
              @keyup.esc="renaming = false"
            />
          </form>
          <h1 v-else class="page-title">{{ title }}</h1>
          <template v-if="group && !renaming">
            <Button
              icon="pi pi-ellipsis-h"
              text
              rounded
              severity="secondary"
              aria-label="Group options"
              aria-haspopup="true"
              @click="menu?.toggle($event)"
            />
            <Menu ref="menu" :model="menuItems" popup />
          </template>
        </div>
      </div>
      <div class="page-actions">
        <RouterLink :to="importLink" custom v-slot="{ navigate }">
          <Button :label="group ? 'Import into group' : 'Import list'" icon="pi pi-upload" severity="secondary" outlined @click="navigate" />
        </RouterLink>
        <Button label="Add card" icon="pi pi-plus" @click="addVisible = true" />
      </div>
    </div>

    <TrackedList
      v-model:selection="selected"
      kind="card"
      :items="items"
      :loading="loading.cards"
      :group-names="groupFilter === 'all' ? groupNames : undefined"
      :open-id="openId"
      :empty-text="emptyText"
      @open="openCard"
    />

    <BulkBar v-if="selected.length > 0" :count="selected.length" @clear="selected = []">
      <button type="button" @click="bulkDialog = 'threshold'"><i class="pi pi-bullseye" aria-hidden="true"></i>Set target</button>
      <button type="button" @click="bulkDialog = 'filters'"><i class="pi pi-filter" aria-hidden="true"></i>Edit rules</button>
      <button type="button" @click="bulkDialog = 'group'"><i class="pi pi-folder" aria-hidden="true"></i>Move to group</button>
      <button type="button" class="danger" @click="confirmBulkDelete"><i class="pi pi-trash" aria-hidden="true"></i>Stop tracking</button>
    </BulkBar>
  </div>

  <ItemDrawer kind="card" :item="openItem" :groups="groups" @close="closeItem" @saved="onSaved($event as TrackedCard)" @deleted="onDeleted($event as TrackedCardRow)" />
  <CardDialog v-model:visible="addVisible" :groups="groups" :default-group-id="group?.id ?? null" @saved="onAdded" />
  <BulkThresholdDialog v-model:visible="thresholdVisible" kind="card" :items="selected" @done="onBulkDone" />
  <BulkGroupDialog v-model:visible="groupVisible" :cards="selected" :groups="groups" @done="onBulkDone" @groups-changed="reloadGroups" />
  <BulkFiltersDialog v-model:visible="filtersVisible" :cards="selected" @done="onFiltersDone" />
</template>

<style scoped>
.title-block {
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rename {
  margin-top: 4px;
  font-size: 22px;
  font-weight: 600;
  width: 22rem;
  max-width: 100%;
}
</style>
