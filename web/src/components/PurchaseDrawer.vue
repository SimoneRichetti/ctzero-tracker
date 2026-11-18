<script setup lang="ts">
import { formatEuro, type PriceHistoryDto, type PurchaseDetail, type PurchaseRecord, type PurchaseResult, type TrackedCard, type TrackedSealed } from '@ctzero/shared';
import Button from 'primevue/button';
import Drawer from 'primevue/drawer';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { useConfirm } from 'primevue/useconfirm';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { latestRequest } from '../latest-request';
import { anyExpansion, largeImageUrl, listingLine } from '../row-format';
import { dayInText } from '../time-format';
import PriceHistoryChart from './PriceHistoryChart.vue';

/** `purchase` null = closed. The page owns which purchase is open (`?item=` in the route). */
const props = defineProps<{ purchase: PurchaseRecord | null }>();
const emit = defineEmits<{
  close: [];
  deleted: [purchase: PurchaseRecord];
  tracked: [result: PurchaseResult<TrackedCard | TrackedSealed>];
}>();
const confirm = useConfirm();

const detail = ref<PurchaseDetail | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const request = latestRequest();

// The history is only in the detail: fetched for each purchase opened.
watch(
  () => props.purchase?.id,
  async (id) => {
    detail.value = null;
    error.value = null;
    if (id === undefined) return;
    const isLatest = request.start();
    try {
      const data = await api.get<PurchaseDetail>(`/api/purchases/${id}`);
      if (isLatest()) detail.value = data;
    } catch (e) {
      if (isLatest()) error.value = (e as Error).message;
    }
  },
  { immediate: true },
);

const visible = computed({
  get: () => props.purchase !== null,
  set: (open: boolean) => {
    if (!open) emit('close');
  },
});

const noun = computed(() => (props.purchase?.kind === 'sealed' ? 'product' : 'card'));
const tracked = computed(() => props.purchase?.itemId != null);
const context = computed(() => {
  const p = props.purchase;
  if (!p) return '';
  const kind = p.kind === 'card' ? 'Card' : 'Sealed product';
  return p.groupName ? `Purchase · ${kind} · was in ${p.groupName}` : `Purchase · ${kind}`;
});
const image = computed(() => {
  const p = props.purchase;
  return p?.imageUrl ? largeImageUrl(p.kind, p.imageUrl) : null;
});
const when = computed(() => (props.purchase ? dayInText(props.purchase.purchasedAt, new Date(), 'on ') : ''));
const copies = computed(() => {
  const n = props.purchase?.quantity ?? 1;
  return `${n} cop${n === 1 ? 'y' : 'ies'}`;
});

/** The chart of the frozen history: the target of the time, a single configuration. */
const frozen = computed<PriceHistoryDto | undefined>(() => {
  const d = detail.value;
  if (!d) return undefined;
  return {
    thresholdCents: d.thresholdCents ?? 0,
    configVersion: 1,
    points: d.points.map((p) => ({ ...p, configVersion: 1 })),
  };
});

const rules = computed(() => {
  const p = props.purchase;
  const r = p?.rules;
  if (!p || !r) return [];
  const languages = r.languages.length > 0 ? r.languages.map((l) => l.toUpperCase()).join(', ') : 'Any language';
  const rows =
    r.kind === 'card'
      ? [
          {
            label: 'Expansions',
            value: r.expansionNames.length > 0 ? r.expansionNames.join(', ') : anyExpansion(r.excludedExpansions ?? [], true),
          },
          { label: 'Languages', value: languages },
          { label: 'Minimum condition', value: r.minCondition },
          { label: 'Finish', value: r.foil === null ? 'Any finish' : r.foil ? 'Foil' : 'Non-foil' },
        ]
      : [
          { label: 'Product', value: `${r.expansionName} · ${r.categoryName}` },
          { label: 'Languages', value: languages },
        ];
  return rows;
});
const offer = computed(() => {
  const p = props.purchase;
  return p?.listing ? { text: listingLine(p.kind, p.listing) ?? '', url: p.listing.url } : null;
});
const itemLink = computed(() => {
  const p = props.purchase;
  return p?.itemId != null ? { path: p.kind === 'card' ? '/cards' : '/sealed', query: { item: String(p.itemId) } } : null;
});

async function trackAgain() {
  const p = props.purchase;
  if (!p || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    emit('tracked', await api.post<PurchaseResult<TrackedCard | TrackedSealed>>(`/api/purchases/${p.id}/track-again`, {}));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function remove() {
  const p = props.purchase;
  if (!p) return;
  confirm.require({
    message: `Delete this purchase of "${p.name}"? Its saving no longer counts in the totals.`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete purchase', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.del(`/api/purchases/${p.id}`);
        emit('deleted', p);
      } catch (e) {
        error.value = (e as Error).message;
      }
    },
  });
}
</script>

