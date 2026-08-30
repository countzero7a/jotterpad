export type Theme = 'auto' | 'light' | 'dark' | 'blue';

const STORAGE_KEY = 'jotterpad-theme';
const VALID_THEMES: readonly Theme[] = ['auto', 'light', 'dark', 'blue'];

function isTheme(value: string | null): value is Theme {
  return value !== null && (VALID_THEMES as readonly string[]).includes(value);
}

export function getStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Silently ignore localStorage errors; theme still gets applied to DOM
  }
  applyTheme(theme);
}
