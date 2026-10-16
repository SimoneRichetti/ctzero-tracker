<script setup lang="ts">
import type { PriceTrend } from '@ctzero/shared';
import { computed } from 'vue';
import { sparklinePoints } from '../price-history';

const props = defineProps<{ points: PriceTrend['sparkline'] }>();
defineEmits<{ click: [] }>();

const WIDTH = 80;
const HEIGHT = 24;
const polyline = computed(() => sparklinePoints(props.points, WIDTH, HEIGHT));
</script>

<template>
  <button v-if="polyline" type="button" class="sparkline" aria-label="Price history" @click="$emit('click')">
    <svg :width="WIDTH" :height="HEIGHT" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" aria-hidden="true">
      <polyline
        :points="polyline"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  </button>
  <span v-else class="muted">—</span>
</template>

<style scoped>
.sparkline {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--p-primary-color);
  cursor: pointer;
}
</style>
