import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChannelFileError, convertChannelFiles, type ChannelContext } from "@/server/adapters/marketplace";
import { looseDate, looseMoney } from "@/server/adapters/marketplace/table";
import { IssueLog } from "@/server/ingest/issues";
import { parseBundle, type UploadedFile } from "@/server/ingest/parse";
import { emptyKnown, validateBundle } from "@/server/ingest/validate";

const fixture = (name: string): UploadedFile => ({ name, content: readFileSync(path.join(__dirname, "fixtures", name)) });
const ctx: ChannelContext = {
  itemCodes: new Set(["NB-1", "PEN-1"]),
  parties: [
    { code: "BLINKIT", name: "Blinkit Commerce Pvt Ltd", kind: "customer" },
    { code: "S1", name: "Blinkit Packaging Supplies", kind: "supplier" }
  ]
};

function staged(files: UploadedFile[]) {
  const log = new IssueLog();
  const bundle = parseBundle(files, log);
  const reconciliation = validateBundle(bundle, { ...emptyKnown(), itemCodes: ctx.itemCodes, parties: new Map([["BLINKIT", "customer"]]) }, log);
  return { bundle, log, reconciliation };
}
const charges = (bundle: ReturnType<typeof parseBundle>) =>
  bundle.charges.map((c) => [c.orderNumber ?? "", c.chargeType, c.amount.toFixed(2), c.gstAmount.toFixed(2)]).sort((a, b) => a.join().localeCompare(b.join()));

describe("loose platform values", () => {
  it("parses Indian money formats and day-first dates, never guessing", () => {
    expect(looseMoney("₹1,23,456.50")?.toFixed(2)).toBe("123456.50");
    expect(looseMoney("(12.00)")?.toFixed(2)).toBe("-12.00");
    expect(looseMoney("12 apples")).toBeNull();
    expect(looseDate("16.04.2025 06:12:44 UTC")).toBe("2025-04-16");
    expect(looseDate("02-04-2025")).toBe("2025-04-02");
    expect(looseDate("2025-04-15T06:12:44+00:00")).toBe("2025-04-15");
    expect(looseDate("15 Apr 2025")).toBe("2025-04-15");
    expect(looseDate("45767")).toBe("2025-04-20");
    expect(looseDate("31-02-2025")).toBeNull();
  });
});

