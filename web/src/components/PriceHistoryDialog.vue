<script setup lang="ts">
import { formatEuro, type PriceHistoryDto } from '@ctzero/shared';
import type { Plugin } from 'chart.js';
import Chart from 'primevue/chart';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import SelectButton from 'primevue/selectbutton';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { formatDateTime } from '../card-status';
import { latestRequest } from '../latest-request';
import {
  axisBounds,
  buildSeries,
  filterRange,
  formatDay,
  hasChartData,
  summarize,
  type HistoryRange,
} from '../price-history';

const props = defineProps<{ kind: 'card' | 'sealed'; id: number | null; name: string }>();
const visible = defineModel<boolean>('visible', { required: true });

const RANGES: { label: string; value: HistoryRange }[] = [
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
  { label: 'All', value: 'all' },
];
const range = ref<HistoryRange>('90d');
const history = ref<PriceHistoryDto | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const requests = latestRequest();

watch(
  [visible, () => props.id],
  async ([open, id]) => {
    if (!open || id === null) {
      requests.cancel();
      return;
    }
    range.value = '90d';
    history.value = null;
    error.value = null;
    loading.value = true;
    const isLatest = requests.start();
    try {
      const data = await api.get<PriceHistoryDto>(`/api/${props.kind === 'card' ? 'cards' : 'sealed'}/${id}/history`);
      if (isLatest()) history.value = data;
    } catch (e) {
      if (isLatest()) error.value = (e as Error).message;
    } finally {
      if (isLatest()) loading.value = false;
    }
  },
  { immediate: true },
);

const points = computed(() => (history.value ? filterRange(history.value.points, range.value, new Date()) : []));
const series = computed(() => buildSeries(points.value));
const stats = computed(() => (history.value ? summarize(points.value, history.value.configVersion) : null));
const enoughData = computed(() => hasChartData(series.value));

const euroOrDash = (cents: number | null) => (cents === null ? '—' : formatEuro(cents));

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

interface MarkerOptions {
  thresholdCents: number;
  filterChanges: number[];
  thresholdColor: string;
  markerColor: string;
}

function strokeLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Draws the threshold line and the "Filters changed" markers; options come from `plugins.priceMarkers`. */
const markersPlugin: Plugin<'line', MarkerOptions> = {
  id: 'priceMarkers',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.font = '12px sans-serif';
    const y = scales.y!.getPixelForValue(opts.thresholdCents);
    ctx.strokeStyle = ctx.fillStyle = opts.thresholdColor;
    strokeLine(ctx, chartArea.left, y, chartArea.right, y);
    ctx.fillText('Threshold', chartArea.left + 4, y - 4);
    ctx.strokeStyle = ctx.fillStyle = opts.markerColor;
    for (const t of opts.filterChanges) {
      const x = scales.x!.getPixelForValue(t);
      strokeLine(ctx, x, chartArea.top, x, chartArea.bottom);
      ctx.fillText('Filters changed', x + 4, chartArea.top + 12);
    }
    ctx.restore();
  },
};

const bounds = computed(() => axisBounds(points.value, history.value?.thresholdCents ?? 0));

const chartData = computed(() => {
  const lineColor = cssVar('--p-primary-color', '#10b981');
  const mutedColor = cssVar('--p-text-muted-color', '#6b7280');
  return {
    datasets: [
      {
        label: 'Price',
        data: series.value.line,
        borderColor: lineColor,
        backgroundColor: lineColor,
        pointRadius: 2,
        spanGaps: false,
      },
      {
        label: 'No offers',
        data: series.value.noOffers.map((x) => ({ x, y: bounds.value.min })),
        showLine: false,
        pointStyle: 'crossRot',
        pointRadius: 7,
        pointHoverRadius: 8,
        // The crosses sit on the x axis: without this, the bottom half is clipped by the chart area.
        clip: false,
        borderColor: mutedColor,
        borderWidth: 2,
      },
    ],
  };
});

const chartOptions = computed(() => ({
  maintainAspectRatio: false,
  animation: false,
  scales: {
    x: { type: 'linear', ticks: { maxTicksLimit: 8, callback: (v: number | string) => formatDay(Number(v)) } },
    y: {
      min: bounds.value.min,
      max: bounds.value.max,
      ticks: { callback: (v: number | string) => formatEuro(Math.round(Number(v))) },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items: { parsed: { x: number } }[]) => formatDateTime(new Date(items[0]!.parsed.x).toISOString()),
        label: (item: { datasetIndex: number; parsed: { y: number } }) =>
          item.datasetIndex === 1 ? 'No offers' : formatEuro(item.parsed.y),
      },
    },
    priceMarkers: {
      thresholdCents: history.value?.thresholdCents ?? 0,
      filterChanges: series.value.filterChanges,
      thresholdColor: '#b91c1c',
      markerColor: cssVar('--p-text-muted-color', '#6b7280'),
    } satisfies MarkerOptions,
  },
}));
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="name"
    :style="{ width: '56rem' }"
    :breakpoints="{ '960px': '95vw' }"
  >
    <div class="history-toolbar">
      <SelectButton v-model="range" :options="RANGES" option-label="label" option-value="value" :allow-empty="false" />
      <div v-if="stats" class="history-stats">
        <span>Current <strong>{{ euroOrDash(stats.current) }}</strong></span>
        <span>Min <strong>{{ euroOrDash(stats.min) }}</strong></span>
        <span>Max <strong>{{ euroOrDash(stats.max) }}</strong></span>
      </div>
    </div>
    <div v-if="loading" class="history-state"><ProgressSpinner style="width: 2.5rem; height: 2.5rem" /></div>
    <Message v-else-if="error" severity="error">{{ error }}</Message>
    <template v-else-if="history">
      <p v-if="!enoughData" class="history-state muted">Not enough data yet</p>
      <Chart
        v-else
        type="line"
        :data="chartData"
        :options="chartOptions"
        :plugins="[markersPlugin]"
        style="height: 20rem"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.history-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}
.history-stats {
  display: flex;
  gap: 1.25rem;
}
.history-state {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}
</style>
