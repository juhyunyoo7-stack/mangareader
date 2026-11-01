import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePng, fillRect, makeRaster } from './fixtures/png.ts';

// Simple open-book glyph on a dark tile. Maskable icons keep the glyph inside the safe zone.
function icon(size: number, maskable: boolean): Uint8Array {
  const r = makeRaster(size, size, [15, 15, 16]);
  const pad = Math.round(size * (maskable ? 0.28 : 0.2));
  const bw = Math.round((size - pad * 2) / 2) - Math.round(size * 0.01);
  const bh = Math.round((size - pad * 2) * 0.8);
  const y = Math.round((size - bh) / 2);
  const gap = Math.round(size * 0.02);
  fillRect(r, size / 2 - gap / 2 - bw, y, bw, bh, [232, 232, 232]);
  fillRect(r, size / 2 + gap / 2, y, bw, bh, [232, 232, 232]);
  const line = Math.max(2, Math.round(size * 0.025));
  for (let i = 0; i < 4; i++) {
    const ly = y + Math.round(bh * (0.18 + i * 0.2));
    fillRect(r, size / 2 - gap / 2 - bw + line * 2, ly, bw - line * 4, line, [90, 140, 255]);
    fillRect(r, size / 2 + gap / 2 + line * 2, ly, bw - line * 4, line, [90, 140, 255]);
  }
  return encodePng(r, 6);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/placeholder-icon-192.png', icon(192, false));
writeFileSync('public/icons/placeholder-icon-512.png', icon(512, false));
writeFileSync('public/icons/placeholder-icon-maskable-512.png', icon(512, true));
console.log('icons written');
