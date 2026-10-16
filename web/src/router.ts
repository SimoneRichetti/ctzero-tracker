import { createRouter, createWebHistory } from 'vue-router';
import CardsPage from './pages/CardsPage.vue';
import ImportPage from './pages/ImportPage.vue';
import SealedPage from './pages/SealedPage.vue';
import SettingsPage from './pages/SettingsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      // Links from before the rework used `/?group=<id|none>`.
      redirect: (to) => {
        const group = to.query.group;
        if (group === 'none') return '/cards/ungrouped';
        if (typeof group === 'string' && /^\d+$/.test(group)) return `/groups/${group}`;
        return '/cards';
      },
    },
    { path: '/cards', component: CardsPage, props: { scope: 'all' } },
    { path: '/cards/ungrouped', component: CardsPage, props: { scope: 'none' } },
    { path: '/groups/:id', component: CardsPage, props: (to) => ({ scope: String(to.params.id) }) },
    { path: '/sealed', component: SealedPage },
    { path: '/import', component: ImportPage },
    { path: '/settings', component: SettingsPage },
    { path: '/:pathMatch(.*)*', redirect: '/cards' },
  ],
});
