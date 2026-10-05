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
  partial: { label: 'With errors', severity: 'warn' },
  failed: { label: 'Failed', severity: 'danger' },
  running: { label: 'Running', severity: 'info' },
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
    // A new run has finished (manual or scheduled): the page reloads the cards.
    if (lastSeenRunId !== undefined && lastId !== lastSeenRunId) emit('finished');
    lastSeenRunId = lastId;
  } catch {
    // retry on the next polling cycle
  }
  clearTimeout(timer);
  timer = setTimeout(refresh, running.value ? 2000 : 30000);
}

async function syncNow() {
  try {
    await api.post('/api/sync');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) {
      toast.add({ severity: 'error', summary: 'Update not started', detail: (e as Error).message, life: 5000 });
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
        Last update: <strong>{{ formatDateTime(status.last.finishedAt) }}</strong>
        <Tag
          :value="RUN_META[status.last.status].label"
          :severity="RUN_META[status.last.status].severity"
          class="run-tag"
        />
        <span v-if="status.last.error" class="muted"> — {{ status.last.error }}</span>
        <span v-if="status.last.reportError" class="muted"> — report not sent: {{ status.last.reportError }}</span>
      </div>
      <div v-else>No updates run yet</div>
      <div class="muted">Next update: {{ formatDateTime(status?.nextRunAt ?? null) }}</div>
    </div>
    <div class="sync-action">
      <div v-if="running" class="progress">
        <ProgressBar :value="progress" :show-value="false" />
        <small>{{ running.cardsDone }}/{{ running.cardsTotal }} cards</small>
      </div>
      <Button
        label="Update now"
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
