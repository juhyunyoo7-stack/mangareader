/** Feature detection for platform differences (DESIGN 2.3). */
export interface Capabilities {
  opfs: boolean;
  fsaDirectory: boolean;
  fsaOpenFile: boolean;
  dragHandles: boolean;
  webkitDirectory: boolean;
  persist: boolean;
  launchQueue: boolean;
  isIOS: boolean;
  isAndroid: boolean;
}

export function detectCapabilities(): Capabilities {
  const w = window as unknown as Record<string, unknown>;
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const input = document.createElement('input');
  return {
    opfs: typeof navigator.storage?.getDirectory === 'function',
    fsaDirectory: typeof w['showDirectoryPicker'] === 'function',
    fsaOpenFile: typeof w['showOpenFilePicker'] === 'function',
    dragHandles:
      typeof DataTransferItem !== 'undefined' &&
      'getAsFileSystemHandle' in DataTransferItem.prototype,
    webkitDirectory: 'webkitdirectory' in input,
    persist: typeof navigator.storage?.persist === 'function',
    launchQueue: 'launchQueue' in w,
    isIOS: /iPhone|iPad|iPod/.test(ua) || iPadOS,
    isAndroid: /Android/.test(ua),
  };
}

/**
 * Folder picking (`webkitdirectory`) really works. iOS/iPadOS Safari exposes the attribute but only
 * shows a folder picker from 18.4 on (caniuse "input-file-directory"); older versions open the
 * normal file picker, so the folder button is hidden there and multi-select is suggested instead.
 */
export function folderPickerWorks(ua: string, iPadOS: boolean, hasAttribute: boolean): boolean {
  if (!hasAttribute) return false;
  if (!/iPhone|iPad|iPod/.test(ua) && !iPadOS) return true;
  const m = /Version\/(\d+)(?:\.(\d+))?/.exec(ua) ?? / OS (\d+)_(\d+)/.exec(ua);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major > 18 || (major === 18 && minor >= 4);
}

export function folderPickerSupported(): boolean {
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return folderPickerWorks(navigator.userAgent, iPadOS, caps().webkitDirectory);
}

/**
 * Keep the screen on while reading (Screen Wake Lock: Chromium 84+, Safari 16.4+; silently nothing
 * elsewhere). The lock is dropped by the browser when the page is hidden, so it is taken again when
 * the page becomes visible. Returns the release function.
 */
export function keepScreenOn(): () => void {
  if (!('wakeLock' in navigator)) return () => undefined;
  let sentinel: WakeLockSentinel | null = null;
  let active = true;
  const acquire = () => {
    if (!active || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(
      (s) => {
        if (active) sentinel = s;
        else void s.release().catch(() => undefined);
      },
      () => undefined, // denied (battery saver, not visible, iframe)
    );
  };
  document.addEventListener('visibilitychange', acquire);
  acquire();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', acquire);
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}

let cached: Capabilities | undefined;
export function caps(): Capabilities {
  cached ??= detectCapabilities();
  return cached;
}
