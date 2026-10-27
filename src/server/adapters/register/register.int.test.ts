import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as preview } from "@/app/api/bi/imports/register/preview/route";
import { POST as stage } from "@/app/api/bi/imports/register/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_TENANT_COOKIE } from "@/server/bi/context";
import { forTenant } from "@/server/db/tenant";
import { commitImport } from "@/server/ingest/pipeline";

/** Register spreadsheets through the real preview and staging APIs, then commit. */

const SALES = ["Date,Vch/Bill No,Particulars,Item Details,Qty.,Amount,GST %", "01-04-2025,S-1,Sharma Stores,Ruled Notebook A5,10,380.00,12", ",,,Gel Pen Blue,20,200.00,18"].join("\n");
const PURCHASES = ["Date,Bill No,Party Name,Item,Quantity,Taxable Value,GST %", "02-04-2025,P-77,Likhit Supplies,Ruled Notebook A5,500,9000.00,12"].join("\n");

let userId: string;
let tenantId: string;
let cookie: string;
const form = (mappings?: unknown) => {
  const f = new FormData();
  f.append("files", new File([SALES], "Sales Register.csv", { type: "text/csv" }));
  f.append("files", new File([PURCHASES], "Purchase Register.csv", { type: "text/csv" }));
  if (mappings) f.append("mappings", JSON.stringify(mappings));
  return f;
};
const call = (handler: (r: NextRequest) => Promise<Response>, path: string, body: FormData) => handler(new NextRequest(new URL(path, "http://localhost"), { method: "POST", headers: { cookie }, body }));

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: "x" } });
  userId = user.id;
  tenantId = (await prisma.tenant.create({ data: { name: "Register test", domainPack: "stationery", memberships: { create: { userId, role: "owner_admin" } } } })).id;
  cookie = `${SESSION_COOKIE}=${createSessionToken({ userId, email: user.email, roles: [] })}; ${ACTIVE_TENANT_COOKIE}=${tenantId}`;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("register upload (BUSY or any spreadsheet)", () => {
  it("previews, stages with the confirmed mapping, commits, and remembers the mapping", async () => {
    const p = await (await call(preview, "/api/bi/imports/register/preview", form())).json();
    expect(p.files.map((f: { mapping: { voucherType: string }; remembered: boolean }) => [f.mapping.voucherType, f.remembered])).toEqual([
      ["sales_invoice", false],
      ["purchase_invoice", false]
    ]);
    const response = await call(stage, "/api/bi/imports/register", form(p.files.map((f: { mapping: unknown }) => f.mapping)));
    const staged = await response.json();
    expect(response.status).toBe(201);
    expect(staged.status).toBe("validated");
    const db = forTenant(tenantId);
    await commitImport(db, tenantId, staged.batchId);
    expect(await db.voucher.count({ where: { type: { in: ["sales_invoice", "purchase_invoice"] } } })).toBe(2);
    const again = await (await call(preview, "/api/bi/imports/register/preview", form())).json();
    expect(again.files.every((f: { remembered: boolean }) => f.remembered)).toBe(true);
  });

  it("explains a missing required column instead of guessing", async () => {
    const response = await call(stage, "/api/bi/imports/register", form([{ file: "Sales Register.csv", voucherType: "sales_invoice", columns: { date: "Date" } }]));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/choose the column for "Voucher \/ bill number"/);
  });
});
