<script setup lang="ts">
import { LANGUAGE_LABELS, formatEuro, type TrackedSealed } from '@ctzero/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { STATUS_META, cardStatus, deltaPercent, formatDateTime, sortForDisplay } from '../card-status';
import SealedDialog from '../components/SealedDialog.vue';
import SyncHeader from '../components/SyncHeader.vue';

const toast = useToast();
const confirm = useConfirm();
const items = ref<TrackedSealed[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<TrackedSealed | null>(null);
const rows = computed(() => sortForDisplay(items.value));

const PREVIEW_SIZE = 300;
const preview = ref<{ src: string; alt: string; top: number; left: number } | null>(null);

// Stored images are CardTrader "preview_" thumbnails: "show_" is the larger version.
function largeImage(url: string): string {
  return url.replace('/preview_', '/show_');
}

function showPreview(event: MouseEvent, item: TrackedSealed) {
  if (!item.imageUrl) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const margin = 8;
  const top = Math.min(
    Math.max(margin, rect.top + rect.height / 2 - PREVIEW_SIZE / 2),
    window.innerHeight - PREVIEW_SIZE - margin,
  );
  preview.value = { src: largeImage(item.imageUrl), alt: item.name, top, left: rect.right + 12 };
}

function hidePreview() {
  preview.value = null;
}

async function load() {
  loading.value = true;
  try {
    items.value = await api.get<TrackedSealed[]>('/api/sealed');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editing.value = null;
  dialogVisible.value = true;
}

function openEdit(item: TrackedSealed) {
  editing.value = item;
  dialogVisible.value = true;
}

function onSaved(item: TrackedSealed) {
  toast.add({ severity: 'success', summary: `${item.name} saved`, life: 3000 });
  load();
}

function confirmDelete(item: TrackedSealed) {
  confirm.require({
    message: `Stop tracking "${item.name}"?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.del(`/api/sealed/${item.id}`);
      } catch (e) {
        toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
      }
      await load();
    },
  });
}

function filterChips(item: TrackedSealed): string[] {
  return [
    item.categoryName,
    item.languages.length > 0 ? item.languages.map((l) => LANGUAGE_LABELS[l]).join(', ') : 'Any language',
  ];
}

function formatDelta(item: TrackedSealed): string {
  const d = deltaPercent(item);
  if (d === null) return '—';
  return `${d > 0 ? '+' : ''}${d.toLocaleString('en-US')}%`;
}

onMounted(load);
</script>

<template>
  <div class="page-header">
    <h1>Tracked sealed products</h1>
    <Button label="Add sealed product" icon="pi pi-plus" @click="openNew" />
  </div>

  <SyncHeader @finished="load" />

  <DataTable :value="rows" :loading="loading" data-key="id" striped-rows>
    <template #empty>No tracked sealed products. Add one with "Add sealed product".</template>
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
    <Column field="name" header="Product">
      <template #body="{ data }">
        <strong>{{ data.name }}</strong>
        <div class="muted">{{ data.expansionName }}</div>
        <div class="chips">
          <Tag v-for="chip in filterChips(data)" :key="chip" :value="chip" severity="secondary" />
        </div>
      </template>
    </Column>
    <Column header="CT Zero price">
      <template #body="{ data }">
        <template v-if="data.lastPriceCents !== null">
          <strong>{{ formatEuro(data.lastPriceCents) }}</strong>
          <div v-if="data.lastListing?.language" class="muted">{{ data.lastListing.language.toUpperCase() }}</div>
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
          <a :href="`https://www.cardtrader.com/cards/${data.blueprintId}`" target="_blank" rel="noopener">
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

  <SealedDialog v-model:visible="dialogVisible" :item="editing" @saved="onSaved" />

  <Teleport to="body">
    <img
      v-if="preview"
      :src="preview.src"
      :alt="preview.alt"
      class="sealed-preview"
      :style="{ top: `${preview.top}px`, left: `${preview.left}px`, width: `${PREVIEW_SIZE}px` }"
    />
  </Teleport>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.row-actions {
  display: flex;
  align-items: center;
}
.row-thumb {
  cursor: zoom-in;
}
.sealed-preview {
  position: fixed;
  z-index: 1100;
  max-height: 300px;
  object-fit: contain;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
</style>
