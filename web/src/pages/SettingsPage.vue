<script setup lang="ts">
import type { Settings } from '@ctzero/shared';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import { useToast } from 'primevue/usetoast';
import { onMounted, ref } from 'vue';
import { api } from '../api';

const toast = useToast();
const settings = ref<Settings | null>(null);
const saving = ref(false);
const testing = ref(false);
const modeOptions = [
  { label: 'Ogni N ore', value: 'interval' },
  { label: 'Ogni giorno alle', value: 'daily' },
];

onMounted(async () => {
  try {
    settings.value = await api.get<Settings>('/api/settings');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Errore', detail: (e as Error).message, life: 5000 });
  }
});

async function save() {
  if (!settings.value) return;
  saving.value = true;
  try {
    settings.value = await api.put<Settings>('/api/settings', settings.value);
    toast.add({ severity: 'success', summary: 'Impostazioni salvate', life: 3000 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Errore', detail: (e as Error).message, life: 5000 });
  } finally {
    saving.value = false;
  }
}

async function testTelegram() {
  testing.value = true;
  try {
    await api.post('/api/telegram/test');
    toast.add({ severity: 'success', summary: 'Messaggio di test inviato', life: 3000 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Invio fallito', detail: (e as Error).message, life: 5000 });
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <h1>Impostazioni</h1>
  <form v-if="settings" class="settings-form" @submit.prevent="save">
    <div class="field">
      <label>Pianificazione</label>
      <SelectButton
        v-model="settings.scheduleMode"
        :options="modeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
      />
    </div>
    <div v-if="settings.scheduleMode === 'interval'" class="field">
      <label for="hours">Intervallo (ore)</label>
      <InputNumber v-model="settings.intervalHours" input-id="hours" :min="1" :max="168" show-buttons />
    </div>
    <div v-else class="field">
      <label for="time">Orario</label>
      <InputText id="time" v-model="settings.dailyTime" type="time" />
    </div>
    <div class="field">
      <label for="drop">Notifica "ulteriore calo" a partire da</label>
      <InputNumber v-model="settings.furtherDropPercent" input-id="drop" :min="1" :max="90" suffix=" %" />
    </div>
    <div class="actions">
      <Button type="submit" label="Salva" icon="pi pi-check" :loading="saving" />
      <Button
        type="button"
        label="Invia messaggio di test Telegram"
        icon="pi pi-send"
        severity="secondary"
        :loading="testing"
        @click="testTelegram"
      />
    </div>
  </form>
</template>

<style scoped>
.settings-form {
  max-width: 28rem;
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
