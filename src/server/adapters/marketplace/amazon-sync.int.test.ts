import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncAmazon } from "@/server/adapters/marketplace/amazon-sync";
import { forTenant } from "@/server/db/tenant";

/** Amazon payouts through a SIMULATED Selling Partner API into staging, then the database. */

const ENV = { AMAZON_SP_CLIENT_ID: "client", AMAZON_SP_CLIENT_SECRET: "secret", AMAZON_SP_REFRESH_TOKEN: "refresh", AMAZON_SP_ENDPOINT: "https://sp.example.test" };
const money = (n: number) => ({ CurrencyCode: "INR", CurrencyAmount: n });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const fetchImpl = (async (url: string) => {
  const u = String(url);
  if (u.includes("/auth/o2/token")) return json({ access_token: "a", expires_in: 3600 });
  if (u.includes("/financialEvents")) {
    return json({
      payload: {
        FinancialEvents: {
          ShipmentEventList: [
            {
              AmazonOrderId: "408-1",
              PostedDate: "2025-04-10T08:00:00Z",
              ShipmentItemList: [{ ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: money(500) }], ItemFeeList: [{ FeeType: "Commission", FeeAmount: money(-40) }, { FeeType: "CommissionIGST", FeeAmount: money(-7.2) }] }]
            }
          ]
        }
      }
    });
  }
  return json({ payload: { FinancialEventGroupList: [{ FinancialEventGroupId: "G-1", ProcessingStatus: "Closed", FundTransferDate: "2025-04-16T06:00:00Z", OriginalTotal: money(452.8) }] } });
}) as unknown as typeof fetch;

let tenantId: string;
let db: ReturnType<typeof forTenant>;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Amazon API test", domainPack: "stationery" } })).id;
  db = forTenant(tenantId);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("Amazon payouts via the Selling Partner API (simulated)", () => {
  it("stages the payout's fees for review in the Amazon settlements source", async () => {
    const result = await syncAmazon(db, tenantId, { from: "2025-04-01", to: "2025-04-30", env: ENV, fetchImpl, minIntervalMs: 0 });
    expect(result).toMatchObject({ status: "validated", groups: 1, closed: 1, errors: 0 });
    const source = await db.dataSource.findFirstOrThrow({ where: { name: "Amazon settlements" } });
    expect(source.kind).toBe("marketplace_file");
  });

  it("treats the same payouts read again as no change", async () => {
    const batch = await db.importBatch.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    const { commitImport } = await import("@/server/ingest/pipeline");
    await commitImport(db, tenantId, batch.id);
    expect(await db.channelCharge.count()).toBe(1);
    expect((await syncAmazon(db, tenantId, { from: "2025-04-01", to: "2025-04-30", env: ENV, fetchImpl, minIntervalMs: 0 })).status).toBe("duplicate");
  });
});
