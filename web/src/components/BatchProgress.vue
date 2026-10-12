<script setup lang="ts">
import ProgressBar from 'primevue/progressbar';
import { computed } from 'vue';

const props = defineProps<{
  done: number;
  total: number;
  /** Seconds left in a rate-limit pause, if one is running. */
  pausedSeconds?: number | null;
}>();

const percent = computed(() => (props.total === 0 ? 0 : Math.round((props.done / props.total) * 100)));
</script>

<template>
  <!-- ProgressBar puts its label inside the filled part, so it would move as the bar grows: overlay it instead. -->
  <div class="batch-progress">
    <ProgressBar :value="percent" :show-value="false" class="bar" />
    <span class="label">{{ done }}/{{ total }}</span>
  </div>
  <p v-if="pausedSeconds" class="paused">Scryfall asked us to slow down — resuming in {{ pausedSeconds }} s</p>
</template>

<style scoped>
.batch-progress {
  position: relative;
}
.bar {
  height: 1.5rem;
}
.paused {
  margin: 0.5rem 0 0;
  color: #b45309;
  font-size: 0.875rem;
}
.label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 600;
  pointer-events: none;
}
</style>
