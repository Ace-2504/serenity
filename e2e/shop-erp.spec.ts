import { expect, test, type Page } from "@playwright/test";

/**
 * One website: the owner links the shop to their business, records a supplier's bill, and a
 * customer's order on the shop (with their consent to offers) shows up in the ERP and CRM.
 */

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@stationery.local";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "ChangeMe@123";
const tag = Date.now().toString(36);
const SKU = `E2E-NB-${tag}`.toUpperCase();
const CUSTOMER = { first: "Meera", last: `Shah${tag}`, email: `meera-${tag}@example.com` };

test.describe.configure({ mode: "serial", timeout: 180_000 });

let owner: Page;
let variantId: string;
let orderId: string;

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage();
  await owner.goto("/admin/login");
  await owner.fill('input[name="email"]', EMAIL);
  await owner.fill('input[name="password"]', PASSWORD);
  await Promise.all([owner.waitForURL(/\/admin$/), owner.click('button:has-text("Sign in")')]);
});

test.afterAll(async () => {
  await owner.close();
});

test("the admin is one console: shop, ERP and CRM in one navigation", async () => {
  await expect(owner.getByRole("navigation", { name: "Admin" })).toContainText("Products & stock");
  for (const [link, heading] of [
    ["Purchases", "Purchases"],
    ["Customers", undefined],
    ["Data & connections", undefined]
  ] as const) {
    await owner.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: link, exact: true }).click();
    if (heading) await expect(owner.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(owner.getByRole("navigation", { name: "Admin" })).toBeVisible();
  }
});

test("the owner links the website to their own business and records a supplier's bill", async () => {
  const created = await owner.request.post("/api/bi/businesses", { data: { name: `Paper Serenity ${tag}`, domainPack: "stationery" } });
  expect(created.status()).toBe(201);
  const product = await owner.request.post("/api/admin/inventory", {
    data: { title: `E2E Notebook ${tag}`, description: "Ruled A5", hsnCode: "4820", gstPercent: 12, sku: SKU, priceInr: 150, stockOnHand: 0, status: "published", newCategoryName: `Notebooks ${tag}`, newBrandName: `Brand ${tag}` }
  });
  expect(product.status(), await product.text()).toBe(201);
  variantId = (await product.json()).item.variantId;

  await owner.goto("/admin/erp/imports");
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText(`Paper Serenity ${tag}`);
  await owner.getByRole("button", { name: "Link this website to this business" }).click();
  await expect(owner.getByText("Linked. Orders, customers")).toBeVisible({ timeout: 120_000 });

  await owner.goto("/admin/erp/purchases");
  await owner.getByRole("combobox", { name: "Supplier", exact: true }).selectOption("new");
  await owner.getByLabel("Supplier name").fill(`Kagaz Mills ${tag}`);
  await owner.getByLabel("Bill number").fill("KM-1");
  await owner.getByLabel("Product 1").selectOption(variantId);
  await owner.getByLabel("Quantity 1").fill("20");
  await owner.getByLabel("Rate 1").fill("90");
  await expect(owner.getByText("Bill total with GST: ₹2,016.00")).toBeVisible();
  await owner.getByRole("button", { name: "Record bill and add to stock" }).click();
  await expect(owner.getByText("Recorded.")).toBeVisible();
  await expect(owner.getByRole("row", { name: new RegExp(`Kagaz Mills ${tag}`) })).toContainText("₹2,016.00");
});

test("a customer's order and consent reach the CRM and the books", async ({ browser }) => {
  const shopper = await browser.newPage();
  await shopper.goto("/register");
  const fill = (name: string, value: string) => shopper.fill(`input[name="${name}"]`, value);
  await fill("firstName", CUSTOMER.first);
  await fill("lastName", CUSTOMER.last);
  await fill("email", CUSTOMER.email);
  await fill("password", "a-long-password");
  await fill("confirmPassword", "a-long-password");
  await fill("label", "Home");
  await fill("line1", "12 MG Road");
  await fill("city", "Pune");
  await fill("state", "Maharashtra");
  await fill("postalCode", "411001");
  await fill("phone", "9800000001");
  await shopper.check('input[name="marketingEmail"]');
  await Promise.all([shopper.waitForURL((url) => !url.pathname.startsWith("/register")), shopper.click('button:has-text("Create account")')]);

  expect((await shopper.request.post("/api/cart/items", { data: { variantId, quantity: 2 } })).ok()).toBe(true);
  const addresses = (await (await shopper.request.get("/api/account/addresses")).json()).items as { id: string }[];
  const placed = await shopper.request.post("/api/checkout/place-order", { data: { paymentMethod: "cod", addressId: addresses[0].id } });
  expect(placed.ok(), await placed.text()).toBe(true);
  const { orderNumber, orderId: id } = await placed.json();
  orderId = id;
  await shopper.close();

  // The order queues a sync of the books; the customer appears in the CRM once it is saved.
  await expect(async () => {
    await owner.goto(`/admin/crm/customers?q=${CUSTOMER.last}`);
    await expect(owner.getByText(`${CUSTOMER.first} ${CUSTOMER.last}`).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000 });

  await owner.goto("/admin");
  const summary = owner.locator("section", { has: owner.getByRole("heading", { name: /ERP & CRM/ }) });
  await expect(summary.getByRole("link", { name: /Agreed to offers by email/ })).toContainText("1");
  await expect(summary.getByRole("link", { name: /Owed to suppliers/ })).toContainText("₹2,016");

  await owner.goto("/admin/erp/imports");
  await owner.getByRole("link", { name: /Latest sync/ }).click();
  // The seeded sample order is on the website too, so count at least this one.
  await expect(owner.getByText(/\d+ orders \(0 returned\), 1 purchase bills/)).toBeVisible();
  expect(orderNumber).toBeTruthy();
});

test("the shop ships the order, collects the cash, and the books show it received", async () => {
  await owner.goto(`/admin/orders/${orderId}`);
  for (const step of ["Mark packed", "Mark shipped", "Mark delivered"]) {
    await owner.getByRole("button", { name: step }).click();
    await expect(owner.getByRole("button", { name: step })).toHaveCount(0);
  }
  await expect(owner.getByText("Status: Delivered")).toBeVisible();
  await owner.getByRole("button", { name: "Mark cash collected" }).click();
  await expect(owner.getByText("Payment Status: paid", { exact: false })).toBeVisible();

  // 2 notebooks at ₹150 + 12% GST = ₹336, plus the seeded sample order's ₹471, once the sync is saved.
  await expect(async () => {
    await owner.goto("/admin/erp/imports");
    await owner.getByRole("link", { name: /Latest sync/ }).click();
    await expect(owner.getByRole("row", { name: /Receipts from customers/ })).toContainText("₹807.00", { timeout: 2_000 });
  }).toPass({ timeout: 120_000 });
});

