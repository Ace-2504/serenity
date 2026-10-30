import { expect, test, type Page } from "@playwright/test";

/**
 * The owner's path through the product on demo data: sign in, load the quick demo, read every
 * report, run a campaign through all four approvals into the local outbox, and ask the assistant
 * (no model server in CI, so it answers from the report). Runs in order on one business.
 */

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@stationery.local";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe@123";

test.describe.configure({ mode: "serial" });

let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
});

test.afterAll(async () => {
  await page.close();
});

test("health endpoint reports the database", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, database: { ok: true } });
});

test("the owner signs in and loads the quick demo", async () => {
  await page.goto("/admin/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/\/admin$/), page.click('button:has-text("Sign in")')]);

  await page.goto("/admin/erp/imports");
  await page.click('button:has-text("Quick demo (6 months)")');
  // The demo loads as a background job; the page reloads into the new business when done.
  await expect(page.locator('button:has-text("Loading…")')).toHaveCount(0, { timeout: 8 * 60_000 });
  await page.goto("/admin/erp");
  await expect(page.getByText("Demo data.", { exact: false }).first()).toBeVisible();
  await expect(page.locator("h1")).toContainText("DEMO");
});

const REPORTS = [
  ["/admin/erp", "Overview"],
  ["/admin/erp/profitability", "Profitability"],
  ["/admin/erp/channels", "Channels"],
  ["/admin/erp/inventory", "Inventory"],
  ["/admin/crm/customers", "Customers"],
  ["/admin/erp/cash", "Cash"],
  ["/admin/erp/predictions", "Predictions"],
  ["/admin/crm/campaigns", "Campaigns"],
  ["/admin/erp/assistant", "Ask"],
  ["/admin/erp/metrics", "Definitions"],
  ["/admin/erp/system", "System"]
] as const;

for (const [path, name] of REPORTS) {
  test(`${name} page renders without errors and fits a phone screen`, async () => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.setViewportSize({ width: 1400, height: 1000 });
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a campaign reaches customers only after every approval, and stays in the local outbox", async () => {
  await page.goto("/admin/crm/campaigns");
  await page.fill('input[placeholder^="Win back"]', "E2E win-back");
  // Champions: the six-month demo is too short for many customers to be lapsing.
  await page.getByLabel("Who", { exact: false }).first().selectOption("segment");
  await page.locator("label", { hasText: /^Segment/ }).locator("select").selectOption("champion");
  await page.fill('input[placeholder^="Get an order"]', "Thank our best customers with an early look at the new range");
  await Promise.all([page.waitForURL(/\/admin\/crm\/campaigns\/[0-9a-f-]{36}$/), page.click('button:has-text("Create draft")')]);
  await expect(page.getByText("will be contacted")).toBeVisible();
  await expect(page.locator('button:has-text("Send now")')).toHaveCount(0);

  await page.click('button:has-text("Approve the audience")');
  await expect(page.getByText("Audience: approved")).toBeVisible();
  await page.fill('input[inputmode="decimal"]', "10");
  await page.click('button:has-text("Suggest wording")');
  await expect(page.getByText("Suggested wording")).toBeVisible();
  await page.click('button:has-text("Save draft")');
  await expect(page.getByText("Offer: 10% off")).toBeVisible();
  for (const [button, badge] of [
    ["Approve the message", "Message: approved"],
    ["Approve the offer", "Offer: approved"],
    ["Approve sending", "Send: approved"]
  ]) {
    await page.click(`button:has-text("${button}")`);
    await expect(page.getByText(badge)).toBeVisible();
  }
  await page.click('button:has-text("Send now")');
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("kept in the outbox")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 2 * 60_000 });
  await expect(page.getByText("not sent anywhere", { exact: false })).toBeVisible();
});

test("the assistant answers from the matching report when no model server runs", async () => {
  await page.goto("/admin/erp/assistant");
  await page.click('button:has-text("Who owes me money?")');
  await expect(page.getByText("Answered from the report itself")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Customers owe ₹/)).toBeVisible();
});

test("the pharmacy demo shows stock by expiry and keeps offers out of its campaigns", async () => {
  await page.goto("/admin/erp/imports");
  await page.click('button:has-text("Pharmacy demo (6 months)")');
  await expect(page.locator('button:has-text("Loading…")')).toHaveCount(0, { timeout: 8 * 60_000 });
  await page.goto("/admin/erp");
  await expect(page.locator("h1")).toContainText("Sanjeevani");

  await page.goto("/admin/erp/inventory");
  await expect(page.getByText("When does the stock expire?")).toBeVisible();
  await expect(page.getByText("Expired stock", { exact: true })).toBeVisible();

  await page.goto("/admin/erp?all=1");
  await expect(page.getByText(/of expired stock is still on hand/).first()).toBeVisible();

  await page.goto("/admin/crm/campaigns");
  await page.fill('input[placeholder^="Win back"]', "E2E refill reminder");
  await page.getByLabel("Who", { exact: false }).first().selectOption("segment");
  await page.locator("label", { hasText: /^Segment/ }).locator("select").selectOption("champion");
  await page.fill('input[placeholder^="Get an order"]', "Remind regular patients that their medicines are in stock");
  await Promise.all([page.waitForURL(/\/admin\/crm\/campaigns\/[0-9a-f-]{36}$/), page.click('button:has-text("Create draft")')]);
  await expect(page.getByText("No offers in this trade", { exact: false })).toBeVisible();
  await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(0);
});

test("no page raised a script error", () => {
  expect(pageErrors).toEqual([]);
});
