<script setup lang="ts">
import type { HealthDto } from '@ctzero/shared';
import Message from 'primevue/message';
import { onMounted, ref } from 'vue';
import { api } from '../api';

const health = ref<HealthDto | null>(null);

onMounted(async () => {
  try {
    health.value = await api.get<HealthDto>('/api/health');
  } catch {
    health.value = null;
  }
});
</script>

<template>
  <Message v-if="health && !health.cardtrader" severity="error" class="banner">
    Missing CardTrader token: set <code>CARDTRADER_TOKEN</code> in the <code>.env</code> file and restart.
  </Message>
  <Message v-if="health && !health.telegram" severity="warn" class="banner">
    Telegram not configured: set <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> in the
    <code>.env</code> file and restart.
  </Message>
</template>
