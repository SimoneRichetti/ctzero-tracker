<script setup lang="ts">
import type { CardGroup } from '@ctzero/shared';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { useTheme } from '../theme';
import SyncStatus from './SyncStatus.vue';

const emit = defineEmits<{ navigate: [] }>();
const toast = useToast();
const router = useRouter();
const { groups, navCounts, reloadGroups } = useCatalog();
const { isDark, toggle } = useTheme();

const cardEntries = computed(() => [
  { to: '/cards', label: 'All cards', icon: 'pi pi-clone', counts: navCounts.value.cards.all },
  ...groups.value.map((g) => ({
    to: `/groups/${g.id}`,
    label: g.name,
    icon: 'pi pi-folder',
    counts: navCounts.value.cards.byGroup.get(g.id) ?? { count: g.cardCount, below: 0 },
  })),
  { to: '/cards/ungrouped', label: 'Ungrouped', icon: 'pi pi-inbox', counts: navCounts.value.cards.ungrouped },
]);

const creating = ref(false);
const newName = ref('');
const saving = ref(false);
const input = ref<{ $el: HTMLInputElement } | null>(null);

async function startCreate() {
  creating.value = true;
  newName.value = '';
  await nextTick();
  input.value?.$el.focus();
}

function cancelCreate() {
  creating.value = false;
}

async function create() {
  const name = newName.value.trim();
  if (!name || saving.value) return;
  saving.value = true;
  try {
    const group = await api.post<CardGroup>('/api/groups', { name });
    creating.value = false;
    await reloadGroups();
    await router.push(`/groups/${group.id}`);
    emit('navigate');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Group not created', detail: (e as Error).message, life: 5000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <rect x="3" y="5" width="13" height="18" rx="2.5" fill="none" stroke="var(--ct-muted)" stroke-width="1.6" />
        <rect x="9" y="2" width="13" height="18" rx="2.5" fill="var(--ct-accent)" />
      </svg>
      <span class="brand-text">
        <span class="brand-name">CTZero</span>
        <span class="brand-sub">Tracker</span>
      </span>
      <Button
        v-tooltip.bottom="isDark ? 'Light theme' : 'Dark theme'"
        :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
        :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
        text
        rounded
        severity="secondary"
        class="theme-toggle"
        @click="toggle"
      />
    </div>

    <SyncStatus />

    <div class="scroll">
      <nav aria-label="Cards" class="section">
        <div class="section-title">Cards</div>
        <RouterLink
          v-for="entry in cardEntries"
          :key="entry.to"
          :to="entry.to"
          class="nav-item"
          @click="emit('navigate')"
        >
          <i :class="entry.icon" aria-hidden="true"></i>
          <span class="label" v-tooltip.right="entry.label.length > 24 ? entry.label : undefined">{{ entry.label }}</span>
          <span v-if="entry.counts.below > 0" class="badge" :aria-label="`${entry.counts.below} below target`">{{ entry.counts.below }}</span>
          <span class="count mono">{{ entry.counts.count }}</span>
        </RouterLink>
        <form v-if="creating" class="new-group" @submit.prevent="create">
          <InputText
            ref="input"
            v-model="newName"
            size="small"
            placeholder="Group name"
            aria-label="New group name"
            maxlength="80"
            fluid
            :disabled="saving"
            @keyup.esc="cancelCreate"
            @blur="!newName.trim() && cancelCreate()"
          />
        </form>
        <button v-else type="button" class="new-group-btn" @click="startCreate">
          <i class="pi pi-plus" aria-hidden="true"></i>
          New group
        </button>
      </nav>

      <nav aria-label="Sealed" class="section">
        <div class="section-title">Sealed</div>
        <RouterLink to="/sealed" class="nav-item" @click="emit('navigate')">
          <i class="pi pi-box" aria-hidden="true"></i>
          <span class="label">Sealed products</span>
          <span v-if="navCounts.sealed.below > 0" class="badge" :aria-label="`${navCounts.sealed.below} below target`">{{ navCounts.sealed.below }}</span>
          <span class="count mono">{{ navCounts.sealed.count }}</span>
        </RouterLink>
      </nav>
    </div>

    <nav aria-label="Tools" class="section tools">
      <RouterLink to="/import" class="nav-item" @click="emit('navigate')">
        <i class="pi pi-upload" aria-hidden="true"></i>
        <span class="label">Import list</span>
      </RouterLink>
      <RouterLink to="/settings" class="nav-item" @click="emit('navigate')">
        <i class="pi pi-sliders-h" aria-hidden="true"></i>
        <span class="label">Settings</span>
      </RouterLink>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  height: 100%;
  box-sizing: border-box;
  padding: 16px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--ct-side);
  border-right: 1px solid var(--ct-line);
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 8px;
}
/* The two words have different sizes: align them on the baseline, not on the centre. */
.brand-text {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-left: 2px;
}
.brand-name {
  font-weight: 600;
  font-size: 16px;
  letter-spacing: -0.01em;
}
.brand-sub {
  font-size: 13px;
  color: var(--ct-muted);
}
.theme-toggle {
  margin-left: auto;
}
/* Only the navigation scrolls: the update status and the tools stay in view. */
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 0 -6px;
  padding: 2px 6px;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.section-title {
  padding: 0 10px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ct-muted);
}
.tools {
  flex: none;
  padding-top: 10px;
  border-top: 1px solid var(--ct-line);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--ct-ink);
  text-decoration: none;
}
.nav-item i {
  font-size: 14px;
  color: var(--ct-muted);
}
.nav-item:hover {
  background: var(--ct-chip);
}
.nav-item.router-link-exact-active {
  background: var(--ct-nav-active);
  font-weight: 600;
  box-shadow: var(--ct-shadow), inset 0 0 0 1px var(--ct-line);
}
.nav-item.router-link-exact-active i {
  color: var(--ct-ink);
}
.nav-item:focus-visible,
.new-group-btn:focus-visible {
  outline: 2px solid var(--ct-accent);
  outline-offset: -2px;
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ct-accent-soft);
  color: var(--ct-accent-text);
  font-size: 11.5px;
  font-weight: 600;
  text-align: center;
}
.count {
  font-size: 12px;
  color: var(--ct-muted);
}
.new-group-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  margin-top: 6px;
  padding: 0 10px;
  border: 1px dashed var(--ct-line-strong);
  border-radius: 9px;
  background: transparent;
  color: var(--ct-muted);
  font: inherit;
  cursor: pointer;
}
.new-group-btn:hover {
  color: var(--ct-ink);
}
.new-group {
  margin-top: 6px;
}
</style>
