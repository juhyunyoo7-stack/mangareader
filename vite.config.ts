import { defineConfig } from 'vitest/config';
import { precachePlugin } from './scripts/vite-sw-plugin.ts';

export default defineConfig({
  base: process.env.BASE ?? './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
  worker: { format: 'es' },
  plugins: [precachePlugin()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
