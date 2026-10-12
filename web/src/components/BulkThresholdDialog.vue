<script setup lang="ts">
import { MIN_THRESHOLD_CENTS, euroToCents, type BulkAction, type BulkResult, type TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import SelectButton from 'primevue/selectbutton';
import { computed, ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ cards: TrackedCard[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [result: BulkResult] }>();

const modeOptions = [
  { label: '% below current price', value: 'percent' },
  { label: 'Fixed amount', value: 'fixed' },
];
const mode = ref<'percent' | 'fixed'>('percent');
const percent = ref<number | null>(10);
const euro = ref<number | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);

watch(visible, (open) => {
  if (open) error.value = null;
});

const action = computed<BulkAction | null>(() => {
  if (mode.value === 'percent') {
    return percent.value !== null && percent.value >= 1 && percent.value <= 90
      ? { type: 'threshold', mode: 'percent', percent: percent.value }
      : null;
  }
  return euro.value !== null && euroToCents(euro.value) >= MIN_THRESHOLD_CENTS ? { type: 'threshold', mode: 'fixed', cents: euroToCents(euro.value) } : null;
});

async function apply() {
  if (!action.value) return;
  saving.value = true;
  error.value = null;
  try {
    const result = await api.post<BulkResult>('/api/cards/bulk', { ids: props.cards.map((c) => c.id), action: action.value });
    emit('done', result);
    visible.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Change threshold" :style="{ width: '30rem' }">
    <p class="muted">Applies to {{ cards.length }} cards.</p>
    <div class="field">
      <SelectButton v-model="mode" :options="modeOptions" option-label="label" option-value="value" :allow-empty="false" />
    </div>
    <div v-if="mode === 'percent'" class="field">
      <label for="bulk-percent">Percent below the current price</label>
      <InputNumber v-model="percent" input-id="bulk-percent" suffix=" %" :min="1" :max="90" />
      <small class="muted">Cards without a current price are skipped.</small>
    </div>
    <div v-else class="field">
      <label for="bulk-euro">Threshold</label>
      <InputNumber v-model="euro" input-id="bulk-euro" mode="currency" currency="EUR" locale="en-US" :min="MIN_THRESHOLD_CENTS / 100" />
    </div>
    <Message v-if="error" severity="error">{{ error }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Apply" icon="pi pi-check" :disabled="!action" :loading="saving" @click="apply" />
    </template>
  </Dialog>
</template>
