export type DeviceClass = 'iphone' | 'ipad' | 'desktop' | 'android-high' | 'android-low';

export interface DeviceEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** navigator.deviceMemory (GB, Chromium only) */
  deviceMemory?: number;
  screenShortSide: number;
}

const MB = 1024 * 1024;

export interface MemoryBudget {
  cls: DeviceClass;
  /** decoded bitmap bytes allowed in the page cache */
  cacheBytes: number;
  /** archives bigger than this must be converted (RAR/7z, whole-buffer formats) */
  wholeArchiveLimit: number;
  /** max number of non-visible live canvases */
  extraCanvases: number;
  /** pages decoded ahead in the travel direction */
  prefetchAhead: number;
}

export function detectDeviceClass(env: DeviceEnv): DeviceClass {
  if (/iPhone|iPod/.test(env.userAgent)) return 'iphone';
  const iPad =
    /iPad/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
  if (iPad) return 'ipad';
  if (/Android/.test(env.userAgent)) {
    return (env.deviceMemory ?? 4) >= 8 ? 'android-high' : 'android-low';
  }
  return 'desktop';
}

export function budgetFor(cls: DeviceClass): MemoryBudget {
  switch (cls) {
    case 'iphone':
      return {
        cls,
        cacheBytes: 200 * MB,
        wholeArchiveLimit: 300 * MB,
        extraCanvases: 2,
        prefetchAhead: 2,
      };
    case 'ipad':
      return {
        cls,
        cacheBytes: 350 * MB,
        wholeArchiveLimit: 600 * MB,
        extraCanvases: 3,
        prefetchAhead: 3,
      };
    case 'android-low':
      return {
        cls,
        cacheBytes: 250 * MB,
        wholeArchiveLimit: 400 * MB,
        extraCanvases: 2,
        prefetchAhead: 2,
      };
    case 'android-high':
      return {
        cls,
        cacheBytes: 800 * MB,
        wholeArchiveLimit: 1024 * MB,
        extraCanvases: 4,
        prefetchAhead: 3,
      };
    case 'desktop':
      return {
        cls,
        cacheBytes: 800 * MB,
        wholeArchiveLimit: 2048 * MB,
        extraCanvases: 4,
        prefetchAhead: 3,
      };
  }
}

export function currentEnv(): DeviceEnv {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    deviceMemory: nav.deviceMemory,
    // `screen` does not exist in workers (RAR/7z limits are read there)
    screenShortSide: typeof screen === 'undefined' ? 0 : Math.min(screen.width, screen.height),
  };
}

export function currentBudget(): MemoryBudget {
  return budgetFor(detectDeviceClass(currentEnv()));
}
