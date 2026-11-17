<script setup lang="ts">
import { computed } from 'vue';
import { STATUS_META, type CardStatus } from '../card-status';

/** By default "Watching" and "Pending" show nothing: only the statuses worth a glance get a pill. */
const props = defineProps<{ status: CardStatus; always?: boolean }>();
const meta = computed(() => STATUS_META[props.status]);
const visible = computed(() => props.always || meta.value.tone !== 'neutral');
</script>

<template>
  <span v-if="visible" class="pill" :class="meta.tone">{{ meta.label }}</span>
</template>

<style scoped>
.pill {
  display: inline-block;
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.accent {
  background: var(--ct-accent-soft);
  color: var(--ct-accent-text);
}
.warn {
  background: var(--ct-warn-soft);
  color: var(--ct-warn);
}
.danger {
  background: var(--ct-danger-soft);
  color: var(--ct-danger);
}
.neutral {
  background: var(--ct-chip);
  color: var(--ct-muted);
}
</style>
