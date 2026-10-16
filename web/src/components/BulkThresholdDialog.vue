<script setup lang="ts">
import { MIN_THRESHOLD_CENTS, type BulkResult, type TrackedCard, type TrackedSealed } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import { computed, ref, watch } from 'vue';
import { BulkStoppedError, bulkCards } from '../bulk-cards';
import { bulkSealed } from '../sealed-bulk';
import { MAX_PERCENT, MIN_PERCENT, THRESHOLD_MODE_OPTIONS, thresholdChoice } from '../threshold-choice';
import SegmentedControl from './SegmentedControl.vue';

/** Cards go through the server's bulk endpoint, sealed products one call each. */
const props = defineProps<{ kind: 'card' | 'sealed'; items: (TrackedCard | TrackedSealed)[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [result: BulkResult, stoppedBy?: string] }>();

const mode = ref<'percent' | 'fixed'>('percent');
const percent = ref<number | null>(10);
const euro = ref<number | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);
const noun = computed(() => (props.kind === 'card' ? 'cards' : 'products'));

watch(visible, (open) => {
  if (open) error.value = null;
});

const choice = computed(() => thresholdChoice(mode.value, percent.value, euro.value));

async function apply() {
  const c = choice.value;
  if (!c) return;
  saving.value = true;
  error.value = null;
  try {
    const result =
      props.kind === 'card'
        ? await bulkCards(
            props.items.map((i) => i.id),
            { type: 'threshold', ...c },
          )
        : await bulkSealed(props.items as TrackedSealed[], { type: 'threshold', choice: c });
    emit('done', result);
    visible.value = false;
  } catch (e) {
    if (e instanceof BulkStoppedError) {
      // Part of the cards were changed: the page reloads and keeps the others selected.
      emit('done', e.partial, e.message);
      visible.value = false;
      return;
    }
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Set target" :style="{ width: '30rem' }" :breakpoints="{ '600px': '95vw' }">
    <p class="muted">Applies to {{ items.length }} {{ noun }}. The alert fires when the CT Zero price is at or under the target.</p>
    <div class="field">
      <SegmentedControl v-model="mode" :options="THRESHOLD_MODE_OPTIONS" label="How to set the target" />
    </div>
    <div v-if="mode === 'percent'" class="field">
      <label for="bulk-percent">Percent under the current price</label>
      <InputNumber v-model="percent" input-id="bulk-percent" suffix=" %" :min="MIN_PERCENT" :max="MAX_PERCENT" />
      <small class="muted">{{ kind === 'card' ? 'Cards' : 'Products' }} without a current price are skipped.</small>
    </div>
    <div v-else class="field">
      <label for="bulk-euro">Target</label>
      <InputNumber v-model="euro" input-id="bulk-euro" mode="currency" currency="EUR" locale="en-US" :min="MIN_THRESHOLD_CENTS / 100" />
    </div>
    <Message v-if="error" severity="error">{{ error }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Apply" icon="pi pi-check" :disabled="!choice" :loading="saving" @click="apply" />
    </template>
  </Dialog>
</template>
