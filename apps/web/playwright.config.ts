import { defineConfig, devices } from "@playwright/test";

// Three breakpoints from UI instructions §2. Screenshots land in e2e/screenshots.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // One worker: several specs (contracts.spec.ts, and now site-logs.spec.ts)
  // exercise the same seeded contract's aggregate figures (a contract's
  // currentValue, an RFI count) from more than one breakpoint project at
  // once. Two workers each mutating that same row concurrently is a genuine
  // race at the database level, not a locator issue — confirmed by running
  // contracts.spec.ts's own pre-existing test with `--workers=2` (fails,
  // `afterValue - beforeValue` picks up the other worker's own addition)
  // versus `--workers=1` (passes every time). One worker costs wall-clock
  // time, not correctness, and this suite is a handful of specs, not a
  // large one.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  // Both servers, because M0's definition of done is an access-control claim
  // and access control is enforced by Postgres row policies (ADR-0010).
  // e2e/api-server.sh brings up a throwaway cluster, migrates it, seeds it and
  // runs the API on it; it tears the cluster down when Playwright stops it.
  webServer: [
    {
      command: "bash e2e/api-server.sh",
      url: "http://localhost:3001/health",
      reuseExistingServer: true,
      // initdb + migrate + seed + the API's own build, on a cold cache.
      timeout: 300_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        // The six seeded accounts on S00 (ADR-0009), and the API they sign in
        // against. Both are the defaults; named here so the run does not
        // depend on a developer's .env.local.
        NEXT_PUBLIC_DEV_AUTH: "1",
        NEXT_PUBLIC_API_BASE: "http://localhost:3001",
      },
    },
  ],
});
