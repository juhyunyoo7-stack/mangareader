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

let cached: Capabilities | undefined;
export function caps(): Capabilities {
  cached ??= detectCapabilities();
  return cached;
}