<template>
  <Drawer v-model:visible="visible" position="right" class="item-drawer" :block-scroll="true" :aria-label="purchase?.name ?? 'Purchase'">
    <template #container="{ closeCallback }">
      <div v-if="purchase" class="drawer">
        <header class="head">
          <img v-if="image" :src="image" :alt="purchase.name" class="image" :class="purchase.kind" />
          <div v-else class="image placeholder" :class="purchase.kind" aria-hidden="true"></div>
          <div class="head-text">
            <div class="head-top">
              <span class="context">{{ context }}</span>
              <Button icon="pi pi-times" text rounded severity="secondary" aria-label="Close" class="close" @click="closeCallback" />
            </div>
            <h2 class="name">{{ purchase.name }}</h2>
            <div class="head-links">
              <span class="state" :class="{ archived: !tracked }">{{ tracked ? 'Still tracked' : 'Archived' }}</span>
              <span class="muted">Bought {{ when }}{{ tracked ? '' : ' · no longer tracked' }}</span>
            </div>
          </div>
        </header>

        <div class="saved-banner" :class="{ worse: (purchase.savedCents ?? 0) < 0, unknown: purchase.savedCents === null }">
          <div>
            <div class="saved-label">{{ purchase.savedCents !== null && purchase.savedCents < 0 ? 'Paid more' : 'Saved' }}</div>
            <div class="saved-value mono">{{ purchase.savedCents === null ? '—' : formatEuro(Math.abs(purchase.savedCents)) }}</div>
          </div>
          <div class="saved-how">
            <template v-if="purchase.startPriceCents !== null">
              {{ formatEuro(purchase.startPriceCents) }} start − {{ formatEuro(purchase.pricePaidCents) }} paid<br />× {{ copies }}
            </template>
            <template v-else>No start price was recorded:<br />this purchase adds nothing to the savings.</template>
          </div>
        </div>

        <div class="figures">
          <div>
            <div class="figure-label">Start price</div>
            <div class="figure mono">{{ purchase.startPriceCents === null ? '—' : formatEuro(purchase.startPriceCents) }}</div>
            <div class="figure-sub">{{ purchase.startPriceAt ? `since ${dayInText(purchase.startPriceAt, new Date())}` : 'never priced' }}</div>
          </div>
          <div>
            <div class="figure-label">Paid each</div>
            <div class="figure mono">{{ formatEuro(purchase.pricePaidCents) }}</div>
            <div class="figure-sub">{{ purchase.marketPriceCents === null ? copies : `market then ${formatEuro(purchase.marketPriceCents)}` }}</div>
          </div>
          <div>
            <div class="figure-label">Target then</div>
            <div class="figure mono">{{ purchase.thresholdCents === null ? '—' : formatEuro(purchase.thresholdCents) }}</div>
            <div class="figure-sub">alert at or under</div>
          </div>
        </div>

        <div class="section">
          <PriceHistoryChart v-if="frozen" :kind="purchase.kind" :id="purchase.id" refresh-key="" :frozen="frozen" />
          <div v-else-if="!error" class="loading"><ProgressSpinner style="width: 28px; height: 28px" stroke-width="5" /></div>
        </div>

        <div v-if="rules.length > 0 || offer" class="section">
          <div class="section-title">Rules when bought</div>
          <div v-for="r in rules" :key="r.label" class="rule">
            <span class="rule-label">{{ r.label }}</span>
            <span>{{ r.value }}</span>
          </div>
          <div v-if="offer" class="rule">
            <span class="rule-label">Offer at purchase</span>
            <span>{{ offer.text }} · <a :href="offer.url" target="_blank" rel="noopener">CardTrader <i class="pi pi-external-link" aria-hidden="true"></i></a></span>
          </div>
        </div>

        <Message v-if="error" severity="error" class="error">{{ error }}</Message>

        <footer class="foot">
          <Button label="Delete purchase" icon="pi pi-trash" text severity="danger" @click="remove" />
          <RouterLink v-if="itemLink" :to="itemLink" custom v-slot="{ navigate }">
            <Button :label="`Open tracked ${noun}`" icon="pi pi-arrow-right" icon-pos="right" severity="secondary" outlined @click="navigate" />
          </RouterLink>
          <div v-else class="track-again">
            <Button label="Track again" icon="pi pi-replay" :loading="busy" :disabled="!purchase.rules" @click="trackAgain" />
            <span class="hint">{{ purchase.rules ? 'same rules, target and history' : 'the rules were not recorded' }}</span>
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
.context,
.muted {
  font-size: 12.5px;
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
}
.state {
  padding: 1px 8px;
  border-radius: 6px;
  background: var(--ct-chip);
  font-size: 12px;
  font-weight: 600;
}
.state.archived {
  background: var(--ct-warn-soft);
  color: var(--ct-warn);
}
.saved-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 0 24px 20px;
  padding: 14px 18px;
  border-radius: 12px;
  background: var(--ct-accent-soft);
  color: var(--ct-accent-text);
}
.saved-banner.worse {
  background: var(--ct-warn-soft);
  color: var(--ct-warn);
}
.saved-banner.unknown {
  background: var(--ct-chip);
  color: var(--ct-ink);
}
.saved-label {
  font-size: 12.5px;
  font-weight: 600;
}
.saved-value {
  font-size: 28px;
  font-weight: 500;
}
.saved-how {
  font-size: 13px;
  text-align: right;
  color: var(--ct-ink);
}
.figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 20px 24px;
  border-top: 1px solid var(--ct-line);
}
.figure-label,
.figure-sub {
  font-size: 12.5px;
  color: var(--ct-muted);
}
.figure {
  font-size: 22px;
  font-weight: 500;
}
.section {
  padding: 18px 24px;
  border-top: 1px solid var(--ct-line);
}
.section-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}
.rule {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  border-top: 1px solid var(--ct-line);
  font-size: 13.5px;
  text-align: right;
}
.rule:nth-child(2) {
  border-top: 0;
}
.rule-label {
  flex: none;
  font-size: 13px;
  color: var(--ct-muted);
  text-align: left;
}
.rule a {
  text-decoration: none;
}
.rule a i {
  font-size: 11px;
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
.track-again {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.hint {
  font-size: 12px;
  color: var(--ct-muted);
}
</style>
