<script setup lang="ts">
import type { BulkResult, CardGroup, TrackedCard } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ cards: TrackedCard[]; groups: CardGroup[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [result: BulkResult]; groupsChanged: [] }>();

/** null = remove from any group. */
const groupId = ref<number | null>(null);
const newName = ref('');
const error = ref<string | null>(null);
const saving = ref(false);

watch(visible, (open) => {
  if (open) {
    groupId.value = null;
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
    groupId.value = group.id;
    emit('groupsChanged');
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function apply() {
  saving.value = true;
  error.value = null;
  try {
    const result = await api.post<BulkResult>('/api/cards/bulk', {
      ids: props.cards.map((c) => c.id),
      action: { type: 'group', groupId: groupId.value },
    });
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
        v-model="groupId"
        input-id="bulk-group"
        :options="groups"
        option-label="name"
        option-value="id"
        placeholder="No group (remove from group)"
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
      <Button label="Move" icon="pi pi-check" :loading="saving" @click="apply" />
    </template>
  </Dialog>
</template>

<style scoped>
.new-group {
  display: flex;
  gap: 0.5rem;
}
</style>
