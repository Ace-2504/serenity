import { describe, expect, it } from "vitest";
import { convertAmazonSettlements } from "@/server/adapters/marketplace/amazon";
import { eventsToSettlementFile, SpApiClient, type EventGroup, type FinancialEvents } from "@/server/adapters/marketplace/sp-api";
import { readTable } from "@/server/adapters/marketplace/table";

const ENV = { AMAZON_SP_CLIENT_ID: "client", AMAZON_SP_CLIENT_SECRET: "top-secret", AMAZON_SP_REFRESH_TOKEN: "refresh", AMAZON_SP_ENDPOINT: "https://sp.example.test" };
const money = (n: number) => ({ CurrencyCode: "INR", CurrencyAmount: n });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** One order: Rs 500 collected; commission 40 + IGST 7.20; closing fee 10 + IGST 1.80; TCS 2.24. Deposit 438.76. */
const sampleGroup: EventGroup = {
  FinancialEventGroupId: "G-1",
  ProcessingStatus: "Closed",
  FundTransferStatus: "Succeeded",
  FundTransferDate: "2025-04-16T06:12:44Z",
  FinancialEventGroupStart: "2025-04-01T00:00:00Z",
  FinancialEventGroupEnd: "2025-04-14T00:00:00Z",
  OriginalTotal: money(438.76)
};
const sampleEvents: FinancialEvents = {
  ShipmentEventList: [
    {
      AmazonOrderId: "408-0000001-0000001",
      PostedDate: "2025-04-10T08:00:00Z",
      ShipmentItemList: [
        {
          SellerSKU: "NB-1",
          ItemChargeList: [{ ChargeType: "Principal", ChargeAmount: money(448) }, { ChargeType: "Tax", ChargeAmount: money(52) }],
          ItemFeeList: [
            { FeeType: "Commission", FeeAmount: money(-40) },
            { FeeType: "CommissionIGST", FeeAmount: money(-7.2) },
            { FeeType: "FixedClosingFee", FeeAmount: money(-10) },
            { FeeType: "FixedClosingFeeIGST", FeeAmount: money(-1.8) }
          ],
          ItemTaxWithheldList: [{ TaxesWithheld: [{ ChargeType: "TCS-IGST", ChargeAmount: money(-2.24) }] }]
        }
      ]
    }
  ]
};

describe("Amazon Selling Partner API connector", () => {
  it("turns payouts into settlement rows the report converter accepts, deposit matched", () => {
    const { file, unhandled, skippedOpen } = eventsToSettlementFile([
      { group: sampleGroup, events: sampleEvents },
      { group: { ...sampleGroup, FinancialEventGroupId: "G-OPEN", ProcessingStatus: "Open", FundTransferDate: undefined }, events: {} }
    ]);
    expect([unhandled, skippedOpen]).toEqual([[], 1]);
    const result = convertAmazonSettlements([readTable(file)]);
    expect(result.issues).toEqual([]);
    expect(result.deposits).toEqual([{ settlementId: "G-1", depositDate: "2025-04-16", total: "438.76" }]);
    expect(result.rows.map((r) => `${r.charge_type} ${r.amount} ${r.gst_amount}`).sort()).toEqual(["closing_fee 10.00 1.80", "referral_fee 40.00 7.20", "tcs_gst 2.24 0.00"]);
  });

  it("fails the deposit check, instead of losing money, when Amazon sends events it does not read", () => {
    const events = { ...sampleEvents, RetrochargeEventList: [{ RetrochargeEventType: "Retrocharge", BaseTax: money(-5) }] };
    const { file, unhandled } = eventsToSettlementFile([{ group: { ...sampleGroup, OriginalTotal: money(433.76) }, events }]);
    expect(unhandled).toEqual(["RetrochargeEventList"]);
    expect(convertAmazonSettlements([readTable(file)]).issues.map((i) => i.code)).toContain("AMAZON_PAYOUT_MISMATCH");
  });

  it("logs in with the refresh token, follows pages and retries when throttled", async () => {
    const calls: string[] = [];
    let throttled = false;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes("/auth/o2/token")) {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return json({ access_token: "access-1", expires_in: 3600 });
      }
      expect((init?.headers as Record<string, string>)["x-amz-access-token"]).toBe("access-1");
      if (!throttled) {
        throttled = true;
        return json({ errors: [{ code: "QuotaExceeded" }] }, 429);
      }
      if (String(url).includes("NextToken=p2")) return json({ payload: { FinancialEventGroupList: [{ FinancialEventGroupId: "G-2" }] } });
      return json({ payload: { FinancialEventGroupList: [{ FinancialEventGroupId: "G-1" }], NextToken: "p2" } });
    }) as unknown as typeof fetch;
    const client = new SpApiClient(ENV, { fetchImpl, minIntervalMs: 0 });
    expect((await client.eventGroups("2025-04-01", "2025-04-30")).map((g) => g.FinancialEventGroupId)).toEqual(["G-1", "G-2"]);
    expect(calls.filter((c) => c.includes("token"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("financialEventGroups"))).toHaveLength(3);
  });

  it("never repeats the secret in its errors", async () => {
    const fetchImpl = (async () => json({ error: "invalid_client", error_description: "bad top-secret" }, 401)) as unknown as typeof fetch;
    const error = await new SpApiClient(ENV, { fetchImpl, minIntervalMs: 0 }).eventGroups("2025-04-01", "2025-04-30").catch((e: Error) => e);
    expect(String(error)).toMatch(/refused the login \(HTTP 401, invalid_client\)/);
    expect(String(error)).not.toContain("top-secret");
  });

  it("refuses to start without credentials", () => {
    expect(() => new SpApiClient({})).toThrow(/AMAZON_SP_CLIENT_ID/);
  });
});
