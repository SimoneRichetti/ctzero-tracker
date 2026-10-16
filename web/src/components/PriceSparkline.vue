<script setup lang="ts">
import type { PriceTrend } from '@ctzero/shared';
import { computed } from 'vue';
import { sparklinePoints } from '../price-history';

const props = defineProps<{ points: PriceTrend['sparkline'] }>();

const WIDTH = 72;
const HEIGHT = 24;
const polyline = computed(() => sparklinePoints(props.points, WIDTH, HEIGHT));
</script>

<template>
  <svg v-if="polyline" :width="WIDTH" :height="HEIGHT" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" aria-hidden="true" class="sparkline">
    <polyline :points="polyline" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
  </svg>
</template>

<style scoped>
.sparkline {
  display: block;
  flex: none;
}
</style>
