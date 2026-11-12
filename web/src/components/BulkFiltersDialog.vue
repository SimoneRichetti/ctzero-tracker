<script setup lang="ts">
import {
  CONDITIONS,
  LANGUAGES,
  LANGUAGE_LABELS,
  type Condition,
  type Expansion,
  type Language,
  type TrackedCard,
} from '@ctzero/shared';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { useAdditiveSelectAll } from '../additive-select-all';
import { FINISH_OPTIONS, finishModel } from '../finish-choice';
import { runBatch, type BatchOutcome } from '../batch-runner';
import { filterUpdate, type FilterChange } from '../bulk-filters';
import BatchProgress from './BatchProgress.vue';
import SelectedExpansions from './SelectedExpansions.vue';

const props = defineProps<{ cards: TrackedCard[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [] }>();

const conditionOptions = [...CONDITIONS];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));

const changeLanguages = ref(false);
const changeCondition = ref(false);
const changeFoil = ref(false);
const languages = ref<Language[]>([]);
const minCondition = ref<Condition>('Near Mint');
const foil = ref<boolean | null>(null);
const finish = finishModel(foil);
const changeExcluded = ref(false);
const excludedMode = ref<'add' | 'remove'>('add');
const excludedIds = ref<number[]>([]);
const expansions = ref<Expansion[]>([]);
const expansionsError = ref<string | null>(null);
const excludedSelect = useAdditiveSelectAll(excludedIds, expansions, (e) => e.name, (e) => e.id);
const excludedModeOptions = [
  { label: 'Also exclude', value: 'add' },
  { label: 'Stop excluding', value: 'remove' },
];
const running = ref(false);
const progress = ref({ done: 0, total: 0 });
const pausedSeconds = ref<number | null>(null);
const outcome = ref<BatchOutcome<TrackedCard, TrackedCard> | null>(null);
let controller: AbortController | null = null;

watch(visible, (open) => {
  if (!open) return;
  changeLanguages.value = false;
  changeCondition.value = false;
  changeFoil.value = false;
  changeExcluded.value = false;
  excludedIds.value = [];
  outcome.value = null;
  progress.value = { done: 0, total: 0 };
});

// The CardTrader expansions list is loaded the first time it is needed.
watch(changeExcluded, async (on) => {
  if (!on || expansions.value.length > 0) return;
  expansionsError.value = null;
  try {
    expansions.value = await api.get<Expansion[]>('/api/expansions');
  } catch (e) {
    expansionsError.value = `Expansions not loaded: ${(e as Error).message}`;
  }
});

/** Cards with specific expansions ignore exclusions. */
const specificCount = computed(() => props.cards.filter((c) => c.expansionIds.length > 0).length);

const change = computed<FilterChange>(() => ({
  ...(changeLanguages.value ? { languages: languages.value } : {}),
  ...(changeCondition.value ? { minCondition: minCondition.value } : {}),
  ...(changeFoil.value ? { foil: foil.value } : {}),
  ...(changeExcluded.value && excludedIds.value.length > 0
    ? { excluded: { mode: excludedMode.value, expansionIds: excludedIds.value } }
    : {}),
}));
const canApply = computed(() => Object.keys(change.value).length > 0);

async function apply() {
  const c = change.value;
  const cards = [...props.cards];
  controller = new AbortController();
  running.value = true;
  try {
    outcome.value = await runBatch(
      cards,
      (card) => api.put<TrackedCard>(`/api/cards/${card.id}`, filterUpdate(card, c)),
      {
        signal: controller.signal,
        onProgress: (done, total) => (progress.value = { done, total }),
        onPause: (secondsLeft) => (pausedSeconds.value = secondsLeft),
      },
    );
  } finally {
    running.value = false;
    controller = null;
    emit('done');
  }
}

function abort() {
  controller?.abort();
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Edit rules" :breakpoints="{ '600px': '95vw' }" :closable="!running" :close-on-escape="!running" :style="{ width: '34rem' }">
    <template v-if="!running && !outcome">
      <p class="muted">
        Applies to {{ cards.length }} cards. Unchecked rules keep each card's own value; chosen expansions never change.
        Every card is re-priced, so this can take a few minutes: keep this tab open.
      </p>
      <div class="field inline">
        <Checkbox v-model="changeLanguages" binary input-id="chg-languages" />
        <label for="chg-languages">Languages</label>
      </div>
      <div v-if="changeLanguages" class="field">
        <MultiSelect
          v-model="languages"
          :options="languageOptions"
          option-label="label"
          option-value="code"
          placeholder="Any language"
          display="chip"
          fluid
        />
      </div>
      <div class="field inline">
        <Checkbox v-model="changeCondition" binary input-id="chg-condition" />
        <label for="chg-condition">Minimum condition</label>
      </div>
      <div v-if="changeCondition" class="field">
        <Select v-model="minCondition" :options="conditionOptions" fluid />
      </div>
      <div class="field inline">
        <Checkbox v-model="changeFoil" binary input-id="chg-foil" />
        <label for="chg-foil">Finish</label>
      </div>
      <div v-if="changeFoil" class="field">
        <Select v-model="finish" :options="FINISH_OPTIONS" option-label="label" option-value="value" fluid />
      </div>
      <div class="field inline">
        <Checkbox v-model="changeExcluded" binary input-id="chg-excluded" />
        <label for="chg-excluded">Excluded expansions</label>
      </div>
      <template v-if="changeExcluded">
        <div class="field">
          <Select v-model="excludedMode" :options="excludedModeOptions" option-label="label" option-value="value" fluid />
        </div>
        <div class="field">
          <MultiSelect
            v-model="excludedIds"
            :options="expansions"
            option-label="name"
            option-value="id"
            placeholder="Choose expansions"
            :max-selected-labels="0"
            selected-items-label="{0} selected"
            filter
            :loading="expansions.length === 0 && !expansionsError"
            :select-all="excludedSelect.selectAll"
            fluid
            @filter="excludedSelect.onFilter"
            @selectall-change="excludedSelect.onSelectAllChange"
          />
          <SelectedExpansions v-model="excludedIds" :options="expansions" />
        </div>
        <Message v-if="expansionsError" severity="error">{{ expansionsError }}</Message>
        <p class="muted">
          Only for "any expansion" cards<template v-if="specificCount">: {{ specificCount }} with specific expansions keep theirs</template>.
          Cards not printed in these expansions are left as they are.
        </p>
      </template>
    </template>
    <template v-else>
      <BatchProgress :done="progress.done" :total="progress.total" :paused-seconds="pausedSeconds" />
      <template v-if="outcome">
        <p>
          {{ outcome.results.length }} updated<span v-if="outcome.errors.length">, {{ outcome.errors.length }} failed</span>.
        </p>
        <Message v-if="outcome.stopped === 'fatal'" severity="error">Stopped: {{ outcome.fatalMessage }}</Message>
        <Message v-else-if="outcome.stopped === 'aborted'" severity="warn">Stopped before the end.</Message>
        <ul v-if="outcome.errors.length" class="error-list">
          <li v-for="e in outcome.errors" :key="e.item.id"><strong>{{ e.item.name }}</strong>: {{ e.message }}</li>
        </ul>
      </template>
    </template>
    <template #footer>
      <Button v-if="running" label="Stop" severity="danger" text @click="abort" />
      <Button v-else-if="outcome" label="Close" @click="visible = false" />
      <template v-else>
        <Button label="Cancel" severity="secondary" text @click="visible = false" />
        <Button label="Apply" icon="pi pi-check" :disabled="!canApply" @click="apply" />
      </template>
    </template>
  </Dialog>
</template>
