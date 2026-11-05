import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets the tests run when Windows reserves 4173 (excluded port range, EACCES)
const PORT = Number(process.env.PW_PORT ?? 4173);
const webkit = process.env.NO_WEBKIT
  ? []
  : [
      {
        name: 'webkit-desktop',
        use: { ...devices['Desktop Safari'] },
        testIgnore: /(touch|chromium-only)/,
      },
    ];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !!process.env.PW_REUSE,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      testIgnore: /touch|phone/,
    },
    ...webkit,
    {
      name: 'chromium-phone',
      use: { ...devices['Pixel 7'] },
      testMatch: /(touch|phone)/,
    },
  ],
});
