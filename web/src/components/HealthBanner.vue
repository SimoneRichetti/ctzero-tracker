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
    Token CardTrader mancante: imposta <code>CARDTRADER_TOKEN</code> nel file <code>.env</code> e riavvia.
  </Message>
  <Message v-if="health && !health.telegram" severity="warn" class="banner">
    Telegram non configurato: imposta <code>TELEGRAM_BOT_TOKEN</code> e <code>TELEGRAM_CHAT_ID</code> nel file
    <code>.env</code> e riavvia.
  </Message>
</template>
