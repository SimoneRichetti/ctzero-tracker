<script setup lang="ts">
import Button from 'primevue/button';
import Chip from 'primevue/chip';
import { computed } from 'vue';

/**
 * The full list of selected expansions under a MultiSelect, which only shows the count:
 * long selections stay readable and each one can be removed.
 */
const model = defineModel<number[]>({ required: true });
const props = defineProps<{ options: { id: number; name: string }[] }>();

const items = computed(() => {
  const names = new Map(props.options.map((o) => [o.id, o.name]));
  return model.value
    .map((id) => ({ id, name: names.get(id) ?? `#${id}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
});

function remove(id: number) {
  model.value = model.value.filter((x) => x !== id);
}
</script>

<template>
  <div v-if="items.length > 0" class="selected-expansions">
    <div class="head">
      <Button label="Clear all" size="small" text severity="secondary" @click="model = []" />
    </div>
    <ul class="chips">
      <li v-for="item in items" :key="item.id">
        <Chip :label="item.name" removable @remove="remove(item.id)" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.selected-expansions {
  margin-top: 0.5rem;
}
.head {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  max-height: 11rem;
  overflow-y: auto;
  margin: 0.25rem 0 0;
  padding: 0;
  list-style: none;
}
.chips :deep(.p-chip) {
  font-size: 0.8125rem;
  padding-block: 0.125rem;
}
</style>
