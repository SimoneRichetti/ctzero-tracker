<script setup lang="ts">
import type { Settings } from '@ctzero/shared';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import { useToast } from 'primevue/usetoast';
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useCatalog } from '../catalog';

const toast = useToast();
const { health } = useCatalog();
const settings = ref<Settings | null>(null);
const saving = ref(false);
const testing = ref(false);
const modeOptions = [
  { label: 'Every N hours', value: 'interval' },
  { label: 'Every day at', value: 'daily' },
];

onMounted(async () => {
  try {
    settings.value = await api.get<Settings>('/api/settings');
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  }
});

async function save() {
  if (!settings.value) return;
  saving.value = true;
  try {
    settings.value = await api.put<Settings>('/api/settings', settings.value);
    toast.add({ severity: 'success', summary: 'Settings saved', life: 3000 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Error', detail: (e as Error).message, life: 5000 });
  } finally {
    saving.value = false;
  }
}

async function testTelegram() {
  testing.value = true;
  try {
    await api.post('/api/telegram/test');
    toast.add({ severity: 'success', summary: 'Test message sent', life: 3000 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Sending failed', detail: (e as Error).message, life: 5000 });
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="page settings">
    <div class="page-head">
      <h1 class="page-title">Settings</h1>
    </div>

    <form v-if="settings" class="panel" @submit.prevent="save">
      <div class="panel-title">Price checks</div>
      <div class="field">
        <label>Schedule</label>
        <SelectButton
          v-model="settings.scheduleMode"
          :options="modeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
        />
      </div>
      <div class="row">
        <div v-if="settings.scheduleMode === 'interval'" class="field">
          <label for="hours">Interval (hours)</label>
          <InputNumber v-model="settings.intervalHours" input-id="hours" :min="1" :max="168" show-buttons />
        </div>
        <div v-else class="field">
          <label for="time">Time</label>
          <InputText id="time" v-model="settings.dailyTime" type="time" />
        </div>
        <div class="field">
          <label for="drop">Notify a further drop from</label>
          <InputNumber v-model="settings.furtherDropPercent" input-id="drop" :min="1" :max="90" suffix=" %" />
        </div>
      </div>
      <Button type="submit" label="Save" icon="pi pi-check" :loading="saving" />
    </form>

    <section class="panel">
      <div class="panel-title">Connections</div>
      <div class="connection">
        <div>
          <div class="connection-name">CardTrader</div>
          <div class="muted">
            <template v-if="health?.cardtrader !== false">Token read from <code>.env</code></template>
            <template v-else>Set <code>CARDTRADER_TOKEN</code> in the <code>.env</code> file and restart</template>
          </div>
        </div>
        <span v-if="health" class="badge" :class="health.cardtrader ? 'ok' : 'danger'">{{ health.cardtrader ? 'Connected' : 'Not configured' }}</span>
      </div>
      <div class="connection">
        <div>
          <div class="connection-name">Telegram</div>
          <div class="muted">
            <template v-if="health?.telegram !== false">Alerts and reports go to your chat</template>
            <template v-else>Set <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> in the <code>.env</code> file and restart</template>
          </div>
        </div>
        <div class="connection-actions">
          <span v-if="health" class="badge" :class="health.telegram ? 'ok' : 'warn'">{{ health.telegram ? 'Connected' : 'Not configured' }}</span>
          <Button
            type="button"
            label="Send test message"
            icon="pi pi-send"
            severity="secondary"
            outlined
            size="small"
            :loading="testing"
            :disabled="health?.telegram === false"
            @click="testTelegram"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.settings .page-head {
  margin-bottom: 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
}
.connection {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid var(--ct-line);
}
.connection:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.connection-name {
  font-weight: 500;
}
.connection-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.badge.ok {
  background: var(--ct-accent-soft);
  color: var(--ct-accent-text);
}
.badge.warn {
  background: var(--ct-warn-soft);
  color: var(--ct-warn);
}
.badge.danger {
  background: var(--ct-danger-soft);
  color: var(--ct-danger);
}
code {
  font-family: var(--ct-mono);
  font-size: 12px;
}
</style>
