<script setup lang="ts" generic="T extends string">
defineProps<{ options: { value: T; label: string; count?: number }[]; label: string; size?: 'small' }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="seg" :class="{ small: size === 'small' }" role="group" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      :aria-pressed="model === o.value"
      :class="{ active: model === o.value }"
      @click="model = o.value"
    >
      {{ o.label }}<span v-if="o.count !== undefined" class="count mono">{{ o.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border-radius: 11px;
  background: var(--ct-chip);
}
button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ct-muted);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
button:hover {
  color: var(--ct-ink);
}
button.active {
  background: var(--ct-panel);
  color: var(--ct-ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
button:focus-visible {
  outline: 2px solid var(--ct-accent);
  outline-offset: 1px;
}
.small button {
  height: 28px;
  padding: 0 10px;
  font-size: 12.5px;
}
.count {
  font-size: 12px;
  opacity: 0.75;
}
</style>
