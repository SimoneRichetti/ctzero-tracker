<script setup lang="ts">
import type { BulkResult, TrackedSealed, TrackedSealedRow } from '@ctzero/shared';
import Button from 'primevue/button';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { ref, watch } from 'vue';
import { useCatalog } from '../catalog';
import BulkBar from '../components/BulkBar.vue';
import BulkThresholdDialog from '../components/BulkThresholdDialog.vue';
import ItemDrawer from '../components/ItemDrawer.vue';
import SealedDialog from '../components/SealedDialog.vue';
import TrackedList from '../components/TrackedList.vue';
import { useOpenItem } from '../open-item';
import { BulkStoppedError } from '../bulk-cards';
import { bulkSealed } from '../sealed-bulk';

const toast = useToast();
const confirm = useConfirm();
const { sealed, groups, loading, loaded, reloadSealed } = useCatalog();

// ---------- detail panel (?item=) ----------
const { openId, openItem, open: openProduct, close: closeItem } = useOpenItem(sealed, () => loaded.sealed);

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

/** Products that were skipped, or not reached because the action stopped, stay selected for a retry. */
function onBulkDone(result: BulkResult, stoppedBy?: string, verb = 'updated') {
  const skipped = result.skipped.length > 0 ? `, ${result.skipped.length} skipped (${result.skipped[0]!.reason})` : '';
  toast.add({
    severity: stoppedBy || result.skipped.length > 0 ? 'warn' : 'success',
    summary: stoppedBy ? `Stopped after ${result.updated.length} products ${verb}${skipped}` : `${result.updated.length} products ${verb}${skipped}`,
    detail: stoppedBy ? `${stoppedBy}. The products not processed are still selected.` : undefined,
    life: stoppedBy ? 8000 : 5000,
  });
  const done = new Set(result.updated);
  selected.value = selected.value.filter((s) => !done.has(s.id));
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
    accept: async () => {
      try {
        onBulkDone(await bulkSealed(items, { type: 'delete' }), undefined, 'removed');
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
  <BulkThresholdDialog v-model:visible="thresholdVisible" kind="sealed" :items="selected" @done="onBulkDone" />
</template>
