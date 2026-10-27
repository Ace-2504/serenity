import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeTallyXml } from "@/server/adapters/tally/decode";
import { tallyToTemplate } from "@/server/adapters/tally/convert";
import { tallyAmount, tallyQty, tallyRate, stateCode } from "@/server/adapters/tally/values";
import { IssueLog } from "@/server/ingest/issues";
import { parseBundle, type UploadedFile } from "@/server/ingest/parse";
import { emptyKnown, validateBundle } from "@/server/ingest/validate";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name));
const utf16 = (buf: Buffer, bom = true) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(buf.toString("utf8"), "utf16le")]);
const files = (daybook = fixture("daybook.xml")): UploadedFile[] => [
  { name: "masters.xml", content: fixture("masters.xml") },
  { name: "daybook.xml", content: daybook }
];

function run(input: UploadedFile[] = files()) {
  const conversion = tallyToTemplate(input);
  const log = new IssueLog();
  const bundle = parseBundle(conversion.files, log);
  const reconciliation = validateBundle(bundle, emptyKnown(), log);
  return { conversion, bundle, reconciliation, log };
}

describe("Tally text conventions", () => {
  it("parses amounts with Tally's debit-negative sign, quantities with units, and rates", () => {
    expect(tallyAmount("-1,234.50")?.toFixed(2)).toBe("-1234.50");
    expect(tallyAmount("")?.toFixed(2)).toBe("0.00");
    expect(tallyAmount("abc")).toBeNull();
    expect(tallyQty(" 10 Nos")).toMatchObject({ unit: "Nos" });
    expect(tallyQty("10 Nos = 2 Box")?.qty.toFixed()).toBe("10");
    expect(tallyRate("40.00/Nos")?.toFixed(2)).toBe("40.00");
    expect(stateCode("07AAACB5678B1Z2", "Uttar Pradesh")).toBe("07");
    expect(stateCode("", "Uttar Pradesh")).toBe("09");
  });

  it("decodes UTF-16 with or without a byte order mark and strips &#4; markers", () => {
    const utf8 = decodeTallyXml(fixture("masters.xml"));
    expect(utf8.encoding).toBe("utf-8");
    expect(utf8.removedControlRefs).toBeGreaterThan(0);
    expect(utf8.text).not.toContain("&#4;");
    expect(decodeTallyXml(utf16(fixture("masters.xml"))).text).toBe(utf8.text);
    expect(decodeTallyXml(utf16(fixture("masters.xml"), false))).toMatchObject({ encoding: "utf-16le", text: utf8.text });
  });
});

