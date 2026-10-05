<script setup lang="ts">
import type { SyncRun, SyncStatusDto } from '@ctzero/shared';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ApiError, api } from '../api';
import { formatDateTime } from '../card-status';

const emit = defineEmits<{ finished: [] }>();
const toast = useToast();
const status = ref<SyncStatusDto | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSeenRunId: number | null | undefined;

const RUN_META: Record<SyncRun['status'], { label: string; severity: 'success' | 'warn' | 'danger' | 'info' }> = {
  ok: { label: 'OK', severity: 'success' },
  partial: { label: 'Con errori', severity: 'warn' },
  failed: { label: 'Fallito', severity: 'danger' },
  running: { label: 'In corso', severity: 'info' },
};

const running = computed(() => status.value?.current ?? null);
const progress = computed(() => {
  const run = running.value;
  return run && run.cardsTotal > 0 ? Math.round((run.cardsDone / run.cardsTotal) * 100) : 0;
});

async function refresh() {
  try {
    status.value = await api.get<SyncStatusDto>('/api/sync/status');
    const lastId = status.value.last?.id ?? null;
    // Un nuovo giro concluso (manuale o pianificato): la pagina ricarica le carte.
    if (lastSeenRunId !== undefined && lastId !== lastSeenRunId) emit('finished');
    lastSeenRunId = lastId;
  } catch {
    // si riprova al prossimo giro di polling
  }
  clearTimeout(timer);
  timer = setTimeout(refresh, running.value ? 2000 : 30000);
}

async function syncNow() {
  try {
    await api.post('/api/sync');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) {
      toast.add({ severity: 'error', summary: 'Aggiornamento non avviato', detail: (e as Error).message, life: 5000 });
    }
  }
  await refresh();
}

onMounted(refresh);
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div class="sync-header">
    <div class="sync-info">
      <div v-if="status?.last">
        Ultimo aggiornamento: <strong>{{ formatDateTime(status.last.finishedAt) }}</strong>
        <Tag
          :value="RUN_META[status.last.status].label"
          :severity="RUN_META[status.last.status].severity"
          class="run-tag"
        />
        <span v-if="status.last.error" class="muted"> — {{ status.last.error }}</span>
        <span v-if="status.last.reportError" class="muted"> — report non inviato: {{ status.last.reportError }}</span>
      </div>
      <div v-else>Nessun aggiornamento eseguito finora</div>
      <div class="muted">Prossimo aggiornamento: {{ formatDateTime(status?.nextRunAt ?? null) }}</div>
    </div>
    <div class="sync-action">
      <div v-if="running" class="progress">
        <ProgressBar :value="progress" :show-value="false" />
        <small>{{ running.cardsDone }}/{{ running.cardsTotal }} carte</small>
      </div>
      <Button
        label="Aggiorna ora"
        icon="pi pi-refresh"
        :loading="running !== null"
        :disabled="running !== null"
        @click="syncNow"
      />
    </div>
  </div>
</template>

<style scoped>
.sync-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}
.run-tag {
  margin-left: 0.5rem;
}
.sync-action {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.progress {
  width: 12rem;
  text-align: center;
}
</style>
