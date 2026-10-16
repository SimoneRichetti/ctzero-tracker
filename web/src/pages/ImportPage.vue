<script setup lang="ts">
import {
  CONDITIONS,
  LANGUAGES,
  LANGUAGE_LABELS,
  MAX_IMPORT_CARDS,
  MIN_THRESHOLD_CENTS,
  euroToCents,
  formatEuro,
  parseDecklist,
  type CardGroup,
  type Condition,
  type ImportResolveResult,
  type Language,
  type TrackedCard,
} from '@ctzero/shared';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import { useToast } from 'primevue/usetoast';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { FINISH_OPTIONS, finishModel } from '../finish-choice';
import { runBatch } from '../batch-runner';
import { useCatalog } from '../catalog';
import BatchProgress from '../components/BatchProgress.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import { groupFilterPath } from '../group-summary';
import {
  buildReviewRows,
  canInclude,
  createPayload,
  rowsToCreate,
  setRowThreshold,
  type ReviewRow,
  type RowStatus,
} from '../import-review';
import { MAX_PERCENT, MIN_PERCENT, THRESHOLD_MODE_OPTIONS, thresholdChoice } from '../threshold-choice';

type Step = 'input' | 'resolving' | 'review' | 'creating' | 'done';

const toast = useToast();
const conditionOptions = [...CONDITIONS];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));
const groupModeOptions: { label: string; value: 'new' | 'existing' | 'none' }[] = [
  { label: 'New group', value: 'new' },
  { label: 'Existing group', value: 'existing' },
  { label: 'No group', value: 'none' },
];
const STEPS = [
  { label: 'Paste the list', steps: ['input'] },
  { label: 'Review prices and targets', steps: ['resolving', 'review'] },
  { label: 'Done', steps: ['creating', 'done'] },
];
const STATUS_TAGS: Record<RowStatus, { label: string; severity: 'success' | 'info' | 'warn' | 'danger' }> = {
  ok: { label: 'Ready', severity: 'success' },
  tracked: { label: 'Already tracked', severity: 'info' },
  no_offers: { label: 'No offers', severity: 'warn' },
  not_found: { label: 'Not found', severity: 'danger' },
  error: { label: 'Error', severity: 'danger' },
};

const text = ref('');
const languages = ref<Language[]>([]);
const minCondition = ref<Condition>('Near Mint');
const foil = ref<boolean | null>(null);
const finish = finishModel(foil);
const respectSet = ref(false);
const thresholdMode = ref<'percent' | 'fixed'>('percent');
const percent = ref<number | null>(10);
const fixedEuro = ref<number | null>(null);
const groupMode = ref<'new' | 'existing' | 'none'>('new');
const newGroupName = ref('');
const existingGroupId = ref<number | null>(null);
const route = useRoute();
const { groups, reloadCardsAndGroups, reloadGroups } = useCatalog();

const step = ref<Step>('input');
const progress = ref({ done: 0, total: 0 });
const rows = ref<ReviewRow[]>([]);
const resolveNotice = ref<string | null>(null);
const result = ref<{
  created: number;
  errors: { lineNo: number; name: string; message: string }[];
  groupId: number | null;
  notice: string | null;
} | null>(null);
let controller: AbortController | null = null;

const parsed = computed(() => parseDecklist(text.value));
const tooMany = computed(() => parsed.value.lines.length > MAX_IMPORT_CARDS);
const thresholdDefault = computed(() => thresholdChoice(thresholdMode.value, percent.value, fixedEuro.value));
const groupError = computed(() => {
  if (groupMode.value === 'new') {
    const name = newGroupName.value.trim();
    if (!name) return 'Enter a name for the new group';
    if (groups.value.some((g) => g.name.toLowerCase() === name.toLowerCase())) return 'A group with this name already exists';
  }
  if (groupMode.value === 'existing' && existingGroupId.value === null) return 'Choose a group';
  return null;
});
const canResolve = computed(
  () => parsed.value.lines.length > 0 && !tooMany.value && thresholdDefault.value !== null && groupError.value === null,
);
const toCreate = computed(() => rowsToCreate(rows.value));

// Opened from a group ("Import into group"): that group is the destination.
const presetGroupId = Number(route.query.group);
if (Number.isInteger(presetGroupId) && presetGroupId > 0) {
  groupMode.value = 'existing';
  existingGroupId.value = presetGroupId;
}
watch(groups, (list) => {
  if (existingGroupId.value !== null && !list.some((g) => g.id === existingGroupId.value)) existingGroupId.value = null;
});

