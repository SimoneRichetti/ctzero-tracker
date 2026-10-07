import { createRouter, createWebHistory } from 'vue-router';
import CardsPage from './pages/CardsPage.vue';
import SealedPage from './pages/SealedPage.vue';
import SettingsPage from './pages/SettingsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: CardsPage },
    { path: '/sealed', component: SealedPage },
    { path: '/settings', component: SettingsPage },
  ],
});
