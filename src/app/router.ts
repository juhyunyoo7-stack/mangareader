import { signal } from '@preact/signals';

export type Route =
  | { name: 'library' }
  | { name: 'series'; id: string }
  | { name: 'read'; id: string }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const parts = h.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'series':
      return parts[1] ? { name: 'series', id: decodeURIComponent(parts[1]) } : { name: 'library' };
    case 'read':
      return parts[1] ? { name: 'read', id: decodeURIComponent(parts[1]) } : { name: 'library' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'library' };
  }
}

export const route = signal<Route>(parseHash(location.hash));

export function initRouter(): void {
  window.addEventListener('hashchange', () => {
    route.value = parseHash(location.hash);
  });
}

export function navigate(to: string): void {
  if (location.hash === to) route.value = parseHash(to);
  else location.hash = to;
}

export function back(fallback = '#/library'): void {
  if (history.length > 1 && document.referrer !== undefined) history.back();
  else navigate(fallback);
}
