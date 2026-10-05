<script setup lang="ts">
import ConfirmDialog from 'primevue/confirmdialog';
import Toast from 'primevue/toast';
import HealthBanner from './components/HealthBanner.vue';
</script>

<template>
  <Toast />
  <ConfirmDialog />
  <header class="topbar">
    <span class="brand">🃏 CTZero Tracker</span>
    <nav>
      <RouterLink to="/">Carte</RouterLink>
      <RouterLink to="/impostazioni">Impostazioni</RouterLink>
    </nav>
  </header>
  <main class="content">
    <HealthBanner />
    <RouterView />
  </main>
</template>
