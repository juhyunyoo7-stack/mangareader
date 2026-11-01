/// <reference lib="webworker" />
import { handleShare, opfsShareStore } from './shareTarget.ts';

declare const __PRECACHE__: string[];
declare const __CACHE_VERSION__: string;
declare const self: ServiceWorkerGlobalScope;

const CACHE = `mangareader-${__CACHE_VERSION__}`;

self.addEventListener('install', (event) => {
  // No skipWaiting here: the page decides when to activate an update (never auto-reload).
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(__PRECACHE__.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys())
        if (k !== CACHE && k.startsWith('mangareader-')) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(
      (async () => {
        try {
          await handleShare(req, opfsShareStore());
        } catch {
          /* fall through to redirect; the app shows nothing imported */
        }
        return Response.redirect(
          new URL('./#/library?shared=1', self.registration.scope).href,
          303,
        );
      })(),
    );
    return;
  }
  if (req.method !== 'GET') return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        const shell = (await cache.match('./')) ?? (await cache.match('index.html'));
        if (shell) return shell;
        return fetch(req);
      }
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      return fetch(req);
    })(),
  );
});
