import type { SyncStatusDto } from '@ctzero/shared';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ApiError, api } from './api';

/** One poller for the whole app: the sidebar shows it, the pages reload when a run finishes. */
const status = ref<SyncStatusDto | null>(null);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSeenRunId: number | null | undefined;
let started = false;

const running = computed(() => status.value?.current ?? null);
const progress = computed(() => {
  const run = running.value;
  return run && run.cardsTotal > 0 ? Math.round((run.cardsDone / run.cardsTotal) * 100) : 0;
});

async function refresh() {
  try {
    status.value = await api.get<SyncStatusDto>('/api/sync/status');
    const lastId = status.value.last?.id ?? null;
    // A new run has finished (manual or scheduled).
    if (lastSeenRunId !== undefined && lastId !== lastSeenRunId) listeners.forEach((cb) => cb());
    lastSeenRunId = lastId;
  } catch {
    // retry on the next polling cycle
  }
  clearTimeout(timer);
  timer = setTimeout(refresh, running.value ? 2000 : 30000);
}

export function startSyncPolling() {
  if (started) return;
  started = true;
  void refresh();
}

/** Starts a run; a run already in progress (409) is not an error. */
async function syncNow(): Promise<void> {
  try {
    await api.post('/api/sync');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) {
      await refresh();
      throw e;
    }
  }
  await refresh();
}

export function useSyncStatus() {
  return { status, running, progress, syncNow };
}

/** Calls `cb` every time a run finishes while the calling component is mounted. */
export function onRunFinished(cb: () => void) {
  onMounted(() => listeners.add(cb));
  onUnmounted(() => listeners.delete(cb));
}