const stepIndex = computed(() => STEPS.findIndex((s) => s.steps.includes(step.value)));

const pausedSeconds = ref<number | null>(null);

function onProgress(done: number, total: number) {
  progress.value = { done, total };
}

function onPause(secondsLeft: number | null) {
  pausedSeconds.value = secondsLeft;
}

async function resolveLines() {
  const def = thresholdDefault.value;
  if (!def) return;
  const lines = parsed.value.lines;
  const defaultFoil = foil.value;
  controller = new AbortController();
  step.value = 'resolving';
  resolveNotice.value = null;
  const outcome = await runBatch(
    lines,
    (line) =>
      api.post<ImportResolveResult>('/api/import/resolve', {
        name: line.name,
        setCode: line.setCode,
        setGuessed: line.setGuessed,
        respectSet: respectSet.value,
        languages: languages.value,
        minCondition: minCondition.value,
        foil: line.foil || defaultFoil,
      }),
    { signal: controller.signal, onProgress, onPause },
  );
  controller = null;
  rows.value = buildReviewRows(lines, outcome, def, defaultFoil);
  if (outcome.stopped === 'fatal') resolveNotice.value = `Stopped: ${outcome.fatalMessage}`;
  else if (outcome.stopped === 'aborted') resolveNotice.value = `Stopped: ${lines.length - rows.value.length} cards were not checked.`;
  step.value = 'review';
}

