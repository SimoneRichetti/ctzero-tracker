<script setup lang="ts">
import {
  CONDITIONS,
  LANGUAGES,
  LANGUAGE_LABELS,
  MIN_THRESHOLD_CENTS,
  euroToCents,
  formatEuro,
  thresholdPresets,
  type CardGroup,
  type CardLookupDto,
  type Condition,
  type Language,
  type PurchaseResult,
  type TrackedCard,
  type TrackedCardRow,
  type TrackedSealed,
  type TrackedSealedRow,
} from '@ctzero/shared';
import Button from 'primevue/button';
import Drawer from 'primevue/drawer';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import { useConfirm } from 'primevue/useconfirm';
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { FINISH_OPTIONS, fromFinish, toFinish } from '../finish-choice';
import { cardStatus } from '../card-status';
import { latestRequest } from '../latest-request';
import { copiesProgress, suggestStopTracking } from '../purchase-summary';
import { cardTraderUrl as cardTraderLink, gapSentence, largeImageUrl, listingLine, savingText, sinceStart, targetGap } from '../row-format';
import { dayInText, formatWhen } from '../time-format';
import PriceHistoryChart from './PriceHistoryChart.vue';
import StatusPill from './StatusPill.vue';

type Row = TrackedCardRow | TrackedSealedRow;

/** `item` null = closed. The page owns which item is open (`?item=` in the route). */
const props = defineProps<{ kind: 'card' | 'sealed'; item: Row | null; groups: CardGroup[] }>();
const emit = defineEmits<{
  close: [];
  saved: [item: TrackedCard | TrackedSealed];
  deleted: [item: Row];
  /** `keptTracking` false = the item was moved to the archive (`result.item` is null). */
  purchased: [result: PurchaseResult<TrackedCard | TrackedSealed>, keptTracking: boolean];
}>();
const confirm = useConfirm();

const conditionOptions = [...CONDITIONS];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));

interface Form {
  targetEuro: number | null;
  languages: Language[];
  expansionIds: number[];
  minCondition: Condition;
  foil: boolean | null;
  groupId: number | null;
  quantityNeeded: number | null;
}

const form = ref<Form>(emptyForm());
const paidEuro = ref<number | null>(null);
const buyQuantity = ref(1);
/** The action being sent: true = keep tracking, false = stop; null = none. */
const purchasing = ref<boolean | null>(null);
const { purchases } = useCatalog();
const baseline = ref('');
const lookup = ref<CardLookupDto | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);
const lookupRequest = latestRequest();

const card = computed(() => (props.kind === 'card' && props.item ? (props.item as TrackedCardRow) : null));
const sealed = computed(() => (props.kind === 'sealed' && props.item ? (props.item as TrackedSealedRow) : null));

function emptyForm(): Form {
  return { targetEuro: null, languages: [], expansionIds: [], minCondition: 'Near Mint', foil: null, groupId: null, quantityNeeded: null };
}

function formOf(item: Row): Form {
  const c = props.kind === 'card' ? (item as TrackedCard) : null;
  return {
    targetEuro: item.thresholdCents / 100,
    languages: [...item.languages],
    expansionIds: c ? [...c.expansionIds] : [],
    minCondition: c?.minCondition ?? 'Near Mint',
    foil: c ? c.foil : null,
    groupId: c?.groupId ?? null,
    quantityNeeded: item.quantityNeeded,
  };
}

function resetFrom(item: Row) {
  form.value = formOf(item);
  baseline.value = JSON.stringify(form.value);
  error.value = null;
}

const finish = computed({
  get: () => toFinish(form.value.foil),
  set: (v) => (form.value.foil = fromFinish(v)),
});

const dirty = computed(() => props.item !== null && JSON.stringify(form.value) !== baseline.value);

// A new item resets the form (the route guards below already asked about unsaved edits);
// fresh data for the same item (a run finished) only when nothing is being edited.
watch(
  () => props.item,
  (item, previous) => {
    if (!item) return;
    if (item.id !== previous?.id) {
      resetFrom(item);
      resetPaid(item);
      void loadPrintings(item);
    } else {
      if (!dirty.value) resetFrom(item);
      // A price found after the panel opened (first update) becomes the default price paid.
      if (paidEuro.value === null) resetPaid(item);
    }
  },
  { immediate: true },
);

