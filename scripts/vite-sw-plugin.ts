import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { build as esbuild } from 'esbuild';
import type { Plugin, ResolvedConfig } from 'vite';

const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Adds the CSP meta tag and compiles src/sw.ts into dist/sw.js with a build-time precache list. */
export function precachePlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'mangareader-sw',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
    async closeBundle() {
      const out = config.build.outDir;
      const files = walk(out)
        .filter((f) => !f.endsWith('sw.js') && !f.endsWith('.map'))
        .map((f) => relative(out, f).split(sep).join('/'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
      const version = hash.digest('hex').slice(0, 12);
      const urls = ['./', ...files];
      await esbuild({
        entryPoints: ['src/sw.ts'],
        outfile: join(out, 'sw.js'),
        bundle: true,
        minify: true,
        format: 'iife',
        target: 'es2022',
        define: {
          __PRECACHE__: JSON.stringify(urls),
          __CACHE_VERSION__: JSON.stringify(version),
        },
      });
    },
  };
}
