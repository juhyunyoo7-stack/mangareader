// Regenerates tests/fixtures/bin/*.7z with a locally installed 7-Zip (7z.exe). Output is committed:
// the unit tests never need 7-Zip. Usage: node --experimental-strip-types scripts/gen-7z-fixtures.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { name3, pagePng } from './fixtures/lib.ts';

const exe = process.env.SEVENZIP ?? 'C:/Program Files/7-Zip/7z.exe';
const out = resolve('tests/fixtures/bin');
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'mr7z-'));
try {
  for (let i = 0; i < 4; i++) writeFileSync(join(work, name3(i)), pagePng(i, 200, 300));
  const run = (args: string[]) => execFileSync(exe, args, { cwd: work, stdio: 'ignore' });
  run([
    'a',
    '-t7z',
    '-ms=on',
    '-mx=5',
    join(out, 'solid4.7z'),
    '001.png',
    '002.png',
    '003.png',
    '004.png',
  ]);
  run([
    'a',
    '-t7z',
    '-ms=off',
    '-mx=5',
    join(out, 'plain4.7z'),
    '001.png',
    '002.png',
    '003.png',
    '004.png',
  ]);
  run(['a', '-t7z', '-p1234', '-mhe=off', join(out, 'encrypted.7z'), '001.png']);
  run(['a', '-t7z', '-p1234', '-mhe=on', join(out, 'encrypted-headers.7z'), '001.png']);
  console.log('wrote 7z fixtures to', out);
} finally {
  rmSync(work, { recursive: true, force: true });
}
