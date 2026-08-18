// Light/dark theme controller. Premium sports apps default to dark; we let
// the user switch and persist the choice. Applied via [data-theme] on <html>
// so index.css can override CSS variables for the light palette.

export type ThemeMode = 'dark' | 'light';
const KEY = 'sports-edge:theme';

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getStoredTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
