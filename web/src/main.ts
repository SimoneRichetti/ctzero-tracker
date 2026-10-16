import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import 'primeicons/primeicons.css';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './style.css';
import { AppPreset, DARK_CLASS } from './theme';

createApp(App)
  .use(router)
  .use(PrimeVue, { theme: { preset: AppPreset, options: { darkModeSelector: `.${DARK_CLASS}` } } })
  .use(ToastService)
  .use(ConfirmationService)
  .directive('tooltip', Tooltip)
  .mount('#app');
