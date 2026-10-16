<script setup lang="ts">
import Button from 'primevue/button';
import ConfirmDialog from 'primevue/confirmdialog';
import Drawer from 'primevue/drawer';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import { onMounted, ref } from 'vue';
import { setCatalogErrorHandler, useCatalog } from './catalog';
import AppSidebar from './components/AppSidebar.vue';
import SyncStatus from './components/SyncStatus.vue';
import { onRunFinished, startSyncPolling } from './sync-status';

const toast = useToast();
const catalog = useCatalog();
const menuOpen = ref(false);

setCatalogErrorHandler((message) => toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 }));
// A finished run changes prices, statuses and trends everywhere.
onRunFinished(() => void catalog.reloadAll());

onMounted(() => {
  startSyncPolling();
  void catalog.reloadAll();
  void catalog.loadHealth();
});
</script>

<template>
  <Toast />
  <ConfirmDialog />
  <div class="shell">
    <AppSidebar class="shell-sidebar" />

    <header class="topbar">
      <Button icon="pi pi-bars" text rounded severity="secondary" aria-label="Open menu" @click="menuOpen = true" />
      <span class="topbar-brand">CTZero</span>
      <SyncStatus compact class="topbar-sync" />
    </header>
    <Drawer v-model:visible="menuOpen" position="left" class="menu-drawer" :show-close-icon="false" aria-label="Menu">
      <AppSidebar @navigate="menuOpen = false" />
    </Drawer>

    <main class="shell-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
}
.shell-sidebar {
  min-height: 0;
}
/* Only the content scrolls: the sidebar, with the update status, stays in place. */
.shell-main {
  min-width: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 32px 36px;
  position: relative;
}
.topbar {
  display: none;
}
@media (max-width: 900px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  .shell-sidebar {
    display: none;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--ct-side);
    border-bottom: 1px solid var(--ct-line);
  }
  .topbar-brand {
    font-weight: 600;
  }
  .topbar-sync {
    margin-left: auto;
  }
  .shell-main {
    padding: 20px 16px;
  }
}
</style>

<style>
.menu-drawer.p-drawer {
  width: 290px;
  background: var(--ct-side);
}
.menu-drawer .p-drawer-header {
  display: none;
}
.menu-drawer .p-drawer-content {
  padding: 0;
}
.menu-drawer .sidebar {
  border-right: 0;
}
</style>
