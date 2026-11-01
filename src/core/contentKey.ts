export const KEY_SLICE = 256 * 1024;

export interface KeySource {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

function hex(buf: ArrayBuffer, chars: number): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, chars);
}

/**
 * Book identity (DESIGN 5.2): sha256(size || first 256 KiB || last 256 KiB || sorted entry names),
 * first 32 hex chars. Stable across devices and file renames.
 */
export async function contentKey(src: KeySource, entryNames: string[]): Promise<string> {
  const head = new Uint8Array(await src.slice(0, Math.min(KEY_SLICE, src.size)).arrayBuffer());
  const tail = new Uint8Array(
    await src.slice(Math.max(0, src.size - KEY_SLICE), src.size).arrayBuffer(),
  );
  const names = new TextEncoder().encode([...entryNames].sort().join('\n'));
  const size = new Uint8Array(8);
  new DataView(size.buffer).setBigUint64(0, BigInt(src.size), true);
  const all = new Uint8Array(8 + head.length + tail.length + names.length);
  all.set(size, 0);
  all.set(head, 8);
  all.set(tail, 8 + head.length);
  all.set(names, 8 + head.length + tail.length);
  return hex(await crypto.subtle.digest('SHA-256', all), 32);
}
