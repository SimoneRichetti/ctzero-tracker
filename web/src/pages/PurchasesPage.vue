<script setup lang="ts">
import { formatEuro, type PurchaseRecord, type PurchaseResult, type TrackedCard, type TrackedSealed } from '@ctzero/shared';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { useToast } from 'primevue/usetoast';
import { computed, ref } from 'vue';
import { useCatalog } from '../catalog';
import PurchaseDrawer from '../components/PurchaseDrawer.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import { linkToast } from '../link-toast';
import { useOpenItem } from '../open-item';
import { filterPurchases, purchaseTotals, type TrackingFilter } from '../purchase-summary';
import { purchaseMetaLine, savingText } from '../row-format';
import { dayLabel } from '../time-format';

const toast = useToast();
const { purchases, loading, loaded, reloadPurchases, reloadCardsAndGroups, reloadSealed } = useCatalog();

const items = computed(() => purchases.value?.items ?? []);
const totals = computed(() => purchaseTotals(items.value));
const kinds = computed(() => ({
  card: items.value.filter((p) => p.kind === 'card'),
  sealed: items.value.filter((p) => p.kind === 'sealed'),
}));
const stillTracked = computed(() => items.value.filter((p) => p.itemId !== null).length);
const copiesOf = (list: PurchaseRecord[]) => list.reduce((n, p) => n + p.quantity, 0);

const kind = ref<'all' | 'card' | 'sealed'>('all');
const tracking = ref<TrackingFilter>('any');
const kindOptions = computed(() => [
  { value: 'all' as const, label: 'All', count: items.value.length },
  { value: 'card' as const, label: 'Cards', count: kinds.value.card.length },
  { value: 'sealed' as const, label: 'Sealed', count: kinds.value.sealed.length },
]);
const trackingOptions: { value: TrackingFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'tracked', label: 'Still tracked' },
  { value: 'archived', label: 'Archived' },
];
const rows = computed(() => filterPurchases(items.value, kind.value, tracking.value));

const { openId, openItem, open, close } = useOpenItem(items, () => loaded.purchases);

const rowClass = (p: PurchaseRecord) => (p.id === openId.value ? 'is-open' : undefined);
const savedClass = (p: PurchaseRecord) => (p.savedCents === null ? 'unknown' : p.savedCents > 0 ? 'under' : p.savedCents < 0 ? 'over' : '');

function onDeleted(p: PurchaseRecord) {
  toast.add({ severity: 'success', summary: `Purchase of ${p.name} deleted`, life: 3000 });
  close();
  void reloadPurchases();
  void (p.kind === 'card' ? reloadCardsAndGroups() : reloadSealed());
}

