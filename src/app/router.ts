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

/** Hash of the history entry the current one was pushed from ('' when unknown). */
let previousHash = '';
let replacing = false;

export function initRouter(): void {
  window.addEventListener('hashchange', (e) => {
    if (!replacing) previousHash = new URL(e.oldURL).hash;
    replacing = false;
    route.value = parseHash(location.hash);
  });
}

export function navigate(to: string): void {
  if (location.hash === to) route.value = parseHash(to);
  else location.hash = to;
}

/** Swap the current entry for `to` (no new history entry; the entry it came from is kept). */
export function replaceRoute(to: string): void {
  if (location.hash === to) return;
  replacing = true;
  location.replace(to);
}

/**
 * Leave the current screen (the reader) for `to` without leaving it behind in history, so the
 * Android back button / back gesture does not reopen it: step back when `to` is where we came from,
 * otherwise replace the current entry.
 */
export function leave(to: string): void {
  if (previousHash === to) history.back();
  else replaceRoute(to);
}
