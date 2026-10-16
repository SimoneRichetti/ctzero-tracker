<script setup lang="ts">
import { computed } from 'vue';
import type { PricedItem } from '../card-status';
import { targetGap } from '../row-format';

const props = defineProps<{ item: Pick<PricedItem, 'lastPriceCents' | 'thresholdCents'> }>();
const gap = computed(() => targetGap(props.item));
</script>

<template>
  <div v-if="gap" class="gap" :class="{ under: gap.under }">
    <div class="track" aria-hidden="true"><div class="fill" :style="{ width: `${gap.fill}%` }"></div></div>
    <span class="text">{{ gap.text }}</span>
  </div>
</template>

<style scoped>
.gap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
}
.track {
  width: 64px;
  height: 5px;
  border-radius: 999px;
  background: var(--ct-chip);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ct-line-strong);
}
.text {
  font-size: 12px;
  color: var(--ct-muted);
  white-space: nowrap;
}
.under .fill {
  background: var(--ct-accent);
}
.under .text {
  color: var(--ct-accent-text);
}
</style>
