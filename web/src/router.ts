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
      // Links from before the rework used `/?group=<id|none>`; the rest of the query (e.g. `item`) is kept.
      redirect: (to) => {
        const { group, ...query } = to.query;
        const path =
          group === 'none' ? '/cards/ungrouped' : typeof group === 'string' && /^\d+$/.test(group) ? `/groups/${group}` : '/cards';
        return { path, query };
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
