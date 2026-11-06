import { signal } from '@preact/signals';

/** True when a new service worker is installed and waiting; UI offers a manual reload. */
export const updateReady = signal(false);
let waiting: ServiceWorker | null = null;

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function applyUpdate(): void {
  waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      const watch = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            updateReady.value = true;
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting;
        updateReady.value = true;
      }
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // An installed app on a phone/iPad is usually resumed, not reloaded, so the browser rarely checks
      // for a new version by itself: check when the app comes back to the foreground (at most hourly).
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 3_600_000) return;
        lastCheck = Date.now();
        reg.update().catch(() => undefined);
      });
    })
    .catch(() => {
      /* offline support unavailable; app still works online */
    });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !updateReady.value) return;
    reloading = true;
    location.reload();
  });
}
