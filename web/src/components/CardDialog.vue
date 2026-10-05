<script setup lang="ts">
import {
  CONDITIONS,
  LANGUAGES,
  LANGUAGE_LABELS,
  euroToCents,
  formatEuro,
  type CardLookupDto,
  type Condition,
  type Language,
  type PreviewResult,
  type TrackedCard,
} from '@ctzero/shared';
import AutoComplete, { type AutoCompleteCompleteEvent, type AutoCompleteOptionSelectEvent } from 'primevue/autocomplete';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ card: TrackedCard | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [card: TrackedCard] }>();

const name = ref('');
const suggestions = ref<string[]>([]);
const lookup = ref<CardLookupDto | null>(null);
const expansionIds = ref<number[]>([]);
const languages = ref<Language[]>([]);
const minCondition = ref<Condition>('Near Mint');
const foil = ref(false);
const preview = ref<PreviewResult | null>(null);
const thresholdEuro = ref<number | null>(null);
const error = ref<string | null>(null);
const loadingLookup = ref(false);
const loadingPreview = ref(false);
const saving = ref(false);

const isEdit = computed(() => props.card !== null);
const conditionOptions = [...CONDITIONS];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));
const expansionOptions = computed(() => lookup.value?.printings ?? []);
const canSave = computed(() => lookup.value !== null && thresholdEuro.value !== null && thresholdEuro.value > 0);

watch(visible, (open) => {
  if (open) void reset();
});

// A preview computed with different filters is no longer valid.
watch([expansionIds, languages, minCondition, foil], () => {
  preview.value = null;
});

// If the name is changed after selection, the loaded card is no longer valid.
watch(name, (value) => {
  if (lookup.value && value !== lookup.value.name) {
    lookup.value = null;
    preview.value = null;
  }
});

async function reset() {
  const c = props.card;
  error.value = null;
  suggestions.value = [];
  lookup.value = null;
  name.value = c?.name ?? '';
  expansionIds.value = c ? [...c.expansionIds] : [];
  languages.value = c ? [...c.languages] : [];
  minCondition.value = c?.minCondition ?? 'Near Mint';
  foil.value = c?.foil ?? false;
  thresholdEuro.value = c ? c.thresholdCents / 100 : null;
  preview.value = null;
  if (c) await loadLookup(c.name);
}

async function complete(event: AutoCompleteCompleteEvent) {
  try {
    suggestions.value = await api.get<string[]>(`/api/autocomplete?q=${encodeURIComponent(event.query)}`);
  } catch (e) {
    suggestions.value = [];
    error.value = (e as Error).message;
  }
}

async function onSelect(event: AutoCompleteOptionSelectEvent) {
  expansionIds.value = [];
  await loadLookup(event.value as string);
}

async function loadLookup(cardName: string) {
  loadingLookup.value = true;
  error.value = null;
  try {
    lookup.value = await api.get<CardLookupDto>(`/api/printings?name=${encodeURIComponent(cardName)}`);
    name.value = lookup.value.name;
  } catch (e) {
    lookup.value = null;
    error.value = (e as Error).message;
  } finally {
    loadingLookup.value = false;
  }
}

function filters() {
  return {
    expansionIds: expansionIds.value,
    languages: languages.value,
    minCondition: minCondition.value,
    foil: foil.value,
  };
}

async function calculate() {
  loadingPreview.value = true;
  error.value = null;
  try {
    preview.value = await api.post<PreviewResult>('/api/cards/preview', { name: name.value, ...filters() });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingPreview.value = false;
  }
}

async function save() {
  if (!canSave.value || thresholdEuro.value === null) return;
  saving.value = true;
  error.value = null;
  const payload = { ...filters(), thresholdCents: euroToCents(thresholdEuro.value) };
  try {
    const saved = props.card
      ? await api.put<TrackedCard>(`/api/cards/${props.card.id}`, payload)
      : await api.post<TrackedCard>('/api/cards', { name: name.value, ...payload });
    emit('saved', saved);
    visible.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="isEdit ? 'Edit card' : 'Add card'"
    :style="{ width: '46rem' }"
  >
    <div class="field">
      <label for="card-name">Card</label>
      <AutoComplete
        v-model="name"
        input-id="card-name"
        :suggestions="suggestions"
        :disabled="isEdit"
        :delay="300"
        :min-length="2"
        placeholder="E.g. Lightning Bolt"
        fluid
        @complete="complete"
        @option-select="onSelect"
      />
    </div>

    <p v-if="loadingLookup" class="muted">Loading printings…</p>

    <div v-if="lookup" class="lookup">
      <img v-if="lookup.imageUrl" :src="lookup.imageUrl" :alt="lookup.name" class="card-thumb" />
      <div class="filters">
        <div class="field">
          <label for="expansions">Expansions</label>
          <MultiSelect
            v-model="expansionIds"
            input-id="expansions"
            :options="expansionOptions"
            option-label="expansionName"
            option-value="expansionId"
            placeholder="Any expansion"
            display="chip"
            filter
            fluid
          />
        </div>
        <div class="field">
          <label for="languages">Languages</label>
          <MultiSelect
            v-model="languages"
            input-id="languages"
            :options="languageOptions"
            option-label="label"
            option-value="code"
            placeholder="Any language"
            display="chip"
            fluid
          />
        </div>
        <div class="field">
          <label for="condition">Minimum condition</label>
          <Select v-model="minCondition" input-id="condition" :options="conditionOptions" fluid />
        </div>
        <div class="field inline">
          <ToggleSwitch v-model="foil" input-id="foil" />
          <label for="foil">Foil</label>
        </div>
      </div>
    </div>

    <div v-if="lookup" class="pricing">
      <Button
        label="Calculate price"
        icon="pi pi-calculator"
        severity="secondary"
        :loading="loadingPreview"
        @click="calculate"
      />
      <div v-if="preview" class="preview">
        <p v-if="preview.listing">
          Current CT Zero price: <strong>{{ formatEuro(preview.listing.priceCents) }}</strong> —
          {{ preview.listing.expansionName }}, {{ preview.listing.condition }},
          {{ preview.listing.language.toUpperCase() }}
          <a :href="preview.listing.url" target="_blank" rel="noopener">open</a>
        </p>
        <p v-else>No valid CT Zero offers right now ({{ preview.blueprintCount }} printings checked).</p>
        <div class="presets">
          <Button
            v-for="preset in preview.presets"
            :key="preset.label"
            :label="`${preset.label} · ${formatEuro(preset.cents)}`"
            size="small"
            outlined
            @click="thresholdEuro = preset.cents / 100"
          />
        </div>
      </div>
      <div class="field">
        <label for="threshold">Notification threshold</label>
        <InputNumber
          v-model="thresholdEuro"
          input-id="threshold"
          mode="currency"
          currency="EUR"
          locale="en-US"
          :min="0.01"
        />
      </div>
    </div>

    <Message v-if="error" severity="error">{{ error }}</Message>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Save" icon="pi pi-check" :disabled="!canSave" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.lookup {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}
.filters {
  flex: 1;
}
.pricing {
  border-top: 1px solid #e5e7eb;
  padding-top: 1rem;
  margin-top: 0.5rem;
}
.preview {
  margin: 0.75rem 0;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
