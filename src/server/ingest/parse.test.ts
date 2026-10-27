import { beforeAll, describe, expect, it } from "vitest";
import { toCsv } from "@/server/demo/csv";
import { generateDemoDataset, type DemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { IssueLog } from "@/server/ingest/issues";
import { bundleHash, parseBundle, type UploadedFile } from "@/server/ingest/parse";
import {
  CONTROL_TOTAL_COLUMNS,
  ITEM_COLUMNS,
  PARTY_COLUMNS,
  SETTLEMENT_COLUMNS,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS,
  type ControlTotalRow,
  type ItemRow,
  type PartyRow,
  type SettlementRow,
  type VoucherRow
} from "@/server/ingest/template";
import { emptyKnown, validateBundle, type KnownRecords } from "@/server/ingest/validate";

// ── A tiny hand-built bundle: one customer, one supplier, two items, one sale ──

const item = (over: Partial<ItemRow> = {}): ItemRow => ({
  item_code: "NB-1",
  name: "Ruled notebook",
  group: "Notebooks",
  uom: "pcs",
  hsn_code: "4820",
  gst_rate: "12.00",
  opening_qty: "100",
  opening_value: "2500.00",
  attributes_json: "{}",
  ...over
});
const party = (over: Partial<PartyRow> = {}): PartyRow => ({
  party_code: "C1",
  name: "Customer One",
  party_type: "customer",
  segment: "retailer",
  city: "Noida",
  state_code: "09",
  gstin: "",
  credit_days: "30",
  phone: "",
  email: "",
  buyer_identity: "named",
  ...over
});
const line = (over: Partial<VoucherRow> = {}): VoucherRow => ({
  voucher_type: "sales_invoice",
  voucher_no: "SI-1",
  date: "2026-04-10",
  party_code: "C1",
  channel: "direct",
  order_ref: "",
  due_date: "2026-05-10",
  original_voucher_no: "",
  line_no: "1",
  item_code: "NB-1",
  qty: "10",
  rate: "40.00",
  discount_amount: "20.00",
  taxable_amount: "380.00",
  gst_rate: "12.00",
  tax_amount: "45.60",
  adjustment_incl_tax: "",
  ...over
});
const controls = (over: Record<string, string> = {}): ControlTotalRow[] =>
  Object.entries({
    sales_taxable: "380.00",
    sales_tax: "45.60",
    sales_return_taxable: "0.00",
    purchase_taxable: "0.00",
    purchase_return_taxable: "0.00",
    receipts: "0.00",
    payments: "0.00",
    channel_charges: "0.00",
    ...over
  }).map(([metric, value]) => ({ metric, period_from: "2026-04-01", period_to: "2026-06-30", value }));

type Mini = { items?: ItemRow[]; parties?: PartyRow[]; vouchers?: VoucherRow[]; settlements?: SettlementRow[]; controls?: ControlTotalRow[]; omit?: string[]; raw?: Record<string, string> };

function miniFiles(m: Mini = {}): UploadedFile[] {
  const files: Record<string, string> = {
    [TEMPLATE_FILES.items]: toCsv(ITEM_COLUMNS, m.items ?? [item(), item({ item_code: "PEN-1", name: "Gel pen", group: "Pens", gst_rate: "18.00" })]),
    [TEMPLATE_FILES.parties]: toCsv(PARTY_COLUMNS, m.parties ?? [party(), party({ party_code: "S1", name: "Supplier One", party_type: "supplier" })]),
    [TEMPLATE_FILES.vouchers]: toCsv(VOUCHER_COLUMNS, m.vouchers ?? [line()]),
    [TEMPLATE_FILES.settlements]: toCsv(SETTLEMENT_COLUMNS, m.settlements ?? []),
    [TEMPLATE_FILES.controlTotals]: toCsv(CONTROL_TOTAL_COLUMNS, m.controls ?? controls()),
    ...m.raw
  };
  return Object.entries(files)
    .filter(([name]) => !(m.omit ?? []).includes(name))
    .map(([name, text]) => ({ name, content: Buffer.from(text) }));
}

function run(files: UploadedFile[], known: KnownRecords = emptyKnown()) {
  const log = new IssueLog();
  const bundle = parseBundle(files, log);
  const reconciliation = validateBundle(bundle, known, log);
  return { bundle, reconciliation, log, codes: log.issues.map((i) => `${i.severity}:${i.code}`) };
}

describe("the generated demo bundle", () => {
  let data: DemoDataset;
  beforeAll(() => {
    data = generateDemoDataset(stationeryDemoProfile, 42);
  }, 60_000);

  it("parses with no errors and reconciles exactly to its control totals", () => {
    const { bundle, reconciliation, log } = run(datasetToFiles(data));
    expect(log.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(reconciliation.length).toBe(8);
    expect(reconciliation.every((r) => r.ok && r.difference === "0.00")).toBe(true);
    expect(bundle.vouchers.length).toBe(new Set(data.vouchers.map((v) => `${v.voucher_type}|${v.voucher_no}`)).size);
  }, 60_000);

  it("warns only about the planted missing opening values", () => {
    const { log } = run(datasetToFiles(data));
    const warnings = log.issues.filter((i) => i.severity === "warning");
    expect(warnings.map((w) => w.code)).toEqual(Array(data.groundTruth.planted.missingOpeningValue.length).fill("MISSING_OPENING_VALUE"));
  }, 60_000);
});

describe("file-level checks", () => {
  it("accepts a valid minimal bundle", () => {
    const { codes, reconciliation } = run(miniFiles());
    expect(codes).toEqual([]);
    expect(reconciliation.every((r) => r.ok)).toBe(true);
  });

  it("requires the mandatory files and columns", () => {
    expect(run(miniFiles({ omit: [TEMPLATE_FILES.vouchers] })).codes).toContain("error:MISSING_FILE");
    const noRate = toCsv(VOUCHER_COLUMNS.filter((c) => c !== "rate"), [line()]);
    expect(run(miniFiles({ raw: { [TEMPLATE_FILES.vouchers]: noRate } })).codes).toContain("error:MISSING_COLUMN");
  });

  it("handles a UTF-8 BOM, CRLF line endings and quoted commas", () => {
    const text = "﻿" + toCsv(PARTY_COLUMNS, [party({ name: 'Sharma & Sons, "Wholesale"' }), party({ party_code: "S1", party_type: "supplier" })]);
    const { bundle, codes } = run(miniFiles({ raw: { [TEMPLATE_FILES.parties]: text } }));
    expect(codes).toEqual([]);
    expect(bundle.parties[0].name).toBe('Sharma & Sons, "Wholesale"');
  });

  it("reports malformed CSV instead of throwing", () => {
    const broken = `${VOUCHER_COLUMNS.join(",")}\r\nsales_invoice,"unterminated\r\n`;
    expect(run(miniFiles({ raw: { [TEMPLATE_FILES.vouchers]: broken } })).codes).toContain("error:CSV_PARSE_ERROR");
  });

  it("warns about files and columns that are not in the template", () => {
    const { codes } = run([...miniFiles(), { name: "notes.csv", content: Buffer.from("a\n1\n") }]);
    expect(codes).toContain("warning:UNKNOWN_FILE");
  });

  it("strips the spreadsheet formula guard from text cells", () => {
    const text = toCsv(PARTY_COLUMNS, [party({ name: "=Dangerous" }), party({ party_code: "S1", party_type: "supplier" })]);
    expect(text).toContain("'=Dangerous");
    expect(run(miniFiles({ raw: { [TEMPLATE_FILES.parties]: text } })).bundle.parties[0].name).toBe("=Dangerous");
  });

  it("identifies a bundle by content, not by upload order or path", () => {
    const files = miniFiles();
    const hash = (f: UploadedFile[]) => run(f).bundle.bundleSha256;
    expect(hash([...files].reverse())).toBe(hash(files));
    expect(hash(files.map((f) => ({ ...f, name: `exports/2026/${f.name}` })))).toBe(hash(files));
    expect(hash(miniFiles({ vouchers: [line({ qty: "11", taxable_amount: "420.00", tax_amount: "50.40" })] }))).not.toBe(hash(files));
    expect(bundleHash([{ name: "a", sha256: "1" }])).not.toBe(bundleHash([{ name: "b", sha256: "1" }]));
  });
});

describe("row-level checks", () => {
  it.each([
    ["date", { date: "10-04-2026" }],
    ["impossible date", { date: "2026-02-30" }],
    ["zero quantity", { qty: "0" }],
    ["negative quantity", { qty: "-5" }],
    ["text amount", { taxable_amount: "three hundred" }],
    ["too many decimals", { taxable_amount: "380.001" }],
    ["unknown voucher type", { voucher_type: "journal" }]
  ])("rejects an invalid %s", (_label, over) => {
    const { codes, log } = run(miniFiles({ vouchers: [line(over as Partial<VoucherRow>)] }));
    expect(codes).toContain("error:INVALID_VALUE");
    expect(log.issues.find((i) => i.code === "INVALID_VALUE")?.rowRef).toBe("vouchers.csv:2");
  });

  it("rejects attributes that are not a JSON object", () => {
    expect(run(miniFiles({ items: [item({ attributes_json: "[1,2]" })] })).codes).toContain("error:INVALID_VALUE");
  });
});

describe("cross-row checks", () => {
  it("checks taxable = qty x rate - discount to the paisa", () => {
    const { codes } = run(miniFiles({ vouchers: [line({ taxable_amount: "380.50", tax_amount: "45.66" })], controls: controls({ sales_taxable: "380.50", sales_tax: "45.66" }) }));
    expect(codes).toContain("error:LINE_ARITHMETIC");
  });

  it("tolerates tax rounding up to a rupee as a warning, and rejects more", () => {
    const rounding = run(miniFiles({ vouchers: [line({ tax_amount: "46.00" })], controls: controls({ sales_tax: "46.00" }) }));
    expect(rounding.codes).toEqual(["warning:TAX_ROUNDING"]);
    const wrong = run(miniFiles({ vouchers: [line({ tax_amount: "68.40" })], controls: controls({ sales_tax: "68.40" }) }));
    expect(wrong.codes).toContain("error:TAX_ARITHMETIC");
  });

  it("rejects lines of one voucher that disagree on header fields", () => {
    const vouchers = [line(), line({ line_no: "2", item_code: "PEN-1", party_code: "C2" })];
    expect(run(miniFiles({ vouchers })).codes).toContain("error:VOUCHER_HEADER_MISMATCH");
  });

  it("rejects duplicate line numbers and duplicate master codes", () => {
    expect(run(miniFiles({ vouchers: [line(), line({ item_code: "PEN-1" })] })).codes).toContain("error:DUPLICATE_LINE");
    expect(run(miniFiles({ items: [item(), item()] })).codes).toContain("error:DUPLICATE_KEY");
  });

  it("rejects unknown items and parties, unless an earlier import knows them", () => {
    const vouchers = [line({ item_code: "OLD-9", party_code: "C9" })];
    const fresh = run(miniFiles({ vouchers }));
    expect(fresh.codes).toEqual(expect.arrayContaining(["error:UNKNOWN_ITEM", "error:UNKNOWN_PARTY"]));
    const known: KnownRecords = { itemCodes: new Set(["OLD-9"]), parties: new Map([["C9", "customer"]]), voucherKeys: new Set() };
    expect(run(miniFiles({ vouchers }), known).codes).toEqual([]);
  });

  it("rejects a sale to a supplier", () => {
    expect(run(miniFiles({ vouchers: [line({ party_code: "S1" })] })).codes).toContain("error:PARTY_ROLE_MISMATCH");
  });

  it("rejects vouchers outside the stated period", () => {
    expect(run(miniFiles({ vouchers: [line({ date: "2026-07-01", due_date: "" })] })).codes).toContain("error:OUTSIDE_PERIOD");
  });

  it("reports a control-total mismatch with the difference", () => {
    const { codes, reconciliation } = run(miniFiles({ controls: controls({ sales_taxable: "400.00" }) }));
    expect(codes).toContain("error:CONTROL_TOTAL_MISMATCH");
    expect(reconciliation.find((r) => r.metric === "sales_taxable")).toMatchObject({ stated: "400.00", computed: "380.00", difference: "-20.00", ok: false });
  });

  it("flags returns that exceed what was sold, and returns to a different party", () => {
    const ret = (over: Partial<VoucherRow>) =>
      line({ voucher_type: "sales_return", voucher_no: "CN-1", date: "2026-04-15", due_date: "", original_voucher_no: "SI-1", qty: "12", discount_amount: "24.00", taxable_amount: "456.00", tax_amount: "54.72", ...over });
    const exceed = run(miniFiles({ vouchers: [line(), ret({})], controls: controls({ sales_return_taxable: "456.00" }) }));
    expect(exceed.codes).toContain("warning:RETURN_EXCEEDS_SALE");
    const parties = [party(), party({ party_code: "C2", name: "Customer Two" }), party({ party_code: "S1", party_type: "supplier" })];
    const other = run(miniFiles({ parties, vouchers: [line(), ret({ party_code: "C2", qty: "1", discount_amount: "2.00", taxable_amount: "38.00", tax_amount: "4.56" })], controls: controls({ sales_return_taxable: "38.00" }) }));
    expect(other.codes).toContain("error:RETURN_PARTY_MISMATCH");
  });

  it("warns about receipts against unknown bills and over-settlement", () => {
    const settle = (against: string, amount: string): SettlementRow => ({ voucher_type: "receipt", voucher_no: "RC-1", date: "2026-05-01", party_code: "C1", against_voucher_no: against, amount });
    expect(run(miniFiles({ settlements: [settle("SI-404", "100.00")], controls: controls({ receipts: "100.00" }) })).codes).toEqual(["warning:UNKNOWN_BILL"]);
    expect(run(miniFiles({ settlements: [settle("SI-1", "500.00")], controls: controls({ receipts: "500.00" }) })).codes).toEqual(["warning:OVER_SETTLED"]);
  });

  it("warns when opening stock has no value", () => {
    expect(run(miniFiles({ items: [item({ opening_value: "" }), item({ item_code: "PEN-1" })] })).codes).toEqual(["warning:MISSING_OPENING_VALUE"]);
  });
});

describe("bill-level adjustments (round-off, freight)", () => {
  it("adds the adjustment to the bill only, not to sales", () => {
    const { bundle, codes, reconciliation } = run(miniFiles({ vouchers: [line({ adjustment_incl_tax: "0.40" })] }));
    expect(codes).toEqual([]);
    expect(bundle.vouchers[0].adjustment?.toFixed(2)).toBe("0.40");
    expect(reconciliation.every((r) => r.ok)).toBe(true);
  });

  it("leaves the voucher's content hash unchanged when there is no adjustment", () => {
    const { bundle } = run(miniFiles());
    expect("adjustment" in bundle.vouchers[0]).toBe(false);
  });

  it("rejects different adjustments on lines of the same voucher", () => {
    const vouchers = [line({ adjustment_incl_tax: "0.40" }), line({ line_no: "2", adjustment_incl_tax: "-0.10" })];
    expect(run(miniFiles({ vouchers })).codes).toContain("error:VOUCHER_HEADER_MISMATCH");
  });
});

describe("batches, expiry, MRP and tax-inclusive lines", () => {
  // A chemist's sale at MRP: 2 strips at Rs 56.00 each incl. 12% GST, 10% off -> Rs 100.80 incl. GST.
  const sale = (over: Partial<VoucherRow> = {}) =>
    line({ qty: "2", rate: "56.00", discount_amount: "", taxable_amount: "", tax_amount: "", amount_incl_tax: "100.80", batch_no: "B23", expiry_date: "2027-03-31", mrp: "56.00", ...over });

  it("backs GST out of a tax-inclusive line total", () => {
    const { bundle, codes } = run(miniFiles({ vouchers: [sale()], controls: controls({ sales_taxable: "90.00", sales_tax: "10.80" }) }));
    expect(codes).toEqual([]);
    const l = bundle.vouchers[0].lines[0];
    expect([l.taxableAmount.toFixed(2), l.taxAmount.toFixed(2), l.grossAmount.toFixed(2), l.rate.toFixed(4), l.inclusive]).toEqual(["90.00", "10.80", "90.00", "45.0000", true]);
    expect([l.batchNo, l.expiryDate, l.mrp?.toFixed(2)]).toEqual(["B23", "2027-03-31", "56.00"]);
  });

  it("still requires an amount when neither form is given", () => {
    expect(run(miniFiles({ vouchers: [sale({ amount_incl_tax: "" })] })).codes).toContain("error:INVALID_VALUE");
  });

  it("flags a sale above MRP and a sale after expiry, without rejecting the import", () => {
    const { codes } = run(miniFiles({ vouchers: [sale({ amount_incl_tax: "123.20", expiry_date: "2026-03-31" })], controls: controls({ sales_taxable: "110.00", sales_tax: "13.20" }) }));
    expect(codes.sort()).toEqual(["warning:ABOVE_MRP", "warning:SOLD_AFTER_EXPIRY"]);
  });

  it("requires opening batches to add up to the item's opening stock", () => {
    const batches = (rows: string[]) => ({ [TEMPLATE_FILES.batches]: `item_code,batch_no,expiry_date,mfg_date,mrp,opening_qty,opening_value\r\n${rows.join("\r\n")}\r\n` });
    const ok = run(miniFiles({ raw: batches(["NB-1,A1,2027-01-31,,,60,", "NB-1,A2,2027-06-30,,,40,"]) }));
    expect(ok.codes).toEqual([]);
    expect(ok.bundle.batches.map((b) => `${b.batchNo}:${b.openingQty.toFixed()}`)).toEqual(["A1:60", "A2:40"]);
    expect(run(miniFiles({ raw: batches(["NB-1,A1,2027-01-31,,,60,"]) })).codes).toContain("error:BATCH_OPENING_MISMATCH");
    expect(run(miniFiles({ raw: batches(["NB-1,A1,2027-01-31,2027-02-01,,100,"]) })).codes).toContain("error:INVALID_VALUE");
  });

  it("warns when the same batch is given two different expiry dates", () => {
    const { codes } = run(
      miniFiles({ vouchers: [sale(), sale({ line_no: "2", expiry_date: "2027-04-30" })], controls: controls({ sales_taxable: "180.00", sales_tax: "21.60" }) })
    );
    expect(codes).toEqual(["warning:BATCH_EXPIRY_CONFLICT"]);
  });
});
