import { Prisma } from "@prisma/client";
import { z } from "zod";
import { column, looseDate, looseMoney, normalise, readTable, type Table } from "@/server/adapters/marketplace/table";
import { toCsv } from "@/server/demo/csv";
import type { Issue } from "@/server/ingest/issues";
import type { UploadedFile } from "@/server/ingest/parse";
import {
  CONTROL_TOTAL_COLUMNS,
  ITEM_COLUMNS,
  PARTY_COLUMNS,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS,
  type ItemRow,
  type PartyRow,
  type TemplateVoucherType,
  type VoucherRow
} from "@/server/ingest/template";

/**
 * Sales and purchase registers exported to Excel or CSV from BUSY or any other accounting
 * package, read through a column mapping the owner confirms. One upload carries every register
 * of the period (sales, purchases and their returns), because an import replaces the period.
 *
 * NOT VERIFIED AGAINST REAL BUSY EXPORTS: BUSY publishes no export specification and none was
 * available. The suggested column names are common ones; the owner sees and corrects the mapping,
 * which is saved for the next upload.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const REGISTER_FIELDS = [
  { key: "date", label: "Date", required: true, synonyms: ["date", "vch date", "voucher date", "bill date", "invoice date", "inv date", "doc date"] },
  { key: "voucherNo", label: "Voucher / bill number", required: true, synonyms: ["vch no", "vch/bill no", "voucher no", "voucher number", "bill no", "invoice no", "inv no", "doc no", "vch/bill no."] },
  { key: "party", label: "Party (customer or supplier)", required: true, synonyms: ["party", "party name", "account", "account name", "customer", "supplier", "particulars", "name"] },
  { key: "item", label: "Item", required: true, synonyms: ["item", "item name", "item details", "product", "stock item", "description", "item description"] },
  { key: "qty", label: "Quantity", required: true, synonyms: ["qty", "quantity", "main qty", "qty.", "billed qty"] },
  { key: "unit", label: "Unit", required: false, synonyms: ["unit", "uom", "main unit"] },
  { key: "rate", label: "Rate (before tax)", required: false, synonyms: ["rate", "price", "item rate", "rate/unit"] },
  { key: "discount", label: "Discount amount", required: false, synonyms: ["discount", "disc amt", "discount amount", "disc."] },
  { key: "taxable", label: "Taxable amount", required: false, synonyms: ["taxable", "taxable amount", "taxable value", "amount", "value", "net amount", "item amount"] },
  { key: "gstRate", label: "GST %", required: false, synonyms: ["gst %", "gst rate", "tax rate", "rate of tax", "tax %", "gst%"] },
  { key: "tax", label: "Total GST", required: false, synonyms: ["tax", "tax amount", "gst", "gst amount", "total tax", "total gst"] },
  { key: "cgst", label: "CGST", required: false, synonyms: ["cgst", "cgst amount", "cgst amt"] },
  { key: "sgst", label: "SGST", required: false, synonyms: ["sgst", "sgst amount", "sgst amt", "utgst"] },
  { key: "igst", label: "IGST", required: false, synonyms: ["igst", "igst amount", "igst amt"] },
  { key: "totalInclTax", label: "Line total incl. GST", required: false, synonyms: ["total", "line total", "amount incl tax", "gross amount", "bill amount"] }
] as const;
export type RegisterField = (typeof REGISTER_FIELDS)[number]["key"];

export const VOUCHER_TYPE_LABELS: Record<TemplateVoucherType, string> = {
  sales_invoice: "Sales",
  purchase_invoice: "Purchases",
  sales_return: "Sales returns (credit notes)",
  purchase_return: "Purchase returns (debit notes)"
};

export const registerMappingSchema = z.object({
  file: z.string().min(1).max(255),
  voucherType: z.enum(["sales_invoice", "purchase_invoice", "sales_return", "purchase_return"]),
  /** Field -> header text in the file. */
  columns: z.record(z.string(), z.string().max(200))
});
export type RegisterMapping = z.infer<typeof registerMappingSchema>;

export class RegisterError extends Error {}

