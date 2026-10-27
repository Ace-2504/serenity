import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as upload } from "@/app/api/bi/imports/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { openBills } from "@/server/analytics/working-capital";
import { profitability } from "@/server/analytics/profitability";
import { ACTIVE_TENANT_COOKIE } from "@/server/bi/context";
import { forTenant } from "@/server/db/tenant";
import { commitImport, type ImportSummary } from "@/server/ingest/pipeline";

/** Tally XML fixtures through the real upload API, staging and commit. */

let userId: string;
let token: string;
let tenantId: string;

function xmlForm(daybook = "daybook.xml"): FormData {
  const form = new FormData();
  for (const name of ["masters.xml", daybook]) {
    form.append("files", new File([readFileSync(path.join(__dirname, "fixtures", name))], name, { type: "text/xml" }));
  }
  return form;
}
const post = (body: FormData) =>
  upload(new NextRequest(new URL("/api/bi/imports", "http://localhost"), { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}; ${ACTIVE_TENANT_COOKIE}=${tenantId}` }, body }));

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: "x" } });
  userId = user.id;
  token = createSessionToken({ userId, email: user.email, roles: [] });
  tenantId = (await prisma.tenant.create({ data: { name: "Tally test", domainPack: "stationery", memberships: { create: { userId, role: "owner_admin" } } } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("Tally XML import, end to end", () => {
  let batchId: string;

  it("stages the converted export with the adapter's report and an unverified label", async () => {
    const response = await post(xmlForm());
    expect(response.status).toBe(201);
    const staged = (await response.json()) as { batchId: string; status: string; summary: ImportSummary };
    expect(staged.status).toBe("validated");
    expect(staged.summary.adapter).toMatchObject({ name: "Tally XML", verified: false });
    expect(staged.summary.issues.byCode).toHaveProperty("TALLY_STOCK_VOUCHER_SKIPPED");
    const source = await prisma.dataSource.findFirstOrThrow({ where: { tenantId } });
    expect(source.kind).toBe("tally_xml");
    batchId = staged.batchId;
  });

  it("commits; the rebuilt stock ledger matches Tally's closing stock exactly", async () => {
    const db = forTenant(tenantId);
    const { summary } = await commitImport(db, tenantId, batchId, { userId });
    expect(summary.ledger?.stockCheck).toMatchObject({ items: 2, qtyMismatches: 0, valueMismatches: 0 });
  });

  it("rebuilds receivables from Tally's bill references, credit notes and receipts", async () => {
    const db = forTenant(tenantId);
    const open = (await openBills(db, tenantId, "receivable", "2025-04-30")).map((b) => [b.number, b.pending.toFixed(2)]).sort();
    // Bill 1: 662.00 - credit note 85.12 - receipt 576.88 = 0. Bill 3: 2,228.00 - 1,000.00. Bill 2 was cash.
    expect(open).toEqual([
      ["2", "59.00"],
      ["3", "1228.00"],
      ["5", "118.00"]
    ]);
    expect(await openBills(db, tenantId, "payable", "2025-04-30")).toEqual([]);
  });

  it("reports product sales without freight or round-off", async () => {
    const db = forTenant(tenantId);
    const [total] = await profitability(db, tenantId, { from: "2025-04-01", to: "2025-04-30" }, "total");
    // 2,630.00 sales - 76.00 returned; cost at Tally's average cost (Rs 25 notebooks, Rs 5 pens).
    expect(total.netSales.toFixed(2)).toBe("2554.00");
    expect(total.cogs.toFixed(2)).toBe(String((10 + 50 - 2) * 25 + (20 + 5 + 12) * 5) + ".00");
  });

  it("treats re-uploading the same export as a no-op", async () => {
    const response = await post(xmlForm());
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("duplicate");
  });

  it("refuses a mixed upload of XML and CSV", async () => {
    const form = xmlForm();
    form.append("files", new File(["a,b"], "items.csv"));
    expect((await post(form)).status).toBe(400);
  });
});
