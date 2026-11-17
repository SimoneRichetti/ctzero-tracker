import type { ToastMessageOptions } from 'primevue/toast';
import type { RouteLocationRaw } from 'vue-router';

/** Toast group rendered by App.vue with a link next to the message. */
export const LINK_TOAST = 'link';

export function linkToast(
  summary: string,
  text: string | undefined,
  link: { to: RouteLocationRaw; label: string },
  life = 6000,
): ToastMessageOptions {
  return { group: LINK_TOAST, severity: 'success', summary, detail: { text, ...link }, life };
}
