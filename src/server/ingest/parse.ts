import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { IssueLog } from "@/server/ingest/issues";
import {
  CHANNEL_CHARGE_COLUMNS,
  CONTROL_TOTAL_COLUMNS,
  CONTROL_TOTAL_METRICS,
  CUSTOMER_ORDER_COLUMNS,
  BATCH_COLUMNS,
  ITEM_COLUMNS,
  OUTSTANDING_COLUMNS,
  PARTY_COLUMNS,
  SETTLEMENT_COLUMNS,
  STOCK_SUMMARY_COLUMNS,
  TAX_WITHHELD_CHARGE_TYPES,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS
} from "@/server/ingest/template";

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS_PER_FILE = 1_000_000;

export type UploadedFile = { name: string; content: Buffer };

export type ItemDraft = {
  rowRef: string;
  code: string;
  name: string;
  group: string;
  uom: string;
  hsnCode: string | null;
  gstRate: Decimal | null;
  openingQty: Decimal;
  openingValue: Decimal | null;
  attributes: Record<string, unknown>;
};

export type PartyDraft = {
  rowRef: string;
  code: string;
  name: string;
  kind: "customer" | "supplier" | "both";
  segment: string | null;
  city: string | null;
  stateCode: string | null;
  gstin: string | null;
  creditDays: number | null;
  phone: string | null;
  email: string | null;
  anonymousBuyers: boolean;
};

export type VoucherKind = "sales_invoice" | "sales_return" | "purchase_invoice" | "purchase_return";

export type LineDraft = {
  rowRef: string;
  lineNo: number;
  itemCode: string;
  qty: Decimal;
  rate: Decimal;
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxRate: Decimal;
  taxAmount: Decimal;
  // Present only when given, so imports without them hash as before.
  batchNo?: string;
  expiryDate?: string;
  /** Per unit, tax-inclusive. */
  mrp?: Decimal;
  /** Taxable and tax were backed out of a tax-inclusive line total. */
  inclusive?: true;
};

export type BatchDraft = {
  rowRef: string;
  itemCode: string;
  batchNo: string;
  expiryDate: string | null;
  mfgDate: string | null;
  mrp: Decimal | null;
  openingQty: Decimal;
  openingValue: Decimal | null;
};

export type VoucherDraft = {
  key: string;
  /** Index of the voucher's first row in the file: the source's posting order. */
  seq: number;
  type: VoucherKind;
  number: string;
  date: string;
  partyCode: string;
  channel: string | null;
  orderRef: string | null;
  dueDate: string | null;
  originalNumber: string | null;
  /**
   * Bill-level amount that is not an item line (round-off, freight, packing, incl. any GST on
   * it). Added to the bill total only. Absent when zero, so older imports hash the same.
   */
  adjustment?: Decimal;
  lines: LineDraft[];
};

export type SettlementDraft = {
  key: string;
  type: "receipt" | "payment";
  number: string;
  date: string;
  partyCode: string;
  allocations: { rowRef: string; againstNumber: string; amount: Decimal }[];
};

export type ChargeDraft = {
  rowRef: string;
  key: string;
  channel: string;
  settlementRef: string;
  settlementDate: string;
  orderNumber: string | null;
  chargeType: string;
  amount: Decimal;
  gstAmount: Decimal;
  isTaxWithheld: boolean;
};

export type StockSnapshotDraft = { rowRef: string; itemCode: string; asOf: string; qty: Decimal; value: Decimal | null; valuationMethod: string | null };

export type OutstandingDraft = {
  rowRef: string;
  partyCode: string;
  side: "receivable" | "payable";
  billRef: string;
  billDate: string;
  dueDate: string | null;
  amountInclTax: Decimal;
  pendingInclTax: Decimal;
  asOf: string;
};

export type ControlTotalDraft = { rowRef: string; metric: (typeof CONTROL_TOTAL_METRICS)[number]; from: string; to: string; value: Decimal };

