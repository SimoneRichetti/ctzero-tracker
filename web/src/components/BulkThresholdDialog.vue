<script setup lang="ts">
import { MIN_THRESHOLD_CENTS, type BulkAction, type BulkResult, type TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import SelectButton from 'primevue/selectbutton';
import { computed, ref, watch } from 'vue';
import { bulkCards } from '../bulk-cards';
import { MAX_PERCENT, MIN_PERCENT, THRESHOLD_MODE_OPTIONS, thresholdChoice } from '../threshold-choice';

const props = defineProps<{ cards: TrackedCard[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [result: BulkResult] }>();

const mode = ref<'percent' | 'fixed'>('percent');
const percent = ref<number | null>(10);
const euro = ref<number | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);

watch(visible, (open) => {
  if (open) error.value = null;
});

const action = computed<BulkAction | null>(() => {
  const choice = thresholdChoice(mode.value, percent.value, euro.value);
  return choice && { type: 'threshold', ...choice };
});

async function apply() {
  if (!action.value) return;
  saving.value = true;
  error.value = null;
  try {
    const result = await bulkCards(
      props.cards.map((c) => c.id),
      action.value,
    );
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
      <SelectButton v-model="mode" :options="THRESHOLD_MODE_OPTIONS" option-label="label" option-value="value" :allow-empty="false" />
    </div>
    <div v-if="mode === 'percent'" class="field">
      <label for="bulk-percent">Percent below the current price</label>
      <InputNumber v-model="percent" input-id="bulk-percent" suffix=" %" :min="MIN_PERCENT" :max="MAX_PERCENT" />
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
