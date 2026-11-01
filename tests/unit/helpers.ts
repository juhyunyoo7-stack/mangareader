import type { SliceSource } from '../../src/archive/zip/zipDirectory.ts';

export function blobSource(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart]);
}

/** SliceSource that records how many bytes were requested. */
export class CountingSource implements SliceSource {
  bytesRead = 0;
  slices = 0;
  constructor(private readonly inner: SliceSource) {}
  get size(): number {
    return this.inner.size;
  }
  slice(start: number, end: number) {
    this.slices++;
    this.bytesRead += Math.max(0, Math.min(end, this.size) - start);
    return this.inner.slice(start, end);
  }
}

export class BitWriter {
  private bits: number[] = [];
  write(value: number, n: number): this {
    for (let i = 0; i < n; i++) this.bits.push((value >>> i) & 1);
    return this;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => {
      if (b) out[i >> 3]! |= 1 << (i & 7);
    });
    return out;
  }
}
