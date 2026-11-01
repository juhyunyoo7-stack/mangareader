import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSeriesBooks, FIXTURES } from './fixtures/lib.ts';

const dir = 'tests/fixtures/out';
mkdirSync(`${dir}/series`, { recursive: true });
const manifest: Record<string, { bytes: number; sha256: string }> = {};
const record = (path: string, bytes: Uint8Array) => {
  writeFileSync(`${dir}/${path}`, bytes);
  manifest[path] = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
for (const [name, build] of Object.entries(FIXTURES)) record(name, build());
for (const [name, bytes] of Object.entries(buildSeriesBooks())) record(`series/${name}`, bytes);
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`wrote ${Object.keys(manifest).length} fixtures to ${dir}`);