async function loadPrintings(item: Row) {
  lookup.value = null;
  if (props.kind !== 'card') return;
  const isLatest = lookupRequest.start();
  try {
    const data = await api.get<CardLookupDto>(`/api/printings?name=${encodeURIComponent(item.name)}`);
    if (isLatest()) lookup.value = data;
  } catch (e) {
    if (isLatest()) error.value = `Expansions not loaded: ${(e as Error).message}`;
  }
}

// Until the printings arrive, the selected expansions are still shown by name.
const expansionOptions = computed(() => {
  if (lookup.value) return lookup.value.printings;
  const c = card.value;
  return c ? c.expansionIds.map((id, i) => ({ expansionId: id, expansionName: c.expansionNames[i] ?? `#${id}` })) : [];
});

const visible = computed({
  get: () => props.item !== null,
  set: (open: boolean) => {
    if (!open) requestClose();
  },
});

/** Closing changes `?item=`: the route guards below ask about unsaved edits. */
function requestClose() {
  emit('close');
}

/** Resolves true when there is nothing to lose or the user agrees to drop the edits. */
function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return Promise.resolve(true);
  return new Promise((resolve) => {
    confirm.require({
      message: 'Discard your unsaved changes?',
      header: 'Unsaved changes',
      icon: 'pi pi-exclamation-triangle',
      acceptProps: { label: 'Discard', severity: 'danger' },
      rejectProps: { label: 'Keep editing', severity: 'secondary', outlined: true },
      accept: () => {
        baseline.value = JSON.stringify(form.value);
        resolve(true);
      },
      reject: () => resolve(false),
      onHide: () => resolve(false),
    });
  });
}

// Any navigation that closes or switches the panel (close button, Esc, another row, back/forward,
// a sidebar link) goes through these: unsaved edits are never dropped silently.
onBeforeRouteUpdate((to, from) => (to.query.item === from.query.item ? true : confirmDiscard()));
onBeforeRouteLeave(() => confirmDiscard());

const status = computed(() => (props.item ? cardStatus(props.item) : 'pending'));
const presets = computed(() => (props.item ? thresholdPresets(props.item.lastPriceCents) : []));
const gap = computed(() => (props.item ? targetGap(props.item) : null));
const image = computed(() => {
  const url = props.item?.imageUrl;
  if (!url) return null;
  return largeImageUrl(props.kind, url);
});
const context = computed(() => {
  if (sealed.value) return `Sealed product · ${sealed.value.categoryName}`;
  const c = card.value;
  const group = c?.groupId != null ? props.groups.find((g) => g.id === c.groupId)?.name : undefined;
  return group ? `Card · ${group}` : 'Card · no group';
});
const listing = computed(() => {
  const item = props.item;
  if (!item?.lastListing) return item?.lastSyncStatus === 'error' ? 'last update failed' : 'no offer matches the rules';
  return listingLine(props.kind, item.lastListing) ?? '';
});
const cardTraderUrl = computed(() => (props.item ? cardTraderLink(props.item) : '#'));
const checked = computed(() => {
  const item = props.item;
  if (!item?.lastSyncedAt) return 'Not checked yet';
  const when = formatWhen(item.lastSyncedAt, new Date());
  return item.lastSyncStatus === 'error' ? `Failed ${when}` : `Checked ${when}`;
});
const refreshKey = computed(() => {
  const item = props.item;
  return item ? `${item.configVersion}-${item.thresholdCents}-${item.lastSyncedAt}` : '';
});
const canSave = computed(
  () => dirty.value && form.value.targetEuro !== null && euroToCents(form.value.targetEuro) >= MIN_THRESHOLD_CENTS && !saving.value,
);