function onTracked(result: PurchaseResult<TrackedCard | TrackedSealed>) {
  const p = result.purchase;
  const to = { path: p.kind === 'card' ? '/cards' : '/sealed', query: { item: String(result.item?.id ?? '') } };
  toast.add(linkToast(`${p.name} is tracked again`, 'Same rules, target and history', { to, label: 'Open' }));
  void reloadPurchases();
  void (p.kind === 'card' ? reloadCardsAndGroups() : reloadSealed());
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="eyebrow">Archive</div>
        <h1 class="page-title">Purchases</h1>
        <p class="lead">Every card and product you bought, frozen as it was when you bought it.</p>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi saved">
        <div class="kpi-label">Saved</div>
        <div class="kpi-value mono">{{ formatEuro(totals.savedCents) }}</div>
        <div class="kpi-sub">on the start prices</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Spent</div>
        <div class="kpi-value mono">{{ formatEuro(totals.spentCents) }}</div>
        <div class="kpi-sub">price paid × copies</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Copies</div>
        <div class="kpi-value mono">{{ totals.copies }}</div>
        <div class="kpi-sub">{{ copiesOf(kinds.card) }} cards · {{ copiesOf(kinds.sealed) }} sealed</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Purchases</div>
        <div class="kpi-value mono">{{ totals.count }}</div>
        <div class="kpi-sub">{{ stillTracked }} still tracked · {{ totals.count - stillTracked }} archived</div>
      </div>
    </div>

    <div class="toolbar">
      <SegmentedControl v-model="kind" :options="kindOptions" label="Filter by kind" />
      <SegmentedControl v-model="tracking" :options="trackingOptions" label="Filter by tracking" />
    </div>

    <DataTable :value="rows" :loading="loading.purchases && items.length === 0" data-key="id" :row-class="rowClass" class="ct-table" scrollable>
      <template #empty>
        {{ items.length === 0 ? 'No purchases yet. Record one from the detail panel of a card or product: "Bought some?".' : 'Nothing matches these filters.' }}
      </template>
      <Column header="Bought">
        <template #body="{ data }">
          <div class="item">
            <img v-if="data.imageUrl" :src="data.imageUrl" :alt="data.name" class="thumb" :class="data.kind" loading="lazy" />
            <div v-else class="thumb placeholder" :class="data.kind" aria-hidden="true"></div>
            <div class="item-text">
              <div class="item-title">
                <button type="button" class="item-name" @click="open(data.id)">{{ data.name }}</button>
                <span class="state" :class="{ archived: data.itemId === null }">{{ data.itemId === null ? 'Archived' : 'Still tracked' }}</span>
              </div>
              <div class="item-meta">{{ purchaseMetaLine(data) }}</div>
            </div>
          </div>
        </template>
      </Column>
      <Column header="Paid each" style="width: 8rem">
        <template #body="{ data }"><span class="mono">{{ formatEuro(data.pricePaidCents) }}</span></template>
      </Column>
      <Column header="Qty" style="width: 5rem">
        <template #body="{ data }"><span class="mono">× {{ data.quantity }}</span></template>
      </Column>
      <Column header="Start price" style="width: 8rem">
        <template #body="{ data }">
          <span class="mono muted">{{ data.startPriceCents === null ? '—' : formatEuro(data.startPriceCents) }}</span>
        </template>
      </Column>
      <Column header="Saved" style="width: 10rem">
        <template #body="{ data }">
          <span class="saved-cell" :class="savedClass(data)">{{ savingText(data.savedCents) ?? 'No start price' }}</span>
        </template>
      </Column>
      <Column header="When" style="width: 7rem">
        <template #body="{ data }"><span class="muted">{{ dayLabel(data.purchasedAt, new Date()) }}</span></template>
      </Column>
      <Column style="width: 3.5rem">
        <template #header><span class="visually-hidden">Open</span></template>
        <template #body="{ data }">
          <button type="button" class="open" :aria-label="`Open the purchase of ${data.name}`" @click="open(data.id)">
            <i class="pi pi-angle-right" aria-hidden="true"></i>
          </button>
        </template>
      </Column>
    </DataTable>
  </div>

  <PurchaseDrawer :purchase="openItem" @close="close" @deleted="onDeleted" @tracked="onTracked" />
</template>

<style scoped>
.lead {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--ct-muted);
}
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1px;
  margin-bottom: 20px;
  background: var(--ct-line);
  border: 1px solid var(--ct-line);
  border-radius: 14px;
  overflow: hidden;
}
.kpi {
  padding: 16px 20px;
  background: var(--ct-panel);
}
.kpi.saved {
  background: var(--ct-accent-soft);
}
.kpi-label {
  font-size: 12.5px;
  color: var(--ct-muted);
}
.kpi.saved .kpi-label,
.kpi.saved .kpi-value {
  color: var(--ct-accent-text);
  font-weight: 600;
}
.kpi-value {
  margin-top: 2px;
  font-size: 26px;
  font-weight: 500;
}
.kpi-sub {
  font-size: 12px;
  color: var(--ct-muted);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.thumb {
  flex: none;
  width: 36px;
  height: 50px;
  object-fit: cover;
  border-radius: 3px;
}
.thumb.sealed {
  width: 50px;
  height: 50px;
  object-fit: contain;
  border-radius: 8px;
  background: var(--ct-chip);
}
.thumb.placeholder {
  background: var(--ct-chip);
}
.item-text {
  min-width: 0;
}
.item-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.item-name {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ct-ink);
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.item-name:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.item-meta {
  font-size: 12.5px;
  color: var(--ct-muted);
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
.muted {
  color: var(--ct-muted);
}
.saved-cell {
  font-weight: 500;
}
.saved-cell.under {
  color: var(--ct-accent-text);
}
.saved-cell.over {
  color: var(--ct-warn);
}
.saved-cell.unknown {
  color: var(--ct-muted);
  font-weight: 400;
}
.open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ct-muted);
  cursor: pointer;
}
.open:hover {
  background: var(--ct-chip);
  color: var(--ct-ink);
}
</style>