export type CustomerOrderDraft = {
  rowRef: string;
  key: string;
  channel: string;
  poNumber: string;
  poDate: string;
  partyCode: string;
  itemCode: string;
  qtyOrdered: Decimal;
  qtySupplied: Decimal;
  unitPrice: Decimal | null;
  grnDate: string | null;
};

export type ParsedBundle = {
  bundleSha256: string;
  /** "books": the business's accounts; "channel": marketplace or platform files only (charges, POs). */
  kind: "books" | "channel";
  files: { name: string; sha256: string; sizeBytes: number; rows: number }[];
  items: ItemDraft[];
  parties: PartyDraft[];
  vouchers: VoucherDraft[];
  settlements: SettlementDraft[];
  charges: ChargeDraft[];
  customerOrders: CustomerOrderDraft[];
  stockSnapshots: StockSnapshotDraft[];
  outstanding: OutstandingDraft[];
  controlTotals: ControlTotalDraft[];
  batches: BatchDraft[];
};

type FileSpec = { file: string; entity: string; columns: readonly string[]; required: readonly string[]; mandatory: boolean };

const SPECS: FileSpec[] = [
  { file: TEMPLATE_FILES.items, entity: "item", columns: ITEM_COLUMNS, required: ["item_code", "name", "group", "uom", "opening_qty"], mandatory: true },
  { file: TEMPLATE_FILES.parties, entity: "party", columns: PARTY_COLUMNS, required: ["party_code", "name", "party_type"], mandatory: true },
  {
    file: TEMPLATE_FILES.vouchers,
    entity: "voucher",
    columns: VOUCHER_COLUMNS,
    // taxable_amount and tax_amount may be replaced by amount_incl_tax (checked per row).
    required: ["voucher_type", "voucher_no", "date", "party_code", "line_no", "item_code", "qty", "rate", "gst_rate"],
    mandatory: true
  },
  { file: TEMPLATE_FILES.batches, entity: "batch", columns: BATCH_COLUMNS, required: ["item_code", "batch_no", "opening_qty"], mandatory: false },
  { file: TEMPLATE_FILES.controlTotals, entity: "control_total", columns: CONTROL_TOTAL_COLUMNS, required: CONTROL_TOTAL_COLUMNS, mandatory: true },
  { file: TEMPLATE_FILES.settlements, entity: "settlement", columns: SETTLEMENT_COLUMNS, required: SETTLEMENT_COLUMNS, mandatory: false },
  { file: TEMPLATE_FILES.stockSummary, entity: "stock_snapshot", columns: STOCK_SUMMARY_COLUMNS, required: ["item_code", "as_of", "qty"], mandatory: false },
  {
    file: TEMPLATE_FILES.outstanding,
    entity: "outstanding",
    columns: OUTSTANDING_COLUMNS,
    required: ["party_code", "side", "bill_ref", "bill_date", "amount_incl_tax", "pending_incl_tax", "as_of"],
    mandatory: false
  },
  {
    file: TEMPLATE_FILES.channelCharges,
    entity: "channel_charge",
    columns: CHANNEL_CHARGE_COLUMNS,
    required: ["channel", "settlement_ref", "settlement_date", "charge_type", "amount"],
    mandatory: false
  },
  {
    file: TEMPLATE_FILES.customerOrders,
    entity: "customer_order",
    columns: CUSTOMER_ORDER_COLUMNS,
    required: ["channel", "po_number", "po_date", "party_code", "item_code", "qty_ordered", "qty_supplied"],
    mandatory: false
  }
];

