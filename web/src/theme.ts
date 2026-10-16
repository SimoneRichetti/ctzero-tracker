import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { ref } from 'vue';

/** Class on <html> that switches PrimeVue and the app tokens to the dark scheme. */
export const DARK_CLASS = 'app-dark';
const STORAGE_KEY = 'ctzero.theme';

/** Aura with the app palette: emerald primary (it means "below target"), warm light surfaces, cool dark ones. */
export const AppPreset = definePreset(Aura, {
  primitive: {
    borderRadius: { none: '0', xs: '4px', sm: '6px', md: '9px', lg: '12px', xl: '14px' },
  },
  semantic: {
    primary: {
      50: '#ecfbf6',
      100: '#cdf4e7',
      200: '#9de8d1',
      300: '#66d8b8',
      400: '#3fd0a6',
      500: '#1fae88',
      600: '#0f8c6e',
      700: '#0b7a62',
      800: '#0a5f4d',
      900: '#094e40',
      950: '#042c24',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#f7f6f2',
          100: '#efede7',
          200: '#e3e0d8',
          300: '#cdc9bf',
          400: '#a8a49a',
          500: '#5a5f69',
          600: '#4a4d55',
          700: '#363940',
          800: '#24272c',
          900: '#17191e',
          950: '#0e0f12',
        },
        primary: { color: '{primary.700}', contrastColor: '#ffffff', hoverColor: '{primary.800}', activeColor: '{primary.900}' },
        highlight: { background: '#ddefe8', focusBackground: '#cde8de', color: '#07624e', focusColor: '#07624e' },
        text: { color: '#17191e', hoverColor: '#17191e', mutedColor: '#5a5f69', hoverMutedColor: '#363940' },
      },
      dark: {
        surface: {
          0: '#ffffff',
          50: '#eceef1',
          100: '#d5d8dd',
          200: '#b6bac2',
          300: '#a0a6b0',
          400: '#7c838e',
          500: '#5c636e',
          600: '#363c45',
          700: '#262a31',
          800: '#1f2328',
          900: '#16191d',
          950: '#0f1114',
        },
        primary: { color: '{primary.400}', contrastColor: '#062b21', hoverColor: '{primary.300}', activeColor: '{primary.200}' },
        highlight: { background: '#123a30', focusBackground: '#17463a', color: '#6be3bf', focusColor: '#6be3bf' },
        text: { color: '#eceef1', hoverColor: '#ffffff', mutedColor: '#a0a6b0', hoverMutedColor: '#d5d8dd' },
      },
    },
  },
});

function readStored(): 'dark' | 'light' {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Dark by default; index.html applies the stored choice before the app mounts, so there is no flash. */
const isDark = ref(readStored() === 'dark');

function apply(dark: boolean) {
  document.documentElement.classList.toggle(DARK_CLASS, dark);
}

export function useTheme() {
  function toggle() {
    isDark.value = !isDark.value;
    apply(isDark.value);
    try {
      localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light');
    } catch {
      // private window or blocked storage: the choice lasts until the page is closed
    }
  }
  return { isDark, toggle };
}

/** Reads an app token (`--ct-*`) for canvas drawing; `isDark` is read so callers recompute on a theme switch. */
export function themeColor(name: string, fallback: string): string {
  void isDark.value;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
