import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the whole product against a running app.
 *   E2E_BASE_URL=http://localhost:3000 npx playwright test     (an app you started, e.g. Docker Compose)
 *   npx playwright test                                         (starts `next start` on port 3200; build first)
 * The app's database must have the owner account from ADMIN_EMAIL / ADMIN_PASSWORD.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3200";

export default defineConfig({
  testDir: "e2e",
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // On CI, the github reporter turns failures into annotations on the commit and pull request.
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 1000 } } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npx next start -p 3200", url: `${baseURL}/api/health`, timeout: 120_000, reuseExistingServer: true }
});
