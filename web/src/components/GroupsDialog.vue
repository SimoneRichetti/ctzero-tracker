<script setup lang="ts">
import type { CardGroup } from '@ctzero/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { useConfirm } from 'primevue/useconfirm';
import { ref, watch } from 'vue';
import { api } from '../api';

const props = defineProps<{ groups: CardGroup[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ changed: [] }>();
const confirm = useConfirm();

const newName = ref('');
const names = ref<Record<number, string>>({});
const error = ref<string | null>(null);
const busy = ref(false);

function resetNames() {
  names.value = Object.fromEntries(props.groups.map((g) => [g.id, g.name]));
}

// After a reload, keep what the user is typing in the other rows: only new groups and
// groups whose saved name changed take the name from the server.
watch(
  () => props.groups,
  (groups, previous) => {
    const before = new Map((previous ?? []).map((g) => [g.id, g.name]));
    names.value = Object.fromEntries(
      groups.map((g) => [g.id, before.get(g.id) === g.name ? (names.value[g.id] ?? g.name) : g.name]),
    );
  },
  { immediate: true },
);

watch(visible, (open) => {
  if (open) {
    resetNames();
    newName.value = '';
    error.value = null;
  }
});

async function run(action: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await action();
    emit('changed');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function create() {
  const name = newName.value.trim();
  if (!name) return;
  void run(async () => {
    await api.post('/api/groups', { name });
    newName.value = '';
  });
}

function rename(group: CardGroup) {
  const name = names.value[group.id]?.trim();
  if (!name || name === group.name) return;
  void run(() => api.put(`/api/groups/${group.id}`, { name }));
}

function remove(group: CardGroup) {
  confirm.require({
    message: `Delete group "${group.name}"? Its ${group.cardCount} cards stay tracked, without a group.`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: () => void run(() => api.del(`/api/groups/${group.id}`)),
  });
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Groups" :style="{ width: '32rem' }">
    <p v-if="groups.length === 0" class="muted">No groups yet.</p>
    <div v-for="group in groups" :key="group.id" class="group-row">
      <InputText v-model="names[group.id]" fluid :disabled="busy" @keyup.enter="rename(group)" />
      <span class="muted count">{{ group.cardCount }} cards</span>
      <Button
        v-tooltip.top="'Rename'"
        icon="pi pi-check"
        text
        rounded
        :disabled="busy || !names[group.id]?.trim() || names[group.id]?.trim() === group.name"
        @click="rename(group)"
      />
      <Button v-tooltip.top="'Delete'" icon="pi pi-trash" text rounded severity="danger" :disabled="busy" @click="remove(group)" />
    </div>
    <div class="group-row new">
      <InputText v-model="newName" placeholder="New group name" fluid :disabled="busy" @keyup.enter="create" />
      <Button label="Add" icon="pi pi-plus" :disabled="busy || !newName.trim()" @click="create" />
    </div>
    <Message v-if="error" severity="error">{{ error }}</Message>
    <template #footer>
      <Button label="Close" severity="secondary" text @click="visible = false" />
    </template>
  </Dialog>
</template>

<style scoped>
.group-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.group-row.new {
  margin-top: 1rem;
}
.count {
  white-space: nowrap;
}
</style>
