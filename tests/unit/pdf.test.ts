import { describe, expect, it } from 'vitest';
import { PdfBook } from '../../src/archive/pdf/pdfBook.ts';
import { buildPdf } from '../../scripts/fixtures/lib.ts';

/** Blob stand-in that records which byte ranges were read and refuses whole-file reads. */
function countingBlob(bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart]);
  const stats = { bytesRead: 0, wholeReads: 0 };
  const wrap = (b: Blob, offset: number): Blob =>
    ({
      size: b.size,
      slice: (start = 0, end = b.size) => wrap(b.slice(start, end), offset + start),
      arrayBuffer: () => {
        if (offset === 0 && b.size === blob.size) stats.wholeReads++;
        stats.bytesRead += b.size;
        return b.arrayBuffer();
      },
    }) as unknown as Blob;
  return { blob: wrap(blob, 0), stats };
}

describe('PdfBook range loading', () => {
  it('opens a large PDF by reading only the ranges it needs, never the whole file', async () => {
    const bytes = buildPdf(6 * 1024 * 1024); // 6 MB file, page objects at the end
    const { blob, stats } = countingBlob(bytes);
    const pdf = await PdfBook.open(blob, 1 << 30);
    try {
      expect(pdf.pageCount).toBe(4);
      const d = await pdf.dims(3);
      expect(d.w).toBeGreaterThan(d.h); // the landscape page
    } finally {
      pdf.close();
    }
    expect(stats.wholeReads).toBe(0);
    expect(stats.bytesRead).toBeLessThan(bytes.length / 2);
  });

  it('still opens a small PDF (initial chunk covers the whole file)', async () => {
    const bytes = buildPdf();
    const pdf = await PdfBook.open(new Blob([bytes as BlobPart]), 1 << 30);
    try {
      expect(pdf.pageCount).toBe(4);
    } finally {
      pdf.close();
    }
  });
});
