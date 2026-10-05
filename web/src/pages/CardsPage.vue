<script setup lang="ts">
import { CONDITION_ABBR, LANGUAGE_LABELS, formatEuro, type TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { STATUS_META, cardStatus, deltaPercent, formatDateTime, sortForDisplay } from '../card-status';
import CardDialog from '../components/CardDialog.vue';
import SyncHeader from '../components/SyncHeader.vue';

const toast = useToast();
const confirm = useConfirm();
const cards = ref<TrackedCard[]>([]);
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<TrackedCard | null>(null);
const rows = computed(() => sortForDisplay(cards.value));

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
  try {
    cards.value = await api.get<TrackedCard[]>('/api/cards');
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

function filterChips(card: TrackedCard): string[] {
  return [
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
    <Button label="Add card" icon="pi pi-plus" @click="openNew" />
  </div>

  <SyncHeader @finished="load" />

  <DataTable :value="rows" :loading="loading" data-key="id" striped-rows>
    <template #empty>No tracked cards. Add one with "Add card".</template>
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

  <CardDialog v-model:visible="dialogVisible" :card="editing" @saved="onSaved" />

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
.card-preview {
  position: fixed;
  z-index: 1100;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
</style>
