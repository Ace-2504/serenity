import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { convertRegisters, fitRate, RegisterError, suggestMapping } from "@/server/adapters/register";
import { IssueLog } from "@/server/ingest/issues";
import { parseBundle } from "@/server/ingest/parse";
import { emptyKnown, validateBundle } from "@/server/ingest/validate";

/** A register laid out the way accounting packages print one: bill details once, items below, a total row. */
const SALES = [
  "Date,Vch/Bill No,Particulars,Item Details,Qty.,Unit,Price,Amount,CGST,SGST,IGST",
  "01-04-2025,S-1,Sharma Stores,Ruled Notebook A5,10,Pcs,40.00,380.00,22.80,22.80,0.00",
  ",,,Gel Pen Blue,20,Pcs,10.00,200.00,18.00,18.00,0.00",
  "03-04-2025,S-2,Gupta Traders,Ruled Notebook A5,1000,Pcs,3.3337,3333.70,0.00,0.00,400.04",
  ",,Total,,1030,,,3913.70,40.80,40.80,400.04"
].join("\n");
const PURCHASES = ["Date,Bill No,Party Name,Item,Quantity,Taxable Value,GST %", "02-04-2025,P-77,Likhit Supplies,Ruled Notebook A5,500,9000.00,12"].join("\n");
const files = [
  { name: "Sales Register April.csv", content: Buffer.from(SALES) },
  { name: "Purchase Register April.csv", content: Buffer.from(PURCHASES) }
];

describe("spreadsheet registers (BUSY or other)", () => {
  it("suggests a mapping from common column names and the register type from the file name", () => {
    const m = suggestMapping("Purchase Register April.csv", ["Date", "Bill No", "Party Name", "Item", "Quantity", "Taxable Value", "GST %"]);
    expect(m).toMatchObject({ voucherType: "purchase_invoice", columns: { date: "Date", voucherNo: "Bill No", party: "Party Name", item: "Item", qty: "Quantity", taxable: "Taxable Value", gstRate: "GST %" } });
  });

  it("converts both registers into one bundle that imports with no errors", () => {
    const mappings = files.map((f) => suggestMapping(f.name, (f.content.toString().split("\n")[0] ?? "").split(",")));
    const conversion = convertRegisters(files, mappings);
    expect(conversion.summary.registers.map((r) => [r.voucherType, r.lines, r.skipped, r.filledDown])).toEqual([
      ["sales_invoice", 3, 1, 1],
      ["purchase_invoice", 1, 0, 0]
    ]);
    const log = new IssueLog();
    for (const i of conversion.issues) log.add(i);
    const bundle = parseBundle(conversion.files, log);
    const reconciliation = validateBundle(bundle, emptyKnown(), log);
    expect(log.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(reconciliation.every((r) => r.ok)).toBe(true);
    const s1 = bundle.vouchers.find((v) => v.number === "S-1")!;
    expect(s1.lines.map((l) => `${l.itemCode} ${l.taxableAmount.toFixed(2)} ${l.taxAmount.toFixed(2)} ${l.taxRate.toFixed(0)}`)).toEqual(["Ruled Notebook A5 380.00 45.60 12", "Gel Pen Blue 200.00 36.00 18"]);
    expect(bundle.parties.find((p) => p.code === "Likhit Supplies")?.kind).toBe("supplier");
  });

  it("insists on the columns it cannot do without", () => {
    expect(() => convertRegisters(files.slice(1), [{ file: files[1].name, voucherType: "purchase_invoice", columns: { date: "Date", voucherNo: "Bill No", party: "Party Name", qty: "Quantity", taxable: "Taxable Value" } }])).toThrow(RegisterError);
  });

  it("keeps the stated taxable value exactly, whatever the quantity", () => {
    const D = Prisma.Decimal;
    for (const [qty, taxable] of [["1000", "3333.70"], ["7", "100.00"], ["3", "10.00"]]) {
      const { rate, discount_amount } = fitRate(new D(qty), new D(taxable), new D(0));
      expect(new D(qty).mul(rate).toDecimalPlaces(2).sub(discount_amount).toFixed(2)).toBe(taxable);
      expect(Number(discount_amount)).toBeGreaterThanOrEqual(0);
    }
  });
});