async function confirmImport() {
  const selection = toCreate.value;
  if (selection.length === 0) return;
  step.value = 'creating';
  progress.value = { done: 0, total: selection.length };
  let groupId: number | null = null;
  try {
    if (groupMode.value === 'new') {
      groupId = (await api.post<CardGroup>('/api/groups', { name: newGroupName.value.trim() })).id;
    } else if (groupMode.value === 'existing') {
      groupId = existingGroupId.value;
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Could not create the group', detail: (e as Error).message, life: 6000 });
    step.value = 'review';
    return;
  }
  controller = new AbortController();
  const opts = { languages: languages.value, minCondition: minCondition.value, groupId };
  const outcome = await runBatch(selection, (row) => api.post<TrackedCard>('/api/cards', createPayload(row, opts)), {
    signal: controller.signal,
    onProgress,
    onPause,
  });
  controller = null;
  result.value = {
    created: outcome.results.length,
    errors: outcome.errors.map((e) => ({ lineNo: e.item.line.lineNo, name: e.item.result!.name, message: e.message })),
    groupId,
    notice:
      outcome.stopped === 'fatal'
        ? `Stopped: ${outcome.fatalMessage}`
        : outcome.stopped === 'aborted'
          ? 'Stopped before the end.'
          : null,
  };
  step.value = 'done';
  void reloadCardsAndGroups();
}

onBeforeUnmount(() => controller?.abort());

function abort() {
  controller?.abort();
}

function thresholdEuro(row: ReviewRow): number | null {
  return row.thresholdCents === null ? null : row.thresholdCents / 100;
}

function onThresholdInput(row: ReviewRow, value: number | null) {
  setRowThreshold(row, value === null ? null : euroToCents(value));
}

function startOver() {
  text.value = '';
  rows.value = [];
  result.value = null;
  newGroupName.value = '';
  step.value = 'input';
  // The import may have created a group: the name check and the 'Existing group' list need it.
  void reloadGroups();
}
</script>

<template>
  <div class="page">
  <div class="page-head">
    <div>
      <div class="eyebrow">Cards</div>
      <h1 class="page-title">Import a list</h1>
    </div>
  </div>

  <ol class="steps">
    <li v-for="(s, i) in STEPS" :key="s.label" :class="{ current: i === stepIndex, done: i < stepIndex }">
      <span class="step-no">{{ i + 1 }}</span>{{ s.label }}
    </li>
  </ol>

  <!-- Step 1: list and options -->
  <div v-if="step === 'input'" class="input-grid">
    <section class="panel">
      <label for="decklist" class="panel-title block">Decklist</label>
      <Textarea
        id="decklist"
        v-model="text"
        rows="16"
        placeholder="1 Sol Ring (C21) 263&#10;4x Lightning Bolt&#10;Arcane Signet"
        fluid
        class="decklist"
      />
      <div class="deck-info">
        <span><strong>{{ parsed.lines.length }}</strong> cards recognised</span>
        <span v-if="parsed.errors.length" class="warn">{{ parsed.errors.length }} lines skipped</span>
        <span>Moxfield, Archidekt and MTG Arena exports work. Quantities are ignored.</span>
      </div>
      <ul v-if="parsed.errors.length" class="error-list">
        <li v-for="e in parsed.errors" :key="e.lineNo">Line {{ e.lineNo }}: {{ e.text }}</li>
      </ul>
      <Message v-if="tooMany" severity="error">At most {{ MAX_IMPORT_CARDS }} cards per import.</Message>
    </section>

    <section class="panel options">
      <div class="block">
        <div class="panel-title">Add to group</div>
        <SegmentedControl v-model="groupMode" :options="groupModeOptions" label="Destination" />
        <InputText v-if="groupMode === 'new'" v-model="newGroupName" placeholder="New group name" aria-label="New group name" fluid />
        <Select
          v-else-if="groupMode === 'existing'"
          v-model="existingGroupId"
          :options="groups"
          option-label="name"
          option-value="id"
          placeholder="Choose a group"
          aria-label="Group"
          fluid
        />
        <small v-if="groupError && parsed.lines.length > 0" class="muted">{{ groupError }}</small>
      </div>

      <div class="block">
        <div class="panel-title">Rules for every card</div>
        <div class="two">
          <div class="field">
            <label for="imp-languages">Languages</label>
            <MultiSelect
              v-model="languages"
              input-id="imp-languages"
              :options="languageOptions"
              option-label="label"
              option-value="code"
              placeholder="Any language"
              :max-selected-labels="2"
              selected-items-label="{0} languages"
              fluid
            />
          </div>
          <div class="field">
            <label for="imp-condition">Minimum condition</label>
            <Select v-model="minCondition" input-id="imp-condition" :options="conditionOptions" fluid />
          </div>
        </div>
        <div class="field">
          <label for="imp-foil">Finish (lines marked *F* are always foil only)</label>
          <Select v-model="finish" input-id="imp-foil" :options="FINISH_OPTIONS" option-label="label" option-value="value" fluid />
        </div>
        <div class="field inline">
          <ToggleSwitch v-model="respectSet" input-id="imp-set" />
          <label for="imp-set" class="toggle-label">Only the set written in the list</label>
        </div>
      </div>

      <div class="block">
        <div class="panel-title">Target for every card</div>
        <SegmentedControl v-model="thresholdMode" :options="THRESHOLD_MODE_OPTIONS" label="How to set the target" />
        <InputNumber v-if="thresholdMode === 'percent'" v-model="percent" suffix=" %" :min="MIN_PERCENT" :max="MAX_PERCENT" aria-label="Percent" />
        <InputNumber
          v-else
          v-model="fixedEuro"
          mode="currency"
          currency="EUR"
          locale="en-US"
          :min="MIN_THRESHOLD_CENTS / 100"
          aria-label="Target"
        />
        <small class="muted">You can adjust each card in the next step.</small>
      </div>

      <Button
        :label="parsed.lines.length > 0 ? `Check prices for ${parsed.lines.length} cards` : 'Check prices'"
        icon="pi pi-search"
        :disabled="!canResolve"
        @click="resolveLines"
      />
    </section>
  </div>

  <!-- Steps 2 and 4: progress -->
  <section v-else-if="step === 'resolving' || step === 'creating'" class="panel">
    <p>{{ step === 'resolving' ? 'Checking cards on CardTrader…' : 'Adding cards…' }} Keep this tab open.</p>
    <BatchProgress :done="progress.done" :total="progress.total" :paused-seconds="pausedSeconds" />
    <Button label="Stop" severity="danger" text class="stop" @click="abort" />
  </section>

  <!-- Step 3: review -->
  <section v-else-if="step === 'review'">
    <Message v-if="resolveNotice" severity="warn">{{ resolveNotice }}</Message>
    <div class="review-header">
      <span><strong>{{ toCreate.length }}</strong> of {{ rows.length }} cards will be tracked</span>
      <div class="review-actions">
        <Button label="Back" severity="secondary" text @click="step = 'input'" />
        <Button
          :label="`Track ${toCreate.length} cards`"
          icon="pi pi-check"
          :disabled="toCreate.length === 0"
          @click="confirmImport"
        />
      </div>
    </div>
    <DataTable :value="rows" data-key="line.lineNo" class="ct-table" scrollable>
      <Column header="" style="width: 3rem">
        <template #body="{ data }">
          <Checkbox v-model="data.include" binary :disabled="!canInclude(data)" />
        </template>
      </Column>
      <Column header="" style="width: 64px">
        <template #body="{ data }">
          <img v-if="data.result?.imageUrl" :src="data.result.imageUrl" :alt="data.result.name" class="row-thumb" />
        </template>
      </Column>
      <Column header="Card">
        <template #body="{ data }">
          <strong>{{ data.result?.name ?? data.line.name }}</strong>
          <div class="muted">
            Line {{ data.line.lineNo }}<template v-if="data.foil"> · Foil</template
            ><template v-if="data.line.setCode && respectSet && data.result?.expansionIds.length !== 0"> · {{ data.line.setCode.toUpperCase() }}</template>
          </div>
        </template>
      </Column>
      <Column header="CT Zero price">
        <template #body="{ data }">
          <template v-if="data.result?.priceCents != null">
            <strong>{{ formatEuro(data.result.priceCents) }}</strong>
            <div v-if="data.result.listing" class="muted">{{ data.result.listing.expansionName }}</div>
          </template>
          <span v-else>—</span>
        </template>
      </Column>
      <Column header="Target">
        <template #body="{ data }">
          <InputNumber
            v-if="data.result"
            :model-value="thresholdEuro(data)"
            mode="currency"
            currency="EUR"
            locale="en-US"
            :min="MIN_THRESHOLD_CENTS / 100"
            input-class="threshold-input"
            :invalid="data.thresholdCents !== null && !canInclude(data)"
            aria-label="Target"
            @update:model-value="(v: number | null) => onThresholdInput(data, v)"
          />
        </template>
      </Column>
      <Column header="Status">
        <template #body="{ data }">
          <Tag :value="STATUS_TAGS[data.status as RowStatus].label" :severity="STATUS_TAGS[data.status as RowStatus].severity" />
          <div v-if="data.error" class="row-error">{{ data.error }}</div>
        </template>
      </Column>
    </DataTable>
  </section>

  <!-- Step 5: done -->
  <section v-else-if="step === 'done' && result" class="panel">
    <h2>{{ result.created }} cards added</h2>
    <Message v-if="result.notice" severity="warn">{{ result.notice }}</Message>
    <template v-if="result.errors.length">
      <p>{{ result.errors.length }} cards could not be added:</p>
      <ul class="error-list">
        <li v-for="e in result.errors" :key="e.lineNo"><strong>{{ e.name }}</strong>: {{ e.message }}</li>
      </ul>
    </template>
    <div class="review-actions">
      <RouterLink :to="groupFilterPath(result.groupId ?? 'all')">
        <Button :label="result.groupId !== null ? 'Open the group' : 'Open cards'" icon="pi pi-arrow-right" />
      </RouterLink>
      <Button label="Import another list" severity="secondary" text @click="startOver" />
    </div>
  </section>
  </div>
</template>

<style scoped>
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  list-style: none;
  margin: -8px 0 24px;
  padding: 0;
  font-size: 13px;
  color: var(--ct-muted);
}
.steps li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.steps li.current {
  color: var(--ct-ink);
  font-weight: 600;
}
.step-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--ct-line-strong);
  border-radius: 999px;
  font-size: 12px;
}
.current .step-no {
  border-color: var(--ct-accent);
  background: var(--ct-accent);
  color: var(--ct-accent-ink);
}
.done .step-no {
  border-color: var(--ct-accent);
  color: var(--ct-accent-text);
}
.input-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
@media (max-width: 900px) {
  .input-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.block {
  display: block;
}
.decklist {
  font-family: var(--ct-mono);
  font-size: 13px;
  line-height: 1.6;
}
.deck-info {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--ct-muted);
}
.deck-info strong {
  color: var(--ct-ink);
}
.deck-info .warn {
  color: var(--ct-warn);
}
.options {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.options .block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.options .block .panel-title {
  margin-bottom: 0;
}
.options .field {
  margin-bottom: 0;
}
.options :deep(.seg) {
  align-self: flex-start;
}
.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.toggle-label {
  color: var(--ct-ink) !important;
  font-weight: 400 !important;
  font-size: 13.5px !important;
}
.review-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.review-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.stop {
  margin-top: 0.75rem;
}
.row-error {
  margin-top: 0.25rem;
  max-width: 22rem;
  color: var(--ct-danger);
  font-size: 0.8rem;
}
:deep(.threshold-input) {
  width: 7rem;
}
</style>
