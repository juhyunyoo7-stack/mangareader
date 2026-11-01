// Regenerates tests/fixtures/bin/page-*.{jxl,avif}: one coloured test page per format, encoded with the
// same @jsquash codecs the app uses as WASM fallback. Output is committed.
// Usage: node --experimental-strip-types scripts/gen-image-fixtures.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pageRaster } from './fixtures/lib.ts';

const require = createRequire(import.meta.url);
const wasm = (p: string) => WebAssembly.compile(readFileSync(require.resolve(p)));

const { init: initJxl, default: encodeJxl } = await import('@jsquash/jxl/encode.js');
const { init: initAvif, default: encodeAvif } = await import('@jsquash/avif/encode.js');
await initJxl(await wasm('@jsquash/jxl/codec/enc/jxl_enc.wasm'));
await initAvif(await wasm('@jsquash/avif/codec/enc/avif_enc.wasm'));

function imageData(n: number, w: number, h: number): ImageData {
  const r = pageRaster(n, w, h);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r.data[i * 3]!;
    rgba[i * 4 + 1] = r.data[i * 3 + 1]!;
    rgba[i * 4 + 2] = r.data[i * 3 + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  return { data: rgba, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

for (let n = 0; n < 3; n++) {
  const img = imageData(n, 200, 300);
  writeFileSync(
    `tests/fixtures/bin/page-${n}.jxl`,
    new Uint8Array(await encodeJxl(img, { quality: 90 })),
  );
  writeFileSync(
    `tests/fixtures/bin/page-${n}.avif`,
    new Uint8Array(await encodeAvif(img, { quality: 80 })),
  );
}
console.log('wrote jxl/avif fixtures');
