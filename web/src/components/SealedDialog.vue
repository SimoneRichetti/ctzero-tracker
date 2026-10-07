<script setup lang="ts">
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  euroToCents,
  formatEuro,
  type Expansion,
  type Language,
  type PreviewResult,
  type SealedProduct,
  type TrackedSealed,
} from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { latestRequest } from '../latest-request';

type Mode = 'expansion' | 'link';

const props = defineProps<{ item: TrackedSealed | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [item: TrackedSealed] }>();

const mode = ref<Mode>('expansion');
const expansions = ref<Expansion[]>([]);
const expansionId = ref<number | null>(null);
const products = ref<SealedProduct[]>([]);
const product = ref<SealedProduct | null>(null);
const link = ref('');
const languages = ref<Language[]>([]);
const preview = ref<PreviewResult | null>(null);
const thresholdEuro = ref<number | null>(null);
const error = ref<string | null>(null);
const loadingProducts = ref(false);
const resolving = ref(false);
const loadingPreview = ref(false);
const saving = ref(false);

// Responses that arrive after the selection changed are discarded.
const catalogRequest = latestRequest();
const resolveRequest = latestRequest();
const previewRequest = latestRequest();

const isEdit = computed(() => props.item !== null);
const modeOptions = [
  { label: 'From expansion', value: 'expansion' },
  { label: 'From link', value: 'link' },
];
const languageOptions = LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));
const canSave = computed(() => product.value !== null && thresholdEuro.value !== null && thresholdEuro.value > 0);

watch(visible, (open) => {
  if (open) void reset();
});

// A preview computed for another product or other languages is no longer valid.
watch([product, languages], () => {
  previewRequest.cancel();
  loadingPreview.value = false;
  preview.value = null;
});

watch(mode, () => {
  if (isEdit.value) return;
  resolveRequest.cancel();
  resolving.value = false;
  product.value = null;
  error.value = null;
});

watch(expansionId, async (id) => {
  if (isEdit.value) return;
  const isCurrent = catalogRequest.start();
  product.value = null;
  products.value = [];
  loadingProducts.value = false;
  if (id === null) return;
  loadingProducts.value = true;
  error.value = null;
  try {
    const list = await api.get<SealedProduct[]>(`/api/sealed/catalog?expansionId=${id}`);
    if (isCurrent()) products.value = list;
  } catch (e) {
    if (isCurrent()) error.value = (e as Error).message;
  } finally {
    if (isCurrent()) loadingProducts.value = false;
  }
});

async function reset() {
  const s = props.item;
  error.value = null;
  mode.value = 'expansion';
  link.value = '';
  products.value = [];
  preview.value = null;
  languages.value = s ? [...s.languages] : [];
  thresholdEuro.value = s ? s.thresholdCents / 100 : null;
  if (s) {
    expansionId.value = s.expansionId;
    product.value = {
      blueprintId: s.blueprintId,
      name: s.name,
      expansionId: s.expansionId,
      expansionName: s.expansionName,
      categoryName: s.categoryName,
      imageUrl: s.imageUrl,
    };
    return;
  }
  expansionId.value = null;
  product.value = null;
  if (expansions.value.length === 0) {
    try {
      expansions.value = await api.get<Expansion[]>('/api/expansions');
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
}

async function resolveLink() {
  const isCurrent = resolveRequest.start();
  resolving.value = true;
  error.value = null;
  product.value = null;
  try {
    const resolved = await api.get<SealedProduct>(`/api/sealed/resolve?ref=${encodeURIComponent(link.value)}`);
    if (isCurrent()) product.value = resolved;
  } catch (e) {
    if (isCurrent()) error.value = (e as Error).message;
  } finally {
    if (isCurrent()) resolving.value = false;
  }
}

async function calculate() {
  if (!product.value) return;
  const isCurrent = previewRequest.start();
  loadingPreview.value = true;
  error.value = null;
  try {
    const result = await api.post<PreviewResult>('/api/sealed/preview', {
      blueprintId: product.value.blueprintId,
      expansionId: product.value.expansionId,
      languages: languages.value,
    });
    if (isCurrent()) preview.value = result;
  } catch (e) {
    if (isCurrent()) error.value = (e as Error).message;
  } finally {
    if (isCurrent()) loadingPreview.value = false;
  }
}

async function save() {
  if (!canSave.value || !product.value || thresholdEuro.value === null) return;
  saving.value = true;
  error.value = null;
  const payload = { languages: languages.value, thresholdCents: euroToCents(thresholdEuro.value) };
  try {
    const saved = props.item
      ? await api.put<TrackedSealed>(`/api/sealed/${props.item.id}`, payload)
      : await api.post<TrackedSealed>('/api/sealed', {
          blueprintId: product.value.blueprintId,
          expansionId: product.value.expansionId,
          ...payload,
        });
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
    :header="isEdit ? 'Edit sealed product' : 'Add sealed product'"
    :style="{ width: '46rem' }"
  >
    <template v-if="!isEdit">
      <div class="field">
        <SelectButton v-model="mode" :options="modeOptions" option-label="label" option-value="value" :allow-empty="false" />
      </div>

      <div v-if="mode === 'expansion'">
        <div class="field">
          <label for="expansion">Expansion</label>
          <Select
            v-model="expansionId"
            input-id="expansion"
            :options="expansions"
            option-label="name"
            option-value="id"
            placeholder="Search an expansion"
            filter
            :virtual-scroller-options="{ itemSize: 38 }"
            fluid
          />
        </div>
        <div v-if="expansionId !== null" class="field">
          <label for="product">Product</label>
          <Select
            v-model="product"
            input-id="product"
            :options="products"
            option-label="name"
            data-key="blueprintId"
            :loading="loadingProducts"
            placeholder="Select a product"
            empty-message="No sealed products for this expansion"
            filter
            fluid
          >
            <template #option="{ option }">
              <div class="product-option">
                <img v-if="option.imageUrl" :src="option.imageUrl" :alt="option.name" />
                <div>
                  <div>{{ option.name }}</div>
                  <small class="muted">{{ option.categoryName }}</small>
                </div>
              </div>
            </template>
          </Select>
        </div>
      </div>

      <div v-else class="field">
        <label for="link">CardTrader link or id</label>
        <div class="link-row">
          <InputText
            id="link"
            v-model="link"
            placeholder="https://www.cardtrader.com/en-EU/cards/389300-the-hobbit-play-booster-box-the-hobbit"
            fluid
            @keyup.enter="resolveLink"
          />
          <Button label="Find" icon="pi pi-search" :loading="resolving" :disabled="!link.trim()" @click="resolveLink" />
        </div>
      </div>
    </template>

    <div v-if="product" class="lookup">
      <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" class="sealed-thumb" />
      <div class="filters">
        <p>
          <strong>{{ product.name }}</strong><br />
          <span class="muted">{{ product.expansionName }} · {{ product.categoryName }}</span>
        </p>
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
      </div>
    </div>

    <div v-if="product" class="pricing">
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
          {{ preview.listing.language.toUpperCase() }}
          <a :href="preview.listing.url" target="_blank" rel="noopener">open</a>
        </p>
        <p v-else>No valid CT Zero offers right now.</p>
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
.sealed-thumb {
  width: 120px;
  border-radius: 6px;
}
.product-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.product-option img {
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.link-row {
  display: flex;
  gap: 0.5rem;
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