async function save() {
  const item = props.item;
  if (!item || !canSave.value || form.value.targetEuro === null) return;
  saving.value = true;
  error.value = null;
  const f = form.value;
  const thresholdCents = euroToCents(f.targetEuro!);
  try {
    const saved =
      props.kind === 'card'
        ? await api.put<TrackedCard>(`/api/cards/${item.id}`, {
            expansionIds: f.expansionIds,
            languages: f.languages,
            minCondition: f.minCondition,
            foil: f.foil,
            thresholdCents,
            groupId: f.groupId,
            quantityNeeded: f.quantityNeeded,
          })
        : await api.put<TrackedSealed>(`/api/sealed/${item.id}`, { languages: f.languages, thresholdCents, quantityNeeded: f.quantityNeeded });
    // Saved values become the new baseline; the page reloads the list for the rest (trend, statuses).
    resetFrom({ ...item, ...saved } as Row);
    emit('saved', saved);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}


// ---------- start price and purchase ----------
/** The price paid defaults to the current price, which is what the user most likely paid. */
function resetPaid(item: Row | TrackedCard | TrackedSealed) {
  const cents = item.lastPriceCents ?? item.startPriceCents;
  paidEuro.value = cents === null ? null : cents / 100;
  buyQuantity.value = 1;
}

const noun = computed(() => (props.kind === 'card' ? 'card' : 'product'));

const start = computed(() => {
  const c = props.item;
  if (!c || c.startPriceCents === null) return null;
  const since = c.startPriceAt ? `since ${dayInText(c.startPriceAt, new Date())}` : null;
  return { cents: c.startPriceCents, sub: [since, sinceStart(c)].filter(Boolean).join(' · ') };
});

const quantity = computed(() => Math.max(1, buyQuantity.value || 1));

/** What buying `quantity` copies at `paidEuro` each would save. */
const savingPreview = computed(() => {
  const c = props.item;
  if (!c || paidEuro.value === null || c.startPriceCents === null) return null;
  const copies = quantity.value > 1 ? ` × ${quantity.value}` : '';
  const text = savingText((c.startPriceCents - euroToCents(paidEuro.value)) * quantity.value);
  return `${text} on the start price of ${formatEuro(c.startPriceCents)}${copies}`;
});

const progress = computed(() => (props.item ? copiesProgress(props.item) : null));
/** Share of the copies needed that this purchase adds, for the progress bar. */
const addingPct = computed(() => {
  const c = props.item;
  if (!c?.quantityNeeded || !progress.value) return 0;
  return Math.max(0, Math.min(100 - progress.value.pct, Math.round((quantity.value / c.quantityNeeded) * 100)));
});
const stopByDefault = computed(() => (props.item ? suggestStopTracking(props.item, quantity.value) : true));
const completes = computed(() => {
  const c = props.item;
  return !!c && c.quantityNeeded !== null && c.boughtQuantity < c.quantityNeeded && stopByDefault.value;
});
/** Both actions, the suggested one first and highlighted. */
const buyActions = computed(() => {
  const stop = { keep: false, label: 'Bought · stop tracking' };
  const keep = { keep: true, label: 'Bought · keep tracking' };
  return stopByDefault.value
    ? [{ ...stop, primary: true }, { ...keep, primary: false }]
    : [{ ...keep, primary: true }, { ...stop, primary: false }];
});
const canBuy = computed(() => paidEuro.value !== null && euroToCents(paidEuro.value) >= 1 && purchasing.value === null);

/** Purchases made while tracking this item, newest first. */
const itemPurchases = computed(() => {
  const c = props.item;
  return c && purchases.value ? purchases.value.items.filter((p) => p.kind === props.kind && p.itemId === c.id) : [];
});

async function buy(keepTracking: boolean) {
  const c = props.item;
  if (!c || !canBuy.value) return;
  purchasing.value = keepTracking;
  error.value = null;
  try {
    const result = await api.post<PurchaseResult<TrackedCard | TrackedSealed>>(
      `/api/${props.kind === 'card' ? 'cards' : 'sealed'}/${c.id}/purchases`,
      { pricePaidCents: euroToCents(paidEuro.value!), quantity: quantity.value, keepTracking },
    );
    // The panel closes when the item leaves the list: unsaved edits of a removed item are moot.
    if (!keepTracking) baseline.value = JSON.stringify(form.value);
    buyQuantity.value = 1;
    emit('purchased', result, keepTracking);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    purchasing.value = null;
  }
}

function remove() {
  const item = props.item;
  if (!item) return;
  confirm.require({
    message: `Stop tracking "${item.name}"?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Stop tracking', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.del(`/api/${props.kind === 'card' ? 'cards' : 'sealed'}/${item.id}`);
        baseline.value = JSON.stringify(form.value);
        emit('deleted', item);
      } catch (e) {
        error.value = (e as Error).message;
      }
    },
  });
}
</script>

<template>
  <Drawer
    v-model:visible="visible"
    position="right"
    class="item-drawer"
    :block-scroll="true"
    :aria-label="item?.name ?? 'Details'"
  >
    <template #container="{ closeCallback }">
      <div v-if="item" class="drawer">
        <header class="head">
          <img v-if="image" :src="image" :alt="item.name" class="image" :class="kind" />
          <div v-else class="image placeholder" :class="kind" aria-hidden="true"></div>
          <div class="head-text">
            <div class="head-top">
              <span class="context">{{ context }}</span>
              <Button icon="pi pi-times" text rounded severity="secondary" aria-label="Close" class="close" @click="closeCallback" />
            </div>
            <h2 class="name">{{ item.name }}</h2>
            <div class="head-links">
              <StatusPill :status="status" />
              <a :href="cardTraderUrl" target="_blank" rel="noopener">Open on CardTrader <i class="pi pi-external-link" aria-hidden="true"></i></a>
            </div>
          </div>
        </header>

        <div class="figures three">
          <div>
            <div class="figure-label">Start price</div>
            <div class="figure mono">{{ start ? formatEuro(start.cents) : '—' }}</div>
            <div class="figure-sub">{{ start ? start.sub : 'set by the first price found' }}</div>
          </div>
          <div>
            <div class="figure-label">CT Zero price</div>
            <div class="figure mono">{{ item.lastPriceCents === null ? '—' : formatEuro(item.lastPriceCents) }}</div>
            <div class="figure-sub">{{ listing }}</div>
          </div>
          <div>
            <div class="figure-label">Your target</div>
            <div class="figure mono">{{ formatEuro(item.thresholdCents) }}</div>
            <div class="figure-sub" :class="{ under: gap?.under }">{{ gapSentence(item) }}</div>
          </div>
        </div>

        <div class="section">
          <PriceHistoryChart :kind="kind" :id="item.id" :refresh-key="refreshKey" />
        </div>

        <section class="section purchase" aria-labelledby="drawer-buy-title">
          <div class="section-head">
            <h3 id="drawer-buy-title" class="section-title">Bought some?</h3>
            <RouterLink to="/purchases" class="hint">recorded in Purchases</RouterLink>
          </div>
          <div class="purchase-form">
            <div class="field">
              <label for="drawer-paid" class="field-label">Paid each</label>
              <InputNumber
                v-model="paidEuro"
                input-id="drawer-paid"
                mode="currency"
                currency="EUR"
                locale="en-US"
                :min="0.01"
                placeholder="Price paid"
                class="target-input"
              />
            </div>
            <div class="field">
              <label for="drawer-qty" class="field-label">Copies</label>
              <InputNumber
                v-model="buyQuantity"
                input-id="drawer-qty"
                show-buttons
                button-layout="horizontal"
                :min="1"
                :max="999"
                :allow-empty="false"
                increment-button-icon="pi pi-plus"
                decrement-button-icon="pi pi-minus"
                class="qty-input"
              />
            </div>
          </div>
          <div v-if="savingPreview" class="purchase-line">{{ savingPreview }}</div>

          <div v-if="progress" class="progress">
            <div class="progress-head">
              <span>{{ item.boughtQuantity }} of {{ item.quantityNeeded }} copies bought</span>
              <span class="mono hint">after this: {{ item.boughtQuantity + quantity }}/{{ item.quantityNeeded }}</span>
            </div>
            <div class="progress-bar" aria-hidden="true">
              <span :style="{ width: `${progress.pct}%` }"></span>
              <span class="adding" :style="{ width: `${addingPct}%` }"></span>
            </div>
          </div>
          <div v-if="completes" class="complete-note">
            With these you have all {{ item.quantityNeeded }} copies: stopping the tracking is suggested.
          </div>

          <div class="purchase-actions">
            <Button
              v-for="a in buyActions"
              :key="String(a.keep)"
              :label="a.label"
              :severity="a.primary ? undefined : 'secondary'"
              :outlined="!a.primary"
              :loading="purchasing === a.keep"
              :disabled="!canBuy"
              @click="buy(a.keep)"
            />
          </div>
          <div class="hint">Stop tracking moves the {{ noun }} to Purchases with its history; keep tracking if you need more copies.</div>

          <div v-if="itemPurchases.length > 0" class="item-purchases">
            <div class="field-label">Purchases of this {{ noun }}</div>
            <RouterLink
              v-for="p in itemPurchases"
              :key="p.id"
              :to="{ path: '/purchases', query: { item: String(p.id) } }"
              class="item-purchase"
            >
              <span>
                {{ p.quantity }} cop{{ p.quantity === 1 ? 'y' : 'ies' }} · <span class="mono">{{ formatEuro(p.pricePaidCents) }}</span> each ·
                {{ dayInText(p.purchasedAt, new Date()) }}
              </span>
              <span :class="{ under: (p.savedCents ?? 0) > 0 }">{{ savingText(p.savedCents) ?? 'No start price' }} →</span>
            </RouterLink>
          </div>
        </section>

        <div class="section">
          <label for="drawer-target" class="section-title">Alert me at or under</label>
          <InputNumber
            v-model="form.targetEuro"
            input-id="drawer-target"
            mode="currency"
            currency="EUR"
            locale="en-US"
            :min="MIN_THRESHOLD_CENTS / 100"
            class="target-input"
          />
          <div class="presets">
            <Button
              v-for="p in presets"
              :key="p.label"
              size="small"
              severity="secondary"
              outlined
              rounded
              class="preset"
              :aria-label="`Set target to ${formatEuro(p.cents)}`"
              @click="form.targetEuro = p.cents / 100"
            >
              {{ p.label }} <span class="mono preset-value">{{ formatEuro(p.cents) }}</span>
            </Button>
          </div>
        </div>

        <div class="section">
          <div class="section-head">
            <label for="drawer-needed" class="section-title">Copies needed</label>
            <div class="hint">shows how many you bought, e.g. 1/4</div>
          </div>
          <InputNumber
            v-model="form.quantityNeeded"
            input-id="drawer-needed"
            :min="1"
            :max="999"
            placeholder="Not set"
            class="target-input"
          />
        </div>

        <div class="section">
          <div class="section-head">
            <div class="section-title">Which offers count</div>
            <div class="hint">changing these re-prices the {{ noun }} and resets its start price</div>
          </div>
          <template v-if="kind === 'card'">
            <div class="rule">
              <label for="drawer-expansions">Expansions</label>
              <MultiSelect
                v-model="form.expansionIds"
                input-id="drawer-expansions"
                :options="expansionOptions"
                option-label="expansionName"
                option-value="expansionId"
                placeholder="Any expansion"
                :max-selected-labels="2"
                selected-items-label="{0} expansions"
                filter
                :loading="!lookup && !error"
                class="rule-control"
              />
            </div>
            <div class="rule">
              <label for="drawer-languages">Languages</label>
              <MultiSelect
                v-model="form.languages"
                input-id="drawer-languages"
                :options="languageOptions"
                option-label="label"
                option-value="code"
                placeholder="Any language"
                :max-selected-labels="2"
                selected-items-label="{0} languages"
                class="rule-control"
              />
            </div>
            <div class="rule">
              <label for="drawer-condition">Minimum condition</label>
              <Select v-model="form.minCondition" input-id="drawer-condition" :options="conditionOptions" class="rule-control" />
            </div>
            <div class="rule">
              <label for="drawer-foil">Finish</label>
              <Select
                v-model="finish"
                input-id="drawer-foil"
                :options="FINISH_OPTIONS"
                option-label="label"
                option-value="value"
                class="rule-control"
              />
            </div>
            <div class="rule">
              <label for="drawer-group">Group</label>
              <Select
                v-model="form.groupId"
                input-id="drawer-group"
                :options="groups"
                option-label="name"
                option-value="id"
                placeholder="No group"
                show-clear
                class="rule-control"
              />
            </div>
          </template>
          <template v-else>
            <div class="rule">
              <span class="rule-label">Category</span>
              <span class="rule-static">{{ sealed?.categoryName }}</span>
            </div>
            <div class="rule">
              <label for="drawer-sealed-languages">Languages</label>
              <MultiSelect
                v-model="form.languages"
                input-id="drawer-sealed-languages"
                :options="languageOptions"
                option-label="label"
                option-value="code"
                placeholder="Any language"
                :max-selected-labels="2"
                selected-items-label="{0} languages"
                class="rule-control"
              />
            </div>
          </template>
        </div>

        <Message v-if="error" severity="error" class="error">{{ error }}</Message>

        <footer class="foot">
          <Button label="Stop tracking" icon="pi pi-trash" text severity="danger" @click="remove" />
          <div class="foot-right">
            <span class="checked" v-tooltip.top="item.lastSyncStatus === 'error' ? (item.lastError ?? undefined) : undefined">{{ checked }}</span>
            <Button label="Save changes" :disabled="!canSave" :loading="saving" @click="save" />
          </div>
        </footer>
      </div>
    </template>
  </Drawer>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  background: var(--ct-panel);
}
.head {
  display: flex;
  gap: 16px;
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--ct-line);
}
.image {
  flex: none;
  width: 80px;
  border-radius: 5px;
  align-self: flex-start;
}
.image.sealed {
  width: 112px;
  height: 112px;
  object-fit: contain;
  border-radius: 12px;
  background: var(--ct-chip);
}
.image.placeholder {
  height: 112px;
  background: var(--ct-chip);
}
.head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.head-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.context {
  font-size: 12px;
  color: var(--ct-muted);
}
.close {
  margin: -8px -8px 0 0;
}
.name {
  font-size: 21px;
}
.head-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.head-links a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
}
.head-links a i {
  font-size: 11px;
}
.figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 20px 24px;
}
.figure-label {
  font-size: 12.5px;
  color: var(--ct-muted);
}
.figure {
  font-size: 28px;
  font-weight: 500;
}
.figures.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.figures.three .figure {
  font-size: 22px;
}
.purchase {
  background: var(--ct-bg);
}
.purchase h3.section-title {
  margin: 0;
  font-size: inherit;
}
.purchase-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-label {
  font-size: 12.5px;
  color: var(--ct-muted);
}
.qty-input :deep(input) {
  width: 3.5rem;
  text-align: center;
  font-family: var(--ct-mono);
  font-size: 16px;
}
.purchase-line {
  margin-top: 10px;
  font-size: 13.5px;
  color: var(--ct-accent-text);
}
.progress {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.progress-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.progress-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  background: var(--ct-line);
  overflow: hidden;
}
.progress-bar span {
  height: 100%;
  background: var(--ct-accent);
}
.progress-bar .adding {
  opacity: 0.45;
}
.complete-note {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--ct-accent-soft);
  font-size: 13px;
}
.purchase-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0 6px;
}
.item-purchases {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-purchase {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--ct-line);
  border-radius: 8px;
  color: var(--ct-ink);
  font-size: 13.5px;
  text-decoration: none;
}
.item-purchase:hover {
  border-color: var(--ct-line-strong);
}
.item-purchase .under {
  color: var(--ct-accent-text);
}
.figure-sub {
  font-size: 12.5px;
  color: var(--ct-muted);
}
.figure-sub.under {
  color: var(--ct-accent-text);
}
.section {
  padding: 18px 24px;
  border-top: 1px solid var(--ct-line);
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
}
.section-title {
  display: block;
  font-weight: 600;
}
.section > .section-title {
  margin-bottom: 10px;
}
.hint {
  font-size: 12px;
  color: var(--ct-muted);
}
.target-input :deep(input) {
  width: 11rem;
  font-family: var(--ct-mono);
  font-size: 16px;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.preset-value {
  margin-left: 4px;
  opacity: 0.75;
}
.rule {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  border-top: 1px solid var(--ct-line);
}
.rule:first-of-type {
  border-top: 0;
}
.rule label,
.rule-label {
  font-size: 13px;
  color: var(--ct-muted);
}
.rule-control {
  width: 15.5rem;
  max-width: 62%;
}
.rule-static {
  font-size: 13.5px;
}
.error {
  margin: 0 24px 12px;
}
.foot {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid var(--ct-line);
  background: var(--ct-panel);
  position: sticky;
  bottom: 0;
}
.foot-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.checked {
  font-size: 12px;
  color: var(--ct-muted);
}
</style>

<style>
/* Doubled class: PrimeVue's own `.p-drawer-right .p-drawer` width would win otherwise. */
.p-drawer.item-drawer.item-drawer {
  width: 500px;
  max-width: 100vw;
  border-left: 1px solid var(--ct-line);
  background: var(--ct-panel);
}
</style>