describe("Amazon Settlement V2", () => {
  const result = convertChannelFiles([fixture("amazon-settlement-v2.txt")], ctx);

  it("turns fees into charges, merges fee GST, keeps tax withheld and period lines apart", () => {
    const { bundle, log, reconciliation } = staged(result.files);
    expect(log.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(reconciliation.every((r) => r.ok)).toBe(true);
    expect(bundle.kind).toBe("channel");
    expect(charges(bundle)).toEqual(
      [
        ["", "storage_fee", "30.00", "0.00"],
        ["", "tds_income_tax", "0.67", "0.00"],
        ["408-0000001-0000001", "closing_fee", "10.00", "1.80"],
        ["408-0000001-0000001", "referral_fee", "20.00", "7.20"],
        ["408-0000001-0000001", "refund_admin_fee", "4.00", "0.00"],
        ["408-0000001-0000001", "shipping_fee", "45.00", "8.10"],
        ["408-0000001-0000001", "tcs_gst", "2.24", "0.00"],
        ["408-0000002-0000002", "closing_fee", "10.00", "1.80"],
        ["408-0000002-0000002", "other_fee", "5.00", "0.00"],
        ["408-0000002-0000002", "referral_fee", "20.00", "3.60"],
        ["408-0000002-0000002", "tcs_gst", "1.12", "0.00"]
      ].sort((a, b) => a.join().localeCompare(b.join()))
    );
    expect(bundle.charges.every((c) => c.settlementDate === "2025-04-16")).toBe(true);
    expect(bundle.charges.filter((c) => c.isTaxWithheld).map((c) => c.chargeType).sort()).toEqual(["tcs_gst", "tcs_gst", "tds_income_tax"]);
  });

  it("reconciles every settlement to its deposit and lists unrecognised lines", () => {
    expect(result.issues.map((i) => i.code)).toEqual(["AMAZON_UNKNOWN_FEE"]);
    const details = result.summary.details as { deposits: unknown[]; breakdown: Record<string, string> };
    expect(details.deposits).toEqual([{ settlementId: "1001", depositDate: "2025-04-16", total: "330.35" }]);
    // 500.88 collected - 139.00 fees - 22.50 GST on fees - 4.03 tax withheld - 5.00 other = 330.35 deposited
    expect(details.breakdown).toEqual({ sales_collected: "500.88", fees: "-139.00", fee_gst: "-22.50", tax_withheld: "-4.03", other: "-5.00" });
    expect(result.summary.verified).toBe(false);
  });

  it("rejects a settlement whose rows do not add up to the deposit", () => {
    const text = readFileSync(path.join(__dirname, "fixtures", "amazon-settlement-v2.txt"), "utf8").replace("\t330.35\t", "\t340.35\t");
    const broken = convertChannelFiles([{ name: "s.txt", content: Buffer.from(text) }], ctx);
    expect(broken.issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual(["AMAZON_PAYOUT_MISMATCH"]);
  });
});

describe("Meesho payments (Excel)", () => {
  const result = convertChannelFiles([fixture("meesho-payments.xlsx")], ctx);

  it("splits fees shown incl. GST, credits compensation and skips unpaid sub-orders", () => {
    const { bundle, log, reconciliation } = staged(result.files);
    expect(log.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(reconciliation.every((r) => r.ok)).toBe(true);
    expect(charges(bundle)).toEqual(
      [
        ["SO-1001_1", "closing_fee", "10.00", "1.80"],
        ["SO-1001_1", "shipping_fee", "60.00", "10.80"],
        ["SO-1001_1", "tcs_gst", "1.00", "0.00"],
        ["", "tds_income_tax", "0.24", "0.00"],
        ["SO-1002_1", "closing_fee", "10.00", "1.80"],
        ["SO-1002_1", "shipping_fee", "50.00", "9.00"],
        ["SO-1002_1", "return_shipping_fee", "30.00", "5.40"],
        ["SO-1002_1", "tcs_gst", "0.50", "0.00"],
        ["", "tds_income_tax", "0.12", "0.00"],
        ["SO-1002_1", "compensation_credit", "-20.00", "0.00"]
      ].sort((a, b) => a.join().localeCompare(b.join()))
    );
    expect(bundle.charges.every((c) => c.settlementDate === "2025-04-20")).toBe(true);
  });

  it("reports what it could not use", () => {
    expect(result.issues.map((i) => i.code).sort()).toEqual(["MEESHO_NOT_PAID_YET", "MEESHO_UNMAPPED_COLUMNS"]);
    expect((result.summary.details as { signConvention: string }).signConvention).toBe("negative_is_deduction");
  });
});

describe("Quick-commerce purchase orders and GRNs", () => {
  const files = () => [fixture("blinkit-po-april.xlsx"), fixture("blinkit-grn-april.csv"), fixture("sku_map.csv")];

  it("joins PO and GRN files, maps platform SKUs and finds the customer in the books", () => {
    const result = convertChannelFiles(files(), ctx);
    const { bundle, log } = staged(result.files);
    expect(log.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(bundle.customerOrders.map((o) => [o.poNumber, o.itemCode, o.partyCode, o.qtyOrdered.toFixed(), o.qtySupplied.toFixed(), o.poDate])).toEqual([
      ["BLK-PO-1", "NB-1", "BLINKIT", "100", "80", "2025-04-02"],
      ["BLK-PO-1", "PEN-1", "BLINKIT", "50", "50", "2025-04-02"],
      ["BLK-PO-2", "NB-1", "BLINKIT", "60", "0", "2025-04-09"]
    ]);
    expect(result.issues.map((i) => i.code)).toEqual(["PO_NO_GRN"]);
    expect(result.sourceName).toBe("Blinkit purchase orders");
  });

  it("refuses platform SKUs it cannot map instead of guessing", () => {
    const result = convertChannelFiles(files().slice(0, 2), ctx);
    expect(result.issues.find((i) => i.code === "PO_UNMAPPED_SKU")?.severity).toBe("error");
  });

  it("asks which platform and customer when it cannot tell", () => {
    const renamed = files().map((f) => ({ ...f, name: f.name.replace("blinkit-", "") }));
    expect(() => convertChannelFiles(renamed, ctx)).toThrow(ChannelFileError);
    expect(() => convertChannelFiles(files(), { ...ctx, parties: [] })).toThrow(/No customer in your books looks like blinkit/);
  });
});

describe("file recognition", () => {
  it("refuses unknown files and mixed platforms", () => {
    expect(() => convertChannelFiles([{ name: "x.csv", content: Buffer.from("a,b,c\n1,2,3\n") }], ctx)).toThrow(/Not recognised/);
    expect(() => convertChannelFiles([fixture("amazon-settlement-v2.txt"), fixture("meesho-payments.xlsx")], ctx)).toThrow(/one platform/);
  });
});
