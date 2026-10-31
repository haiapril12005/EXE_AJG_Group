import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "auth-otp.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    },
  }],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev frontend --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_TEST: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://otp-test.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_otp_test_not_a_real_key",
      NEXT_PUBLIC_API_URL: "http://localhost:4000",
    },
  },
});
