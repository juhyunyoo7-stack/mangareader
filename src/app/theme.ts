import { uiSettings } from './store.ts';

export function applyTheme(): void {
  const t = uiSettings.value.theme;
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', t === 'light' ? '#f5f5f7' : t === 'oled' ? '#000000' : '#0f0f10');
}