/** Header -> field suggestions (each header used once), and a voucher type guessed from the file name. */
export function suggestMapping(fileName: string, header: string[]): RegisterMapping {
  const used = new Set<number>();
  const columns: Record<string, string> = {};
  for (const f of REGISTER_FIELDS) {
    const names = header.map(normalise);
    const i = f.synonyms.map((s) => names.findIndex((n, idx) => n === normalise(s) && !used.has(idx))).find((idx) => idx >= 0);
    if (i !== undefined && i >= 0) {
      used.add(i);
      columns[f.key] = header[i];
    }
  }
  const n = fileName.toLowerCase();
  const voucherType: TemplateVoucherType = /credit ?note|sales? ?return/.test(n)
    ? "sales_return"
    : /debit ?note|purchase ?return/.test(n)
      ? "purchase_return"
      : /purch/.test(n)
        ? "purchase_invoice"
        : "sales_invoice";
  return { file: fileName, voucherType, columns };
}

/** The header row and a few rows of each file, with suggested mappings, for the mapping screen. */
export function previewRegisters(files: UploadedFile[]) {
  return files.map((f) => {
    const t = readTable(f);
    return { file: f.name, header: t.header, sample: t.rows.slice(0, 5), rows: t.rows.length, suggested: suggestMapping(f.name, t.header) };
  });
}

/** A signature of the headers, to reuse a saved mapping for the same kind of file. */
export const headerSignature = (header: string[]) => header.map(normalise).filter(Boolean).join("|");

const num = (v: string | undefined) => {
  const m = /-?[\d,]*\.?\d+/.exec((v ?? "").replace(/[₹\s]/g, ""));
  return m ? looseMoney(m[0]) : null;
};
const rupees = (d: Decimal) => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);

export type RegisterConversion = { files: UploadedFile[]; issues: Issue[]; summary: { registers: { file: string; voucherType: string; rows: number; lines: number; skipped: number; filledDown: number }[]; period: { from: string; to: string } | null; items: number; parties: number } };

