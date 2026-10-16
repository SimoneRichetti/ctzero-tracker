<script setup lang="ts">
import { formatEuro, type PriceHistoryDto } from '@ctzero/shared';
import type { Plugin } from 'chart.js';
import Chart from 'primevue/chart';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { formatDateTime } from '../card-status';
import { latestRequest } from '../latest-request';
import { axisBounds, buildSeries, filterRange, formatDay, hasChartData, summarize, type HistoryRange } from '../price-history';
import { themeColor } from '../theme';
import SegmentedControl from './SegmentedControl.vue';

/** `refreshKey` changes when the item is saved or re-priced: the history is fetched again. */
const props = defineProps<{ kind: 'card' | 'sealed'; id: number; refreshKey: string }>();

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
  () => props.id,
  () => {
    range.value = '90d';
    history.value = null;
  },
);

watch(
  [() => props.id, () => props.refreshKey],
  async ([id]) => {
    error.value = null;
    loading.value = history.value === null;
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
const bounds = computed(() => axisBounds(points.value, history.value?.thresholdCents ?? 0));

const euroOrDash = (cents: number | null) => (cents === null ? '—' : formatEuro(cents));

interface MarkerOptions {
  thresholdCents: number;
  filterChanges: number[];
  targetColor: string;
  zoneColor: string;
  markerColor: string;
  font: string;
}

function strokeLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Shades the zone under the target, then draws the target line and the "Rules changed" markers. */
const markersPlugin: Plugin<'line', MarkerOptions> = {
  id: 'priceMarkers',
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    const y = Math.max(chartArea.top, Math.min(chartArea.bottom, scales.y!.getPixelForValue(opts.thresholdCents)));
    ctx.save();
    ctx.fillStyle = opts.zoneColor;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(chartArea.left, y, chartArea.right - chartArea.left, chartArea.bottom - y);
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.font = `600 11px ${opts.font}`;
    const y = scales.y!.getPixelForValue(opts.thresholdCents);
    ctx.strokeStyle = ctx.fillStyle = opts.targetColor;
    strokeLine(ctx, chartArea.left, y, chartArea.right, y);
    ctx.textAlign = 'right';
    ctx.fillText(`Target ${formatEuro(opts.thresholdCents)}`, chartArea.right - 4, y - 6);
    ctx.textAlign = 'left';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.font = `11px ${opts.font}`;
    ctx.strokeStyle = ctx.fillStyle = opts.markerColor;
    for (const t of opts.filterChanges) {
      const x = scales.x!.getPixelForValue(t);
      strokeLine(ctx, x, chartArea.top, x, chartArea.bottom);
      ctx.fillText('Rules changed', x + 5, chartArea.top + 12);
    }
    ctx.restore();
  },
};

const chartData = computed(() => {
  const ink = themeColor('--ct-ink', '#17191e');
  const warn = themeColor('--ct-warn', '#9a5300');
  return {
    datasets: [
      {
        label: 'Price',
        data: series.value.line,
        borderColor: ink,
        backgroundColor: ink,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 8,
        tension: 0,
        spanGaps: false,
      },
      {
        label: 'No offers',
        data: series.value.noOffers.map((x) => ({ x, y: bounds.value.min })),
        showLine: false,
        pointStyle: 'crossRot',
        pointRadius: 6,
        pointHoverRadius: 7,
        // The crosses sit on the x axis: without this, the bottom half is clipped by the chart area.
        clip: false,
        borderColor: warn,
        borderWidth: 2,
      },
    ],
  };
});

const chartOptions = computed(() => {
  const muted = themeColor('--ct-muted', '#5a5f69');
  const line = themeColor('--ct-line', '#e3e0d8');
  const mono = themeColor('--ct-mono', 'monospace');
  const sans = themeColor('--ct-font', 'sans-serif');
  const tick = { color: muted, font: { family: mono, size: 11 } };
  return {
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: {
        type: 'linear',
        grid: { display: false },
        border: { color: line },
        ticks: { ...tick, maxTicksLimit: 6, callback: (v: number | string) => formatDay(Number(v)) },
      },
      y: {
        min: bounds.value.min,
        max: bounds.value.max,
        grid: { color: line },
        border: { display: false },
        ticks: { ...tick, maxTicksLimit: 5, callback: (v: number | string) => formatEuro(Math.round(Number(v))) },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: { parsed: { x: number } }[]) => formatDateTime(new Date(items[0]!.parsed.x).toISOString()),
          label: (item: { datasetIndex: number; parsed: { y: number } }) => (item.datasetIndex === 1 ? 'No offers' : formatEuro(item.parsed.y)),
        },
      },
      priceMarkers: {
        thresholdCents: history.value?.thresholdCents ?? 0,
        filterChanges: series.value.filterChanges,
        targetColor: themeColor('--ct-accent-text', '#07624e'),
        zoneColor: themeColor('--ct-accent-soft', '#ddefe8'),
        markerColor: muted,
        font: sans,
      } satisfies MarkerOptions,
    },
  };
});
</script>

<template>
  <section class="history" aria-label="Price history">
    <div class="head">
      <div class="title">Price history</div>
      <SegmentedControl v-model="range" :options="RANGES" label="Range" size="small" />
    </div>
    <div v-if="loading" class="state"><ProgressSpinner style="width: 2.5rem; height: 2.5rem" /></div>
    <Message v-else-if="error" severity="error">{{ error }}</Message>
    <template v-else-if="history">
      <p v-if="!enoughData" class="state">Not enough data yet</p>
      <Chart v-else type="line" :data="chartData" :options="chartOptions" :plugins="[markersPlugin]" class="chart" />
      <div v-if="stats" class="stats">
        <span>Low <strong class="mono">{{ euroOrDash(stats.min) }}</strong></span>
        <span>High <strong class="mono">{{ euroOrDash(stats.max) }}</strong></span>
        <span v-if="series.noOffers.length > 0" class="legend"><span class="cross" aria-hidden="true">×</span>no offers</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.title {
  font-weight: 600;
}
.chart {
  height: 13.5rem;
}
.state {
  display: flex;
  justify-content: center;
  margin: 0;
  padding: 3rem 0;
  color: var(--ct-muted);
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--ct-muted);
}
.stats strong {
  font-weight: 500;
  color: var(--ct-ink);
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.cross {
  color: var(--ct-warn);
  font-weight: 700;
}
</style>
