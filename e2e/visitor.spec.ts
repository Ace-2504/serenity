import { expect, test } from "@playwright/test";

/**
 * A visitor's path: the product site, self-serve sign-up into their own business, and deleting
 * it again. Runs in a fresh browser context, separate from the owner's walkthrough.
 */

test("the product site links to sign-up and keeps the shop reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your books already know");
  await expect(page.getByText("tested on sample files")).toBeVisible();
  await page.getByRole("link", { name: "Paper Serenity shop" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a visitor signs up, gets an empty business of their own, and can delete it", async ({ page }) => {
  const email = `visitor-${Date.now()}@example.com`;
  await page.goto("/");
  await page.getByRole("link", { name: "Create your account" }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByLabel("Your name").fill("Asha Verma");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-password");
  await page.getByLabel("Business name").fill("Verma Stationers");
  await Promise.all([page.waitForURL(/\/bi\/imports$/), page.getByRole("button", { name: "Create account" }).click()]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Verma Stationers");
  await expect(page.getByText("Demo data.")).toHaveCount(0);

  // The same email cannot sign up twice.
  const again = await page.request.post("/api/auth/signup", {
    form: { name: "Someone", email, password: "another-long-password", businessName: "Copy" },
    maxRedirects: 0
  });
  expect(again.headers()["location"]).toContain("error=email_taken");

  await page.goto("/bi/business");
  const remove = page.getByRole("button", { name: "Delete this business and its data" });
  await expect(remove).toBeDisabled();
  await page.getByLabel("Type Verma Stationers to confirm").fill("Verma Stationers");
  await Promise.all([page.waitForURL(/\/bi$/), remove.click()]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get started");
  await expect(page.getByRole("button", { name: "Quick demo (6 months)" })).toBeVisible();
});

test("signing up only to try the demo needs no business name", async ({ page }) => {
  await page.goto("/signup?demo=1");
  await page.getByLabel("Your name").fill("Ravi");
  await page.getByLabel("Email").fill(`demo-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("a-long-password");
  await Promise.all([page.waitForURL(/\/bi$/), page.getByRole("button", { name: "Create account" }).click()]);
  await expect(page.getByRole("button", { name: "Pharmacy demo (6 months)" })).toBeVisible();
});
