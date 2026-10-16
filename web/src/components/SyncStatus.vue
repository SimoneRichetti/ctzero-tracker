<script setup lang="ts">
import type { SyncRun } from '@ctzero/shared';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useCatalog } from '../catalog';
import { useSyncStatus } from '../sync-status';
import { formatAt, formatWhen } from '../time-format';

/** `compact`: one line for the mobile top bar. */
defineProps<{ compact?: boolean }>();

const toast = useToast();
const { status, running, progress, syncNow } = useSyncStatus();
const { health } = useCatalog();

const OUTCOME: Record<Exclude<SyncRun['status'], 'running'>, { text: string; tone: string }> = {
  ok: { text: 'all OK', tone: 'ok' },
  partial: { text: 'with errors', tone: 'warn' },
  failed: { text: 'failed', tone: 'danger' },
};

const last = computed(() => status.value?.last ?? null);
const lastTime = computed(() => last.value?.finishedAt ?? last.value?.startedAt ?? null);
const outcome = computed(() => (last.value && last.value.status !== 'running' ? OUTCOME[last.value.status] : null));
const lastProblem = computed(() => {
  const run = last.value;
  if (!run) return undefined;
  const parts = [run.error, run.reportError && `Report not sent: ${run.reportError}`].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : undefined;
});

const title = computed(() => {
  if (running.value) return 'Updating prices…';
  if (!lastTime.value) return 'No updates yet';
  return formatAt('Updated', lastTime.value, new Date());
});

const subtitle = computed(() => {
  const now = new Date();
  const next = status.value?.nextRunAt ? formatAt('next', status.value.nextRunAt, now) : null;
  if (running.value) {
    const r = running.value;
    return [`${r.cardsDone} / ${r.cardsTotal}`, lastTime.value && formatAt('last run', lastTime.value, now)].filter(Boolean).join(' · ');
  }
  const parts = [outcome.value ? outcome.value.text.replace(/^./, (c) => c.toUpperCase()) : null, next];
  if (last.value?.reportError) parts.splice(1, 0, 'report not sent');
  return parts.filter(Boolean).join(' · ') || 'Waiting for the first run';
});

const tone = computed(() => (running.value ? 'running' : (outcome.value?.tone ?? 'idle')));
const compactLabel = computed(() => {
  if (running.value) return `${running.value.cardsDone}/${running.value.cardsTotal}`;
  return lastTime.value ? formatWhen(lastTime.value, new Date()) : '—';
});

async function onUpdate() {
  try {
    await syncNow();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Update not started', detail: (e as Error).message, life: 5000 });
  }
}
</script>

<template>
  <div v-if="compact" class="compact" :class="tone">
    <span class="dot" aria-hidden="true"></span>
    <span class="compact-label mono" v-tooltip.bottom="title">{{ compactLabel }}</span>
    <Button
      icon="pi pi-refresh"
      text
      rounded
      size="small"
      :aria-label="running ? 'Update running' : 'Update now'"
      :disabled="running !== null"
      :loading="running !== null"
      @click="onUpdate"
    />
  </div>

  <section v-else class="sync" :class="tone" aria-label="Price updates">
    <div class="row">
      <div class="text">
        <div class="title" v-tooltip.right="lastProblem">
          <span class="dot" aria-hidden="true"></span>
          {{ title }}
        </div>
        <div class="sub">{{ subtitle }}</div>
      </div>
      <Button
        v-tooltip.right="running ? 'Update running' : 'Update now'"
        :aria-label="running ? 'Update running' : 'Update now'"
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        :disabled="running !== null"
        @click="onUpdate"
      />
    </div>
    <div v-if="running" class="bar" aria-hidden="true"><div class="bar-fill" :style="{ width: `${progress}%` }"></div></div>
    <RouterLink v-if="health && !health.cardtrader" to="/settings" class="notice danger">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      CardTrader token missing: prices cannot be checked
    </RouterLink>
    <RouterLink v-if="health && !health.telegram" to="/settings" class="notice warn">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      Telegram not configured: alerts are not sent
    </RouterLink>
  </section>
</template>

<style scoped>
.sync {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 10px 12px 14px;
  border: 1px solid var(--ct-line);
  border-radius: 12px;
  background: var(--ct-panel);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.text {
  flex: 1;
  min-width: 0;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
}
.sub {
  padding-left: 16px;
  font-size: 12px;
  color: var(--ct-muted);
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--ct-line-strong);
}
.ok .dot,
.running .dot {
  background: var(--ct-accent);
}
.running .dot {
  box-shadow: 0 0 0 4px var(--ct-accent-soft);
  animation: pulse 1.6s ease-in-out infinite;
}
.warn .dot {
  background: var(--ct-warn);
}
.danger .dot {
  background: var(--ct-danger);
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 1px var(--ct-accent-soft);
  }
}
@media (prefers-reduced-motion: reduce) {
  .running .dot {
    animation: none;
  }
}
.bar {
  height: 5px;
  margin-right: 4px;
  border-radius: 999px;
  background: var(--ct-chip);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--ct-accent);
  transition: width 0.4s ease;
}
.notice {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-right: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  text-decoration: none;
}
.notice i {
  margin-top: 2px;
  font-size: 12px;
}
.notice.warn {
  background: var(--ct-warn-soft);
  color: var(--ct-warn);
}
.notice.danger {
  background: var(--ct-danger-soft);
  color: var(--ct-danger);
}
.compact {
  display: flex;
  align-items: center;
  gap: 6px;
}
.compact-label {
  font-size: 12.5px;
}
</style>
