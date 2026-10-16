<script setup lang="ts">
import type { BulkResult, TrackedSealed, TrackedSealedRow } from '@ctzero/shared';
import Button from 'primevue/button';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCatalog } from '../catalog';
import BulkBar from '../components/BulkBar.vue';
import BulkThresholdDialog from '../components/BulkThresholdDialog.vue';
import ItemDrawer from '../components/ItemDrawer.vue';
import SealedDialog from '../components/SealedDialog.vue';
import TrackedList from '../components/TrackedList.vue';
import { bulkSealed } from '../sealed-bulk';

const toast = useToast();
const confirm = useConfirm();
const route = useRoute();
const router = useRouter();
const { sealed, groups, loading, loaded, reloadSealed } = useCatalog();

// ---------- detail panel (?item=) ----------
const openId = computed(() => {
  const raw = Number(route.query.item);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});
const openItem = computed(() => sealed.value.find((s) => s.id === openId.value) ?? null);
watch([openId, () => loaded.sealed, sealed], () => {
  if (openId.value !== null && loaded.sealed && !openItem.value) closeItem();
});

function openProduct(id: number) {
  void router.replace({ query: { ...route.query, item: String(id) } });
}

function closeItem() {
  const { item: _item, ...rest } = route.query;
  void router.replace({ query: rest });
}

function onSaved(item: TrackedSealed) {
  toast.add({ severity: 'success', summary: `${item.name} saved`, life: 3000 });
  void reloadSealed();
}

function onDeleted(item: TrackedSealedRow) {
  toast.add({ severity: 'success', summary: `Stopped tracking ${item.name}`, life: 3000 });
  closeItem();
  void reloadSealed();
}

// ---------- add ----------
const addVisible = ref(false);

function onAdded(item: TrackedSealed) {
  toast.add({ severity: 'success', summary: `${item.name} added`, life: 3000 });
  void reloadSealed();
}

// ---------- bulk ----------
const selected = ref<TrackedSealedRow[]>([]);
const thresholdVisible = ref(false);

watch(sealed, (list) => {
  const ids = new Set(selected.value.map((s) => s.id));
  selected.value = list.filter((s) => ids.has(s.id));
});

function onBulkDone(result: BulkResult, verb = 'updated') {
  const skipped = result.skipped.length > 0 ? `, ${result.skipped.length} skipped (${result.skipped[0]!.reason})` : '';
  toast.add({
    severity: result.skipped.length > 0 ? 'warn' : 'success',
    summary: `${result.updated.length} products ${verb}${skipped}`,
    life: 5000,
  });
  // Products that were skipped stay selected, so the action can be retried on them.
  const skippedIds = new Set(result.skipped.map((s) => s.id));
  selected.value = selected.value.filter((s) => skippedIds.has(s.id));
  void reloadSealed();
}

function confirmBulkDelete() {
  const items = [...selected.value];
  confirm.require({
    message: `Stop tracking ${items.length} products?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Stop tracking', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => onBulkDone(await bulkSealed(items, { type: 'delete' }), 'removed'),
  });
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="eyebrow">Sealed</div>
        <h1 class="page-title">Sealed products</h1>
      </div>
      <div class="page-actions">
        <Button label="Add product" icon="pi pi-plus" @click="addVisible = true" />
      </div>
    </div>

    <TrackedList
      v-model:selection="selected"
      kind="sealed"
      :items="sealed"
      :loading="loading.sealed"
      :open-id="openId"
      empty-text='No tracked sealed products yet. Add one with "Add product".'
      @open="openProduct"
    />

    <BulkBar v-if="selected.length > 0" :count="selected.length" @clear="selected = []">
      <button type="button" @click="thresholdVisible = true"><i class="pi pi-bullseye" aria-hidden="true"></i>Set target</button>
      <button type="button" class="danger" @click="confirmBulkDelete"><i class="pi pi-trash" aria-hidden="true"></i>Stop tracking</button>
    </BulkBar>
  </div>

  <ItemDrawer kind="sealed" :item="openItem" :groups="groups" @close="closeItem" @saved="onSaved($event as TrackedSealed)" @deleted="onDeleted($event as TrackedSealedRow)" />
  <SealedDialog v-model:visible="addVisible" @saved="onAdded" />
  <BulkThresholdDialog v-model:visible="thresholdVisible" kind="sealed" :items="selected" @done="(r) => onBulkDone(r)" />
</template>