describe("Tally export -> import template", () => {
  it("produces a bundle that validates with no errors and reconciles", () => {
    const { log, reconciliation, conversion } = run();
    expect(conversion.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(log.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(reconciliation.every((r) => r.ok)).toBe(true);
  });

  it("reads UTF-16 exports identically", () => {
    const a = tallyToTemplate(files());
    const b = tallyToTemplate(files(utf16(fixture("daybook.xml"))));
    expect(b.files.map((f) => f.content.toString())).toEqual(a.files.map((f) => f.content.toString()));
  });

  it("imports sales, returns, purchases and settlements; reports what it skipped", () => {
    const { conversion } = run();
    expect(conversion.summary.imported).toEqual({ sales_invoice: 4, purchase_invoice: 1, sales_return: 1, receipt: 2, payment: 1 });
    expect(conversion.summary.vouchersRead).toBe(12);
    expect(Object.keys(conversion.summary.skipped).sort()).toEqual(["Cancelled", "Journal: no sales, purchase or bill effect", "Stock Journal: changes stock but is not imported yet"]);
    expect(conversion.issues.map((i) => i.code)).toContain("TALLY_STOCK_VOUCHER_SKIPPED");
    expect(conversion.summary.unallocated).toEqual({ receipts: "500.00", payments: "0.00" });
    expect(conversion.summary.period).toEqual({ from: "2025-04-01", to: "2025-04-30" });
    expect(conversion.summary.company).toBe("Fixture Traders (fictional)");
  });

  it("maps the custom voucher type, discount, GST per line and round-off of sale 1", () => {
    const { bundle } = run();
    const sale = bundle.vouchers.find((v) => v.key === "sales_invoice|1")!;
    expect(sale.partyCode).toBe("Customer A");
    expect(sale.dueDate).toBe("2025-05-01");
    expect(sale.adjustment?.toFixed(2)).toBe("0.40");
    expect(sale.lines.map((l) => [l.itemCode, l.qty.toFixed(), l.rate.toFixed(2), l.discountAmount.toFixed(2), l.taxableAmount.toFixed(2), l.taxRate.toFixed(), l.taxAmount.toFixed(2)])).toEqual([
      ["Ruled Notebook A5", "10", "40.00", "20.00", "380.00", "12", "45.60"],
      ["Gel Pen Blue", "20", "10.00", "0.00", "200.00", "18", "36.00"]
    ]);
  });

  it("treats a cash sale as an anonymous counter customer", () => {
    const { bundle } = run();
    expect(bundle.vouchers.find((v) => v.key === "sales_invoice|2")).toMatchObject({ partyCode: "Cash", channel: "counter" });
    expect(bundle.parties.find((p) => p.code === "Cash")).toMatchObject({ anonymousBuyers: true });
  });

  it("links bills by Tally bill reference, not voucher number", () => {
    const { bundle } = run();
    const receipt = bundle.settlements.find((s) => s.key === "receipt|R-2")!;
    expect(receipt.allocations.map((a) => [a.againstNumber, a.amount.toFixed(2)])).toEqual([["3", "1000.00"]]);
    const payment = bundle.settlements.find((s) => s.key === "payment|PY-1")!;
    expect(payment.allocations.map((a) => [a.againstNumber, a.amount.toFixed(2)])).toEqual([["P-1", "2800.00"]]);
    expect(bundle.vouchers.find((v) => v.key === "sales_return|CN-1")?.originalNumber).toBe("1");
    expect(bundle.vouchers.find((v) => v.key === "purchase_invoice|P-1")?.dueDate).toBe("2025-05-17");
    // Freight is part of the bill, not of product sales; the party's master gives 15 days' credit.
    expect(bundle.vouchers.find((v) => v.key === "sales_invoice|3")).toMatchObject({ dueDate: "2025-04-25" });
    expect(bundle.vouchers.find((v) => v.key === "sales_invoice|3")?.adjustment?.toFixed(2)).toBe("100.00");
  });

  it("spreads a free quantity's price over the units moved and uses the GST rate valid on the date", () => {
    const { bundle, conversion } = run();
    const [line] = bundle.vouchers.find((v) => v.key === "sales_invoice|5")!.lines;
    expect([line.qty.toFixed(), line.rate.toFixed(4), line.taxableAmount.toFixed(2), line.taxRate.toFixed(), line.taxAmount.toFixed(2)]).toEqual(["12", "8.3333", "100.00", "18", "18.00"]);
    expect(conversion.issues.map((i) => i.code)).toContain("TALLY_FREE_QUANTITY");
  });

  it("states control totals that match hand-computed register totals", () => {
    const { reconciliation } = run();
    const stated = Object.fromEntries(reconciliation.map((r) => [r.metric, r.stated]));
    expect(stated).toEqual({
      sales_taxable: "2630.00",
      sales_tax: "336.60",
      sales_return_taxable: "76.00",
      purchase_taxable: "2500.00",
      purchase_return_taxable: "0.00",
      receipts: "1576.88",
      payments: "2800.00",
      channel_charges: "0.00"
    });
  });

  it("carries masters: groups, HSN, opening and closing stock, GSTIN states", () => {
    const { bundle } = run();
    expect(bundle.items.find((i) => i.code === "Ruled Notebook A5")).toMatchObject({ group: "Notebooks", hsnCode: "4820" });
    expect(bundle.items.find((i) => i.code === "Ruled Notebook A5")?.openingValue?.toFixed(2)).toBe("2500.00");
    expect(bundle.stockSnapshots.map((s) => [s.itemCode, s.qty.toFixed(), s.value?.toFixed(2)]).sort()).toEqual([
      ["Gel Pen Blue", "163", "815.00"],
      ["Ruled Notebook A5", "142", "3550.00"]
    ]);
    expect(bundle.parties.find((p) => p.code === "Customer B & Sons")).toMatchObject({ stateCode: "07", gstin: "07AAACB5678B1Z2" });
  });

  it("rejects a voucher whose items, GST and other ledgers do not add up to the party amount", () => {
    const broken = Buffer.from(fixture("daybook.xml").toString().replace("<AMOUNT>-2228.00</AMOUNT>\n       <BILLALLOCATIONS", "<AMOUNT>-2229.00</AMOUNT>\n       <BILLALLOCATIONS"));
    const { conversion } = run(files(broken));
    expect(conversion.issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual(["TALLY_UNBALANCED"]);
    expect(conversion.summary.imported.sales_invoice).toBe(3);
  });

  it("reports a truncated export as unreadable instead of importing part of it", () => {
    const whole = fixture("daybook.xml");
    const truncated = whole.subarray(0, Math.floor(whole.length * 0.6));
    expect(() => tallyToTemplate(files(truncated))).toThrow(/daybook.xml is not readable XML/);
  });

  it("refuses files that are not Tally XML, and any DTD (entity-expansion guard)", () => {
    expect(() => tallyToTemplate([{ name: "x.xml", content: Buffer.from("<html></html>") }])).toThrow(/not a Tally XML export/);
    const bomb = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><ENVELOPE>&b;</ENVELOPE>';
    expect(() => tallyToTemplate([{ name: "x.xml", content: Buffer.from(bomb) }])).toThrow(/DOCTYPE or ENTITY/);
  });
});