export function convertRegisters(files: UploadedFile[], mappings: RegisterMapping[]): RegisterConversion {
  const issues: Issue[] = [];
  const warn = (code: string, message: string, rowRef?: string) => issues.push({ severity: "warning", code, entity: "voucher", message, rowRef });
  const items = new Map<string, ItemRow>();
  const parties = new Map<string, PartyRow & { roles: Set<string> }>();
  const vouchers: VoucherRow[] = [];
  const lineCount = new Map<string, number>();
  const summary: RegisterConversion["summary"]["registers"] = [];
  const dates: string[] = [];

  for (const mapping of mappings) {
    const file = files.find((f) => f.name === mapping.file);
    if (!file) throw new RegisterError(`${mapping.file} was not uploaded`);
    const t: Table = readTable(file);
    const col = (k: RegisterField) => (mapping.columns[k] ? column(t.header, [mapping.columns[k]]) : -1);
    const idx = Object.fromEntries(REGISTER_FIELDS.map((f) => [f.key, col(f.key)])) as Record<RegisterField, number>;
    for (const f of REGISTER_FIELDS) if (f.required && idx[f.key] < 0) throw new RegisterError(`${mapping.file}: choose the column for "${f.label}"`);
    if (idx.taxable < 0 && idx.rate < 0 && idx.totalInclTax < 0) throw new RegisterError(`${mapping.file}: choose a column for the taxable amount, the rate, or the line total incl. GST`);
    if (idx.totalInclTax >= 0 && idx.taxable < 0 && idx.rate < 0 && idx.gstRate < 0) throw new RegisterError(`${mapping.file}: with only a tax-inclusive total, the GST % column is needed to back out the tax`);

    const isSales = mapping.voucherType.startsWith("sales");
    const stats = { file: mapping.file, voucherType: mapping.voucherType, rows: t.rows.length, lines: 0, skipped: 0, filledDown: 0 };
    // Registers often print the date, number and party once per bill, with item lines below.
    let last = { date: "", voucherNo: "", party: "" };
    t.rows.forEach((row, i) => {
      const ref = `${mapping.file}:${i + 2}`;
      const cell = (k: RegisterField) => (idx[k] >= 0 ? (row[idx[k]] ?? "").trim() : "");
      const item = cell("item");
      const qty = num(cell("qty"));
      if (!item || qty === null || qty.isZero()) {
        stats.skipped += 1; // totals, blank lines, bill-level rows without items
        return;
      }
      let date = cell("date") ? looseDate(cell("date")) : null;
      let voucherNo = cell("voucherNo");
      let party = cell("party");
      if (!cell("date") && !voucherNo && !party && last.voucherNo) {
        ({ voucherNo, party } = last);
        date = last.date;
        stats.filledDown += 1;
      }
      if (!date || !voucherNo || !party) {
        warn("REGISTER_ROW_SKIPPED", `${ref}: missing or unreadable date, voucher number or party; row left out`, ref);
        stats.skipped += 1;
        return;
      }
      last = { date, voucherNo, party };
      dates.push(date);

      const discount = num(cell("discount")) ?? new D(0);
      const gstRateCell = num(cell("gstRate"));
      const splitTax = ["cgst", "sgst", "igst"].some((k) => idx[k as RegisterField] >= 0) ? (["cgst", "sgst", "igst"] as const).reduce((s, k) => s.add(num(cell(k)) ?? 0), new D(0)) : null;
      let taxable = idx.taxable >= 0 ? num(cell("taxable")) : null;
      const rate = num(cell("rate"));
      if (taxable === null && rate !== null) taxable = qty.abs().mul(rate).sub(discount);
      let tax = idx.tax >= 0 ? num(cell("tax")) : splitTax;
      const inclusive = idx.totalInclTax >= 0 ? num(cell("totalInclTax")) : null;
      const row_: Partial<VoucherRow> = {};
      let gstRate = gstRateCell;
      if (taxable === null && inclusive !== null && gstRate !== null) {
        row_.amount_incl_tax = rupees(inclusive.abs());
      } else if (taxable !== null) {
        taxable = taxable.abs();
        if (tax === null && gstRate !== null) tax = taxable.mul(gstRate).div(100);
        if (tax === null && inclusive !== null) tax = inclusive.abs().sub(taxable);
        tax = (tax ?? new D(0)).abs();
        if (gstRate === null) gstRate = taxable.isZero() ? new D(0) : nearestSlab(tax.div(taxable).mul(100));
      } else {
        warn("REGISTER_ROW_SKIPPED", `${ref}: no amount could be read; row left out`, ref);
        stats.skipped += 1;
        return;
      }

      const code = item.slice(0, 64);
      if (!items.has(code)) {
        items.set(code, { item_code: code, name: item, group: "Imported", uom: cell("unit") || unitOf(cell("qty")) || "pcs", hsn_code: "", gst_rate: (gstRate ?? new D(0)).toFixed(2), opening_qty: "0", opening_value: "", attributes_json: "{}" });
      }
      const partyCode = party.slice(0, 64);
      const p = parties.get(partyCode) ?? { party_code: partyCode, name: party, party_type: "customer", segment: "", city: "", state_code: "", gstin: "", credit_days: "", phone: "", email: "", buyer_identity: "named", roles: new Set<string>() };
      p.roles.add(isSales ? "customer" : "supplier");
      parties.set(partyCode, p);

      const key = `${mapping.voucherType}|${voucherNo}`;
      const lineNo = (lineCount.get(key) ?? 0) + 1;
      lineCount.set(key, lineNo);
      const q = qty.abs();
      vouchers.push({
        voucher_type: mapping.voucherType,
        voucher_no: voucherNo.slice(0, 64),
        date,
        party_code: partyCode,
        channel: "",
        order_ref: "",
        due_date: "",
        original_voucher_no: "",
        line_no: String(lineNo),
        item_code: code,
        qty: q.toFixed(),
        ...(taxable !== null ? fitRate(q, taxable, discount.abs()) : { rate: (rate ?? new D(0)).toFixed(4), discount_amount: rupees(discount.abs()) }),
        taxable_amount: taxable !== null ? rupees(taxable) : "",
        gst_rate: (gstRate ?? new D(0)).toFixed(2),
        tax_amount: taxable !== null ? rupees(tax!) : "",
        adjustment_incl_tax: "",
        ...row_
      });
      stats.lines += 1;
    });
    summary.push(stats);
    if (stats.filledDown) warn("REGISTER_FILLED_DOWN", `${mapping.file}: ${stats.filledDown} item lines had no date, number or party and were taken as part of the bill above them`);
  }
  if (vouchers.length === 0) throw new RegisterError("No item lines were found. Export the register with item details (one row per item).");

  const period = { from: dates.reduce((a, b) => (a < b ? a : b)), to: dates.reduce((a, b) => (a > b ? a : b)) };
  for (const p of parties.values()) p.party_type = p.roles.size > 1 ? "both" : [...p.roles][0];
  warn("REGISTER_NO_OPENING_STOCK", "Registers carry no opening stock, so stock levels and cost of goods sold stay unknown until opening stock is imported (items template, or Tally).");

  const sum = (type: string, f: (v: VoucherRow) => Decimal) => vouchers.filter((v) => v.voucher_type === type).reduce((s, v) => s.add(f(v)), new D(0));
  const taxableOf = (v: VoucherRow) => (v.taxable_amount ? new D(v.taxable_amount) : new D(v.amount_incl_tax!).mul(100).div(new D(v.gst_rate).add(100)).toDecimalPlaces(2, D.ROUND_HALF_UP));
  const taxOf = (v: VoucherRow) => (v.tax_amount ? new D(v.tax_amount) : new D(v.amount_incl_tax!).sub(taxableOf(v)));
  const controls: [string, Decimal][] = [
    ["sales_taxable", sum("sales_invoice", taxableOf)],
    ["sales_tax", sum("sales_invoice", taxOf)],
    ["sales_return_taxable", sum("sales_return", taxableOf)],
    ["purchase_taxable", sum("purchase_invoice", taxableOf)],
    ["purchase_return_taxable", sum("purchase_return", taxableOf)],
    ["receipts", new D(0)],
    ["payments", new D(0)],
    ["channel_charges", new D(0)]
  ];
  const partyRows = [...parties.values()].map(({ roles: _roles, ...p }) => p);
  return {
    files: [
      { name: TEMPLATE_FILES.items, content: Buffer.from(toCsv(ITEM_COLUMNS, [...items.values()])) },
      { name: TEMPLATE_FILES.parties, content: Buffer.from(toCsv(PARTY_COLUMNS, partyRows)) },
      { name: TEMPLATE_FILES.vouchers, content: Buffer.from(toCsv(VOUCHER_COLUMNS, vouchers)) },
      { name: TEMPLATE_FILES.controlTotals, content: Buffer.from(toCsv(CONTROL_TOTAL_COLUMNS, controls.map(([metric, value]) => ({ metric, period_from: period.from, period_to: period.to, value: rupees(value) })))) }
    ],
    issues,
    summary: { registers: summary, period, items: items.size, parties: parties.size }
  };
}

/**
 * A 4-decimal rate for which qty x rate - discount equals the stated taxable value to the paisa
 * (the template checks it). The rate is rounded up and any rounding goes into the discount, so the
 * taxable value, the figure that matters, is kept exactly as the register states it.
 */
export function fitRate(qty: Decimal, taxable: Decimal, discount: Decimal): { rate: string; discount_amount: string } {
  const rate = taxable.add(discount).div(qty).toDecimalPlaces(4, D.ROUND_CEIL);
  const gross = qty.mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return { rate: rate.toFixed(4), discount_amount: rupees(gross.sub(taxable)) };
}

const SLABS = [0, 0.25, 3, 5, 12, 18, 28];
function nearestSlab(pct: Decimal): Decimal {
  const v = pct.toNumber();
  return new D(SLABS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), SLABS[0]));
}
const unitOf = (qty: string) => /[a-z]+\.?$/i.exec(qty.trim())?.[0]?.replace(/\.$/, "").toLowerCase() ?? "";
