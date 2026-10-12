<script setup lang="ts">
import type { BulkResult, CardGroup, TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { bulkCards } from '../bulk-cards';

const props = defineProps<{ cards: TrackedCard[]; groups: CardGroup[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [result: BulkResult]; groupsChanged: [] }>();

/** Explicit option for "remove from any group", so that nothing picked can't be mistaken for it. */
const NO_GROUP = 'none';
/** null = nothing picked yet. */
const choice = ref<number | typeof NO_GROUP | null>(null);
const options = computed(() => [{ id: NO_GROUP, name: 'No group (remove from group)' }, ...props.groups]);
const newName = ref('');
const error = ref<string | null>(null);
const saving = ref(false);

watch(visible, (open) => {
  if (open) {
    choice.value = null;
    newName.value = '';
    error.value = null;
  }
});

async function createGroup() {
  const name = newName.value.trim();
  if (!name) return;
  error.value = null;
  try {
    const group = await api.post<CardGroup>('/api/groups', { name });
    newName.value = '';
    choice.value = group.id;
    emit('groupsChanged');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function apply() {
  if (choice.value === null) return;
  saving.value = true;
  error.value = null;
  try {
    const result = await bulkCards(
      props.cards.map((c) => c.id),
      { type: 'group', groupId: choice.value === NO_GROUP ? null : choice.value },
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
  <Dialog v-model:visible="visible" modal header="Move to group" :style="{ width: '30rem' }">
    <p class="muted">Applies to {{ cards.length }} cards.</p>
    <div class="field">
      <label for="bulk-group">Group</label>
      <Select
        v-model="choice"
        input-id="bulk-group"
        :options="options"
        option-label="name"
        option-value="id"
        placeholder="Choose a group"
        show-clear
        fluid
      />
    </div>
    <div class="field">
      <label for="bulk-new-group">Or create a new group</label>
      <div class="new-group">
        <InputText v-model="newName" input-id="bulk-new-group" placeholder="Group name" fluid @keyup.enter="createGroup" />
        <Button label="Create" icon="pi pi-plus" severity="secondary" :disabled="!newName.trim()" @click="createGroup" />
      </div>
    </div>
    <Message v-if="error" severity="error">{{ error }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Move" icon="pi pi-check" :disabled="choice === null" :loading="saving" @click="apply" />
    </template>
  </Dialog>
</template>

<style scoped>
.new-group {
  display: flex;
  gap: 0.5rem;
}
</style>
