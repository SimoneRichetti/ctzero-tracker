<script setup lang="ts">
defineProps<{ count: number }>();
defineEmits<{ clear: [] }>();
</script>

<template>
  <!-- Sticks to the bottom of the scrolling content while there is a selection. -->
  <div class="bulk-wrap">
    <div class="bulk" role="toolbar" aria-label="Selected items">
      <span class="count">{{ count }} selected</span>
      <slot />
      <button type="button" class="clear" aria-label="Clear selection" v-tooltip.top="'Clear selection'" @click="$emit('clear')">
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.bulk-wrap {
  position: sticky;
  bottom: 20px;
  z-index: 5;
  display: flex;
  justify-content: center;
  margin-top: 20px;
  pointer-events: none;
}
.bulk {
  pointer-events: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 16px);
  padding: 6px 6px 6px 18px;
  border-radius: 14px;
  background: var(--ct-bar-bg);
  color: var(--ct-bar-ink);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
}
.count {
  margin-right: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.bulk :slotted(button) {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.bulk :slotted(button:hover),
.clear:hover {
  background: var(--ct-bar-soft);
}
.bulk :slotted(button.danger) {
  color: var(--ct-bar-danger);
}
.bulk :slotted(button:focus-visible),
.clear:focus-visible {
  outline: 2px solid var(--ct-accent);
}
.clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-left: 4px;
  border: 0;
  border-radius: 9px;
  background: var(--ct-bar-soft);
  color: inherit;
  cursor: pointer;
}
</style>
