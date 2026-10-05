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
      <RouterLink to="/">Cards</RouterLink>
      <RouterLink to="/settings">Settings</RouterLink>
    </nav>
  </header>
  <main class="content">
    <HealthBanner />
    <RouterView />
  </main>
</template>
