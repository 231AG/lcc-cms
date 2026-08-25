import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false, // shares live Supabase/app_user state; keep runs serial for now
  retries: 0,
  reporter: "list",
  // Generous timeouts because Next.js dev mode (Turbopack) compiles each
  // route/action lazily on first hit -- a cold /change-password route took
  // over 8s once during manual verification. Production builds don't have
  // this cost; revisit these numbers once e2e runs against a built app.
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
