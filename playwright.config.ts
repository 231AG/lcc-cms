import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1, // all spec files share one live Supabase project/app_user table -- no per-file isolation exists
  retries: 0,
  reporter: "list",
  // Generous timeouts because Next.js dev mode (Turbopack) compiles each
  // route/action lazily on first hit -- a cold /change-password route took
  // over 8s once during manual verification, and a multi-step test (login
  // + create + disable) accumulates several such round-trips against the
  // real Supabase project past Playwright's default 30s per-test budget.
  // Production builds don't have this cost; revisit these numbers once
  // e2e runs against a built app.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    navigationTimeout: 20_000,
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
