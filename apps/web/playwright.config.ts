import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the production build in read-only snapshot mode (no DATABASE_URL): every dashboard renders from
 * data/demo-snapshot.json, so CI needs no database, no keys and no network (SPEC §13.3).
 */
const PORT = 3288;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { DATABASE_URL: "", AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else", AUTH_URL: `http://localhost:${PORT}`, AUTH_TRUST_HOST: "true" },
  },
});