/** Books files are required unless the upload holds only channel files (charges, customer POs). */
const BOOKS_FILES: string[] = [TEMPLATE_FILES.items, TEMPLATE_FILES.parties, TEMPLATE_FILES.vouchers];
const CHANNEL_FILES: string[] = [TEMPLATE_FILES.channelCharges, TEMPLATE_FILES.customerOrders];

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Bundle identity: independent of upload order and of file paths, sensitive to every byte. */
export function bundleHash(files: { name: string; sha256: string }[]): string {
  return sha256(
    files
      .map((f) => `${f.name}\u0000${f.sha256}`)
      .sort()
      .join("\n")
  );
}

type Row = { get(column: string): string; rowRef: string };

/**
 * Parses an uploaded template bundle into typed drafts. Pure: no database access.
 * Never throws on bad data; every problem is recorded in `log`.
 */
export function parseBundle(uploads: UploadedFile[], log: IssueLog): ParsedBundle {
  const byName = new Map<string, UploadedFile>();
  for (const upload of uploads) {
    const name = upload.name.split(/[\\/]/).pop()!.toLowerCase();
    if (byName.has(name)) {
      log.error("DUPLICATE_FILE", "bundle", `${name} was uploaded more than once`);
      continue;
    }
    byName.set(name, upload);
  }
  for (const name of byName.keys()) {
    if (!SPECS.some((spec) => spec.file === name)) {
      log.warning("UNKNOWN_FILE", "bundle", `${name} is not part of the template and was ignored`);
    }
  }

  const kind: ParsedBundle["kind"] = !byName.has(TEMPLATE_FILES.vouchers) && CHANNEL_FILES.some((f) => byName.has(f)) ? "channel" : "books";
  const files: ParsedBundle["files"] = [];
  const rowsOf = (spec: FileSpec): Row[] => {
    const upload = byName.get(spec.file);
    if (!upload) {
      const mandatory = spec.mandatory && !(kind === "channel" && BOOKS_FILES.includes(spec.file));
      if (mandatory) log.error("MISSING_FILE", "bundle", `${spec.file} is required`);
      return [];
    }
    const meta = { name: spec.file, sha256: sha256(upload.content), sizeBytes: upload.content.length, rows: 0 };
    files.push(meta);
    if (upload.content.length > MAX_FILE_BYTES) {
      log.error("FILE_TOO_LARGE", spec.entity, `${spec.file} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      return [];
    }
    let records: { record: string[]; info: { lines: number } }[];
    try {
      records = parseCsv(upload.content, { bom: true, info: true, skip_empty_lines: true, relax_column_count: false }) as unknown as typeof records;
    } catch (error) {
      log.error("CSV_PARSE_ERROR", spec.entity, `${spec.file}: ${(error as Error).message}`);
      return [];
    }
    if (records.length === 0) {
      log.error("EMPTY_FILE", spec.entity, `${spec.file} has no header row`);
      return [];
    }
    const header = records[0].record.map((h) => h.trim().toLowerCase());
    const missing = spec.required.filter((column) => !header.includes(column));
    if (missing.length > 0) {
      log.error("MISSING_COLUMN", spec.entity, `${spec.file} is missing column(s): ${missing.join(", ")}`);
      return [];
    }
    for (const column of header) {
      if (!spec.columns.includes(column)) {
        log.warning("UNKNOWN_COLUMN", spec.entity, `${spec.file}: column "${column}" is not in the template and was ignored`);
      }
    }
    const body = records.slice(1);
    if (body.length > MAX_ROWS_PER_FILE) {
      log.error("TOO_MANY_ROWS", spec.entity, `${spec.file} has more than ${MAX_ROWS_PER_FILE} rows`);
      return [];
    }
    meta.rows = body.length;
    const index = new Map(header.map((h, i) => [h, i]));
    return body.map(({ record, info }) => ({
      rowRef: `${spec.file}:${info.lines}`,
      get: (column: string) => {
        const i = index.get(column);
        return i === undefined ? "" : unguard(record[i].trim());
      }
    }));
  };

  const spec = (file: string) => SPECS.find((s) => s.file === file)!;
  const items = parseItems(rowsOf(spec(TEMPLATE_FILES.items)), log);
  const parties = parseParties(rowsOf(spec(TEMPLATE_FILES.parties)), log);
  const vouchers = parseVouchers(rowsOf(spec(TEMPLATE_FILES.vouchers)), log);
  const controlTotals = parseControlTotals(rowsOf(spec(TEMPLATE_FILES.controlTotals)), log);
  const settlements = parseSettlements(rowsOf(spec(TEMPLATE_FILES.settlements)), log);
  const stockSnapshots = parseStockSnapshots(rowsOf(spec(TEMPLATE_FILES.stockSummary)), log);
  const outstanding = parseOutstanding(rowsOf(spec(TEMPLATE_FILES.outstanding)), log);
  const charges = parseCharges(rowsOf(spec(TEMPLATE_FILES.channelCharges)), log);
  const customerOrders = parseCustomerOrders(rowsOf(spec(TEMPLATE_FILES.customerOrders)), log);
  const batches = parseBatches(rowsOf(spec(TEMPLATE_FILES.batches)), log);

  return { bundleSha256: bundleHash(files), kind, files, items, parties, vouchers, settlements, charges, customerOrders, stockSnapshots, outstanding, controlTotals, batches };
}

/** Our CSV writer prefixes formula-like text with an apostrophe; undo that on the way in. */
function unguard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

// ── Field readers: return null and log an issue on bad input ──────────────────

class FieldReader {
  constructor(
    private readonly row: Row,
    private readonly entity: string,
    private readonly log: IssueLog
  ) {}

  private fail(field: string, message: string): null {
    this.log.error("INVALID_VALUE", this.entity, message, { rowRef: this.row.rowRef, field });
    return null;
  }

  text(field: string, opts: { required?: boolean; max?: number } = {}): string | null {
    const value = this.row.get(field);
    if (value === "") return opts.required ? this.fail(field, `${field} is required`) : null;
    if (value.length > (opts.max ?? 300)) return this.fail(field, `${field} is longer than ${opts.max ?? 300} characters`);
    return value;
  }

  decimal(field: string, opts: { required?: boolean; scale: number; allowNegative?: boolean; positive?: boolean }): Decimal | null {
    const value = this.row.get(field);
    if (value === "") return opts.required ? this.fail(field, `${field} is required`) : null;
    const pattern = new RegExp(`^${opts.allowNegative ? "-?" : ""}\\d{1,15}(\\.\\d{1,${opts.scale}})?$`);
    if (!pattern.test(value)) return this.fail(field, `${field} "${value}" is not a number with at most ${opts.scale} decimals`);
    const parsed = new D(value);
    if (opts.positive && parsed.lte(0)) return this.fail(field, `${field} must be greater than zero`);
    return parsed;
  }

  integer(field: string, opts: { required?: boolean; min?: number } = {}): number | null {
    const value = this.row.get(field);
    if (value === "") return opts.required ? this.fail(field, `${field} is required`) : null;
    if (!/^-?\d{1,9}$/.test(value) || Number(value) < (opts.min ?? 0)) return this.fail(field, `${field} "${value}" is not a whole number >= ${opts.min ?? 0}`);
    return Number(value);
  }

  date(field: string, opts: { required?: boolean } = {}): string | null {
    const value = this.row.get(field);
    if (value === "") return opts.required ? this.fail(field, `${field} is required`) : null;
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    return valid ? value : this.fail(field, `${field} "${value}" is not a valid date (use YYYY-MM-DD)`);
  }

  oneOf<T extends string>(field: string, values: readonly T[], opts: { required?: boolean; fallback?: T } = {}): T | null {
    const value = this.row.get(field).toLowerCase();
    if (value === "") return opts.fallback ?? (opts.required ? this.fail(field, `${field} is required`) : null);
    return (values as readonly string[]).includes(value) ? (value as T) : this.fail(field, `${field} "${value}" must be one of: ${values.join(", ")}`);
  }
}

const money = (r: FieldReader, field: string, required = true) => r.decimal(field, { required, scale: 2 });

function parseItems(rows: Row[], log: IssueLog): ItemDraft[] {
  const out: ItemDraft[] = [];
  for (const row of rows) {
    const r = new FieldReader(row, "item", log);
    const code = r.text("item_code", { required: true, max: 64 });
    const name = r.text("name", { required: true });
    const group = r.text("group", { required: true, max: 120 });
    const uom = r.text("uom", { required: true, max: 20 });
    const hsnCode = r.text("hsn_code", { max: 12 });
    const gstRate = r.decimal("gst_rate", { scale: 2 });
    const openingQty = r.decimal("opening_qty", { required: true, scale: 3 });
    const openingValue = money(r, "opening_value", false);
    let attributes: Record<string, unknown> = {};
    const rawAttributes = row.get("attributes_json");
    if (rawAttributes !== "") {
      try {
        const parsed: unknown = JSON.parse(rawAttributes);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
        attributes = parsed as Record<string, unknown>;
      } catch {
        log.error("INVALID_VALUE", "item", "attributes_json must be a JSON object", { rowRef: row.rowRef, field: "attributes_json" });
        continue;
      }
    }
    if (code === null || name === null || group === null || uom === null || openingQty === null) continue;
    if (gstRate !== null && gstRate.gt(100)) {
      log.error("INVALID_VALUE", "item", "gst_rate must be between 0 and 100", { rowRef: row.rowRef, field: "gst_rate" });
      continue;
    }
    out.push({ rowRef: row.rowRef, code, name, group, uom, hsnCode, gstRate, openingQty, openingValue, attributes });
  }
  return out;
}

function parseBatches(rows: Row[], log: IssueLog): BatchDraft[] {
  const out: BatchDraft[] = [];
  for (const row of rows) {
    const r = new FieldReader(row, "batch", log);
    const itemCode = r.text("item_code", { required: true, max: 64 });
    const batchNo = r.text("batch_no", { required: true, max: 64 });
    const expiryDate = r.date("expiry_date");
    const mfgDate = r.date("mfg_date");
    const mrp = r.decimal("mrp", { scale: 2 });
    const openingQty = r.decimal("opening_qty", { required: true, scale: 3 });
    const openingValue = money(r, "opening_value", false);
    if (itemCode === null || batchNo === null || openingQty === null) continue;
    out.push({ rowRef: row.rowRef, itemCode, batchNo, expiryDate, mfgDate, mrp, openingQty, openingValue });
  }
  return out;
}

function parseParties(rows: Row[], log: IssueLog): PartyDraft[] {
  const out: PartyDraft[] = [];
  for (const row of rows) {
    const r = new FieldReader(row, "party", log);
    const code = r.text("party_code", { required: true, max: 64 });
    const name = r.text("name", { required: true });
    const kind = r.oneOf("party_type", ["customer", "supplier", "both"] as const, { required: true });
    const identity = r.oneOf("buyer_identity", ["named", "anonymous"] as const, { fallback: "named" });
    const creditDays = r.integer("credit_days");
    if (code === null || name === null || kind === null || identity === null) continue;
    out.push({
      rowRef: row.rowRef,
      code,
      name,
      kind,
      segment: r.text("segment", { max: 64 }),
      city: r.text("city", { max: 120 }),
      stateCode: r.text("state_code", { max: 4 }),
      gstin: r.text("gstin", { max: 15 }),
      creditDays,
      phone: r.text("phone", { max: 32 }),
      email: r.text("email", { max: 254 }),
      anonymousBuyers: identity === "anonymous"
    });
  }
  return out;
}

const VOUCHER_TYPES = ["sales_invoice", "sales_return", "purchase_invoice", "purchase_return"] as const;

function parseVouchers(rows: Row[], log: IssueLog): VoucherDraft[] {
  const byKey = new Map<string, VoucherDraft>();
  for (const row of rows) {
    const r = new FieldReader(row, "voucher", log);
    const type = r.oneOf("voucher_type", VOUCHER_TYPES, { required: true });
    const number = r.text("voucher_no", { required: true, max: 64 });
    const date = r.date("date", { required: true });
    const partyCode = r.text("party_code", { required: true, max: 64 });
    const dueDate = r.date("due_date");
    const lineNo = r.integer("line_no", { required: true, min: 1 });
    const itemCode = r.text("item_code", { required: true, max: 64 });
    const qty = r.decimal("qty", { required: true, scale: 3, positive: true });
    const rate = r.decimal("rate", { required: true, scale: 4 });
    const discount = money(r, "discount_amount", false) ?? new D(0);
    const taxRate = r.decimal("gst_rate", { required: true, scale: 2 });
    // Either taxable + tax, or a tax-inclusive line total to back GST out of.
    const inclusiveTotal = row.get("taxable_amount") === "" && row.get("tax_amount") === "" ? money(r, "amount_incl_tax", false) : null;
    let taxable: Decimal | null = null;
    let tax: Decimal | null = null;
    if (inclusiveTotal !== null && taxRate !== null) {
      taxable = inclusiveTotal.mul(100).div(taxRate.add(100)).toDecimalPlaces(2, D.ROUND_HALF_UP);
      tax = inclusiveTotal.sub(taxable);
    } else if (inclusiveTotal === null) {
      taxable = money(r, "taxable_amount");
      tax = money(r, "tax_amount");
    }
    const adjustment = r.decimal("adjustment_incl_tax", { scale: 2, allowNegative: true }) ?? new D(0);
    const batchNo = r.text("batch_no", { max: 64 });
    const expiryDate = r.date("expiry_date");
    const mrp = r.decimal("mrp", { scale: 2 });
    if (type === null || number === null || date === null || partyCode === null || lineNo === null || itemCode === null) continue;
    if (qty === null || rate === null || taxable === null || taxRate === null || tax === null) continue;

    const header = {
      partyCode,
      date,
      channel: r.text("channel", { max: 40 }),
      orderRef: r.text("order_ref", { max: 64 }),
      dueDate,
      originalNumber: r.text("original_voucher_no", { max: 64 })
    };
    const key = `${type}|${number}`;
    let voucher = byKey.get(key);
    if (!voucher) {
      voucher = { key, seq: byKey.size, type, number, ...header, ...(adjustment.isZero() ? {} : { adjustment }), lines: [] };
      byKey.set(key, voucher);
    } else {
      const changed: string[] = (Object.keys(header) as (keyof typeof header)[]).filter((field) => voucher![field] !== header[field]);
      if (!(voucher.adjustment ?? new D(0)).eq(adjustment)) changed.push("adjustment_incl_tax");
      if (changed.length > 0) {
        log.error("VOUCHER_HEADER_MISMATCH", "voucher", `${number}: ${changed.join(", ")} differ between lines of the same voucher`, { rowRef: row.rowRef });
        continue;
      }
    }
    if (voucher.lines.some((line) => line.lineNo === lineNo)) {
      log.error("DUPLICATE_LINE", "voucher", `${number} has line_no ${lineNo} more than once`, { rowRef: row.rowRef, field: "line_no" });
      continue;
    }
    voucher.lines.push({
      rowRef: row.rowRef,
      lineNo,
      itemCode,
      qty,
      // With a tax-inclusive total, rate is the printed (inclusive) price; the ex-tax rate is derived.
      rate: inclusiveTotal === null ? rate : taxable.add(discount).div(qty).toDecimalPlaces(4, D.ROUND_HALF_UP),
      grossAmount: inclusiveTotal === null ? qty.mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP) : taxable.add(discount),
      discountAmount: discount,
      taxableAmount: taxable,
      taxRate,
      taxAmount: tax,
      ...(batchNo === null ? {} : { batchNo }),
      ...(expiryDate === null ? {} : { expiryDate }),
      ...(mrp === null ? {} : { mrp }),
      ...(inclusiveTotal === null ? {} : { inclusive: true as const })
    });
  }
  return [...byKey.values()];
}

function parseSettlements(rows: Row[], log: IssueLog): SettlementDraft[] {
  const byKey = new Map<string, SettlementDraft>();
  for (const row of rows) {
    const r = new FieldReader(row, "settlement", log);
    const type = r.oneOf("voucher_type", ["receipt", "payment"] as const, { required: true });
    const number = r.text("voucher_no", { required: true, max: 64 });
    const date = r.date("date", { required: true });
    const partyCode = r.text("party_code", { required: true, max: 64 });
    const againstNumber = r.text("against_voucher_no", { required: true, max: 64 });
    const amount = r.decimal("amount", { required: true, scale: 2, positive: true });
    if (type === null || number === null || date === null || partyCode === null || againstNumber === null || amount === null) continue;
    const key = `${type}|${number}`;
    let settlement = byKey.get(key);
    if (!settlement) {
      settlement = { key, type, number, date, partyCode, allocations: [] };
      byKey.set(key, settlement);
    } else if (settlement.date !== date || settlement.partyCode !== partyCode) {
      log.error("VOUCHER_HEADER_MISMATCH", "settlement", `${number}: date or party differ between rows of the same voucher`, { rowRef: row.rowRef });
      continue;
    }
    settlement.allocations.push({ rowRef: row.rowRef, againstNumber, amount });
  }
  return [...byKey.values()];
}

function parseCharges(rows: Row[], log: IssueLog): ChargeDraft[] {
  const out: ChargeDraft[] = [];
  const occurrences = new Map<string, number>();
  const withheld = new Set<string>(TAX_WITHHELD_CHARGE_TYPES);
  for (const row of rows) {
    const r = new FieldReader(row, "channel_charge", log);
    const channel = r.text("channel", { required: true, max: 40 });
    const settlementRef = r.text("settlement_ref", { required: true, max: 64 });
    const settlementDate = r.date("settlement_date", { required: true });
    const orderNumber = r.text("order_voucher_no", { max: 64 });
    const chargeType = r.text("charge_type", { required: true, max: 64 });
    const amount = r.decimal("amount", { required: true, scale: 2, allowNegative: true });
    const gstAmount = r.decimal("gst_amount", { scale: 2, allowNegative: true }) ?? new D(0);
    if (channel === null || settlementRef === null || settlementDate === null || chargeType === null || amount === null) continue;
    // A settlement can carry the same charge type twice for one order; number the repeats so keys stay stable.
    const base = `${settlementRef}|${orderNumber ?? ""}|${chargeType}`;
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    out.push({
      rowRef: row.rowRef,
      key: `${base}|${n}`,
      channel,
      settlementRef,
      settlementDate,
      orderNumber,
      chargeType,
      amount,
      gstAmount,
      isTaxWithheld: withheld.has(chargeType)
    });
  }
  return out;
}

function parseCustomerOrders(rows: Row[], log: IssueLog): CustomerOrderDraft[] {
  const out = new Map<string, CustomerOrderDraft>();
  for (const row of rows) {
    const r = new FieldReader(row, "customer_order", log);
    const channel = r.text("channel", { required: true, max: 40 });
    const poNumber = r.text("po_number", { required: true, max: 64 });
    const poDate = r.date("po_date", { required: true });
    const partyCode = r.text("party_code", { required: true, max: 64 });
    const itemCode = r.text("item_code", { required: true, max: 64 });
    const qtyOrdered = r.decimal("qty_ordered", { required: true, scale: 3, positive: true });
    const qtySupplied = r.decimal("qty_supplied", { required: true, scale: 3 });
    const unitPrice = r.decimal("unit_price", { scale: 4 });
    const grnDate = r.date("grn_date");
    if (channel === null || poNumber === null || poDate === null || partyCode === null || itemCode === null || qtyOrdered === null || qtySupplied === null) continue;
    const key = `${channel}|${poNumber}|${itemCode}`;
    if (out.has(key)) {
      log.error("DUPLICATE_KEY", "customer_order", `PO ${poNumber} lists ${itemCode} more than once`, { rowRef: row.rowRef });
      continue;
    }
    out.set(key, { rowRef: row.rowRef, key, channel, poNumber, poDate, partyCode, itemCode, qtyOrdered, qtySupplied, unitPrice, grnDate });
  }
  return [...out.values()];
}

function parseStockSnapshots(rows: Row[], log: IssueLog): StockSnapshotDraft[] {
  const out: StockSnapshotDraft[] = [];
  for (const row of rows) {
    const r = new FieldReader(row, "stock_snapshot", log);
    const itemCode = r.text("item_code", { required: true, max: 64 });
    const asOf = r.date("as_of", { required: true });
    const qty = r.decimal("qty", { required: true, scale: 3, allowNegative: true });
    const value = r.decimal("value", { scale: 2, allowNegative: true });
    if (itemCode === null || asOf === null || qty === null) continue;
    out.push({ rowRef: row.rowRef, itemCode, asOf, qty, value, valuationMethod: r.text("valuation_method", { max: 40 }) });
  }
  return out;
}

function parseOutstanding(rows: Row[], log: IssueLog): OutstandingDraft[] {
  const out: OutstandingDraft[] = [];
  for (const row of rows) {
    const r = new FieldReader(row, "outstanding", log);
    const partyCode = r.text("party_code", { required: true, max: 64 });
    const side = r.oneOf("side", ["receivable", "payable"] as const, { required: true });
    const billRef = r.text("bill_ref", { required: true, max: 64 });
    const billDate = r.date("bill_date", { required: true });
    const dueDate = r.date("due_date");
    const amountInclTax = money(r, "amount_incl_tax");
    const pendingInclTax = r.decimal("pending_incl_tax", { required: true, scale: 2, allowNegative: true });
    const asOf = r.date("as_of", { required: true });
    if (partyCode === null || side === null || billRef === null || billDate === null || amountInclTax === null || pendingInclTax === null || asOf === null) continue;
    if (pendingInclTax.gt(amountInclTax)) {
      log.error("PENDING_EXCEEDS_BILL", "outstanding", `${billRef}: pending amount exceeds the bill amount`, { rowRef: row.rowRef, field: "pending_incl_tax" });
      continue;
    }
    out.push({ rowRef: row.rowRef, partyCode, side, billRef, billDate, dueDate, amountInclTax, pendingInclTax, asOf });
  }
  return out;
}

function parseControlTotals(rows: Row[], log: IssueLog): ControlTotalDraft[] {
  const out: ControlTotalDraft[] = [];
  for (const row of rows) {
    const r = new FieldReader(row, "control_total", log);
    const metric = r.oneOf("metric", CONTROL_TOTAL_METRICS, { required: true });
    const from = r.date("period_from", { required: true });
    const to = r.date("period_to", { required: true });
    const value = r.decimal("value", { required: true, scale: 2, allowNegative: true });
    if (metric === null || from === null || to === null || value === null) continue;
    out.push({ rowRef: row.rowRef, metric, from, to, value });
  }
  return out;
}

/** Stable content hash of a draft, ignoring where in the file it came from (row refs, posting position). */
export function contentHash(draft: unknown): string {
  return sha256(
    JSON.stringify(draft, (key, value) => {
      if (key === "rowRef" || key === "seq") return undefined;
      if (value instanceof D) return value.toFixed();
      return value;
    })
  );
}
