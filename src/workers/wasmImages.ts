/// <reference lib="webworker" />
import { mimeFor, type ImageKind } from '../archive/imageFormats.ts';

/**
 * JXL / AVIF with a WASM fallback (DESIGN 6): the browser decoder is tried first on the first image of
 * each kind; if it fails, every later image of that kind is decoded by @jsquash (lazy chunk, loaded
 * only then), re-encoded losslessly as PNG and handed to the normal decode path.
 */
const native = new Map<ImageKind, boolean>();
let forceWasm = false;

/** Test/debug switch (`?wasmimg=1`): never trust the browser decoder for JXL/AVIF. */
export function setForceWasmImages(on: boolean): void {
  forceWasm = on;
}

async function wasmDecode(bytes: Uint8Array, kind: 'jxl' | 'avif'): Promise<ImageData> {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const r =
    kind === 'jxl'
      ? await (await import('@jsquash/jxl/decode.js')).default(buf)
      : await (await import('@jsquash/avif/decode.js')).default(buf);
  if (!r) throw new Error('wasm decode failed');
  return r as ImageData;
}

/** A blob the standard createImageBitmap path can decode. */
export async function prepareImageBlob(bytes: Uint8Array, kind: ImageKind): Promise<Blob> {
  const blob = new Blob([bytes as BlobPart], { type: mimeFor(kind) });
  if (kind !== 'jxl' && kind !== 'avif') return blob;
  if (!forceWasm) {
    const known = native.get(kind);
    if (known === true) return blob;
    if (known === undefined) {
      try {
        (await createImageBitmap(blob)).close();
        native.set(kind, true);
        return blob;
      } catch {
        native.set(kind, false);
      }
    }
  }
  const img = await wasmDecode(bytes, kind);
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}
