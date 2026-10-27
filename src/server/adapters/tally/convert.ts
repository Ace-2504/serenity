import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { toCsv } from "@/server/demo/csv";
import { collectTallyObjects, list, nameOf, text, type TallyNode } from "@/server/adapters/tally/collect";
import { stateCode, tallyAmount, tallyCreditDays, tallyDate, tallyQty, tallyRate, yes } from "@/server/adapters/tally/values";
import type { Issue } from "@/server/ingest/issues";
import type { UploadedFile } from "@/server/ingest/parse";
import {
  CONTROL_TOTAL_COLUMNS,
  ITEM_COLUMNS,
  PARTY_COLUMNS,
  SETTLEMENT_COLUMNS,
  STOCK_SUMMARY_COLUMNS,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS,
  type ItemRow,
  type PartyRow,
  type SettlementRow,
  type StockSummaryRow,
  type VoucherRow
} from "@/server/ingest/template";

/**
 * Tally XML -> import template. Converts a TallyPrime "Data Interchange" XML export (masters
 * and/or Day Book vouchers) into the same CSV files a template upload uses, so it goes through
 * the same validation, staging, reconciliation and idempotent commit.
 *
 * Status: built and tested against hand-written fixtures modelled on Tally's export format and
 * on open-source Tally connectors. NOT yet verified against a real TallyPrime export. See
 * docs/platform/07-integration-research.md.
 *
 * Mapping
 *  - Voucher types resolve through VOUCHERTYPE masters to their base type: Sales -> sales_invoice,
 *    Credit Note -> sales_return, Purchase -> purchase_invoice, Debit Note -> purchase_return,
 *    Receipt -> receipt, Payment -> payment. Everything else is skipped and reported.
 *  - Sign convention: Tally writes debits negative. s = +1 for Sales/Debit Note, -1 for
 *    Purchase/Credit Note; item taxable = s x inventory amount, GST = s x GST ledgers, bill
 *    adjustment = s x other ledgers (round-off, freight), bill total = -s x party ledger.
 *    A voucher whose parts do not add up to its party amount is rejected, never forced.
 *  - Line GST rates come from the item master's GST details applicable on the voucher date;
 *    line GST is allocated so that the voucher's GST equals its GST ledgers exactly.
 *  - Bills: an invoice's "New Ref" name is its bill reference; receipts/payments and credit
 *    notes that name it with "Agst Ref" are linked to that invoice.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const ZERO = new D(0);
const money = (d: Decimal) => d.toFixed(2);

const BASE_TYPES = ["Sales", "Purchase", "Credit Note", "Debit Note", "Receipt", "Payment", "Journal", "Contra", "Stock Journal", "Delivery Note", "Receipt Note", "Rejections In", "Rejections Out", "Physical Stock", "Sales Order", "Purchase Order", "Memorandum", "Reversing Journal", "Material In", "Material Out"] as const;
const INVOICE_KIND: Record<string, "sales_invoice" | "sales_return" | "purchase_invoice" | "purchase_return"> = {
  Sales: "sales_invoice",
  "Credit Note": "sales_return",
  Purchase: "purchase_invoice",
  "Debit Note": "purchase_return"
};
const STOCK_AFFECTING = new Set(["Stock Journal", "Delivery Note", "Receipt Note", "Rejections In", "Rejections Out", "Physical Stock", "Material In", "Material Out"]);
const GST_SLABS = [0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28, 40];

export type TallyConversion = {
  files: UploadedFile[];
  issues: Issue[];
  summary: {
    company: string | null;
    sourceFiles: { name: string; encoding: string; removedControlRefs: number }[];
    period: { from: string; to: string } | null;
    masters: { ledgers: number; stockItems: number; groups: number; voucherTypes: number };
    vouchersRead: number;
    imported: Record<string, number>;
    skipped: Record<string, { count: number; examples: string[] }>;
    unallocated: { receipts: string; payments: string };
  };
};

type Ledger = { name: string; parent: string; gstin: string; state: string; creditDays: number | null; phone: string; email: string; taxType: string; dutyHead: string };
type GstSlab = { from: string; rate: Decimal };
type StockItem = { name: string; parent: string; unit: string; hsn: string; gst: GstSlab[]; openingQty: Decimal | null; openingValue: Decimal | null; closingQty: Decimal | null; closingValue: Decimal | null; costing: string };

export function tallyToTemplate(xmlFiles: UploadedFile[]): TallyConversion {
  const objects = collectTallyObjects(xmlFiles);
  const issues: Issue[] = [];
  const warn = (code: string, entity: string, message: string) => issues.push({ severity: "warning", code, entity, message });
  const fail = (code: string, entity: string, message: string) => issues.push({ severity: "error", code, entity, message });
  const skipped: TallyConversion["summary"]["skipped"] = {};
  const skip = (reason: string, example: string) => {
    skipped[reason] ??= { count: 0, examples: [] };
    skipped[reason].count += 1;
    if (skipped[reason].examples.length < 5) skipped[reason].examples.push(example);
  };

  // ── Masters ──────────────────────────────────────────────────────────────
  const groupParent = new Map(objects.GROUP.map((g) => [nameOf(g), text(g, "PARENT")]));
  const under = (group: string, target: string): boolean => {
    for (let g = group, depth = 0; g && depth < 30; g = groupParent.get(g) ?? "", depth += 1) if (g === target) return true;
    return false;
  };
  const ledgers = new Map<string, Ledger>(
    objects.LEDGER.map((l) => {
      const name = nameOf(l);
      const gstReg = list(l, "LEDGSTREGDETAILS.LIST")[0];
      return [
        name,
        {
          name,
          parent: text(l, "PARENT"),
          gstin: text(l, "PARTYGSTIN") || text(gstReg, "GSTIN"),
          state: text(l, "LEDSTATENAME") || text(l, "STATENAME") || text(gstReg, "STATE"),
          creditDays: tallyCreditDays(text(l, "BILLCREDITPERIOD")),
          phone: text(l, "LEDGERMOBILE") || text(l, "LEDGERPHONE"),
          email: text(l, "EMAIL"),
          taxType: text(l, "TAXTYPE"),
          dutyHead: text(l, "GSTDUTYHEAD")
        }
      ];
    })
  );
  type LedgerKind = "debtor" | "creditor" | "cash" | "bank" | "gst" | "cess" | "sales" | "purchase" | "other";
  const kindOf = (name: string): LedgerKind => {
    const l = ledgers.get(name);
    const p = l?.parent ?? "";
    if (/\bcess\b/i.test(name) || /cess/i.test(l?.dutyHead ?? "")) return "cess";
    if (l && under(p, "Duties & Taxes") && (l.taxType.toUpperCase() === "GST" || /central|state|integrated|union/i.test(l.dutyHead) || /\b(c|s|i|ut)gst\b/i.test(name))) return "gst";
    if (!l && /\b(c|s|i|ut)gst\b/i.test(name)) return "gst";
    if (under(p, "Sundry Debtors")) return "debtor";
    if (under(p, "Sundry Creditors")) return "creditor";
    if (under(p, "Cash-in-Hand") || (!l && /^cash$/i.test(name))) return "cash";
    if (under(p, "Bank Accounts") || under(p, "Bank OD A/c")) return "bank";
    if (under(p, "Sales Accounts")) return "sales";
    if (under(p, "Purchase Accounts")) return "purchase";
    return "other";
  };

  const typeParent = new Map(objects.VOUCHERTYPE.map((t) => [nameOf(t), text(t, "PARENT")]));
  const baseType = (name: string): string | null => {
    for (let t = name, depth = 0; t && depth < 20; t = typeParent.get(t) ?? "", depth += 1) {
      if ((BASE_TYPES as readonly string[]).includes(t)) return t;
    }
    return null;
  };

  const stockItems = new Map<string, StockItem>(
    objects.STOCKITEM.map((s) => {
      const name = nameOf(s);
      const gstDetails = list(s, "GSTDETAILS.LIST");
      const slabs: GstSlab[] = gstDetails
        .map((g) => {
          const rate = list(g, "STATEWISEDETAILS.LIST")
            .flatMap((sw) => list(sw, "RATEDETAILS.LIST"))
            .find((r) => /integrated|igst/i.test(text(r, "GSTRATEDUTYHEAD")));
          const value = rate ? tallyRate(text(rate, "GSTRATE")) : null;
          return value === null ? null : { from: tallyDate(text(g, "APPLICABLEFROM")) ?? "1900-01-01", rate: value };
        })
        .filter((g): g is GstSlab => g !== null)
        .sort((a, b) => a.from.localeCompare(b.from));
      const hsn = [...gstDetails, ...list(s, "HSNDETAILS.LIST")].map((g) => text(g, "HSNCODE")).filter(Boolean).pop() ?? "";
      const abs = (v: Decimal | null) => (v === null ? null : v.abs());
      return [
        name,
        {
          name,
          parent: text(s, "PARENT"),
          unit: text(s, "BASEUNITS"),
          hsn,
          gst: slabs,
          openingQty: tallyQty(text(s, "OPENINGBALANCE"))?.qty ?? null,
          openingValue: abs(text(s, "OPENINGVALUE") ? tallyAmount(text(s, "OPENINGVALUE")) : null),
          closingQty: tallyQty(text(s, "CLOSINGBALANCE"))?.qty ?? null,
          closingValue: abs(text(s, "CLOSINGVALUE") ? tallyAmount(text(s, "CLOSINGVALUE")) : null),
          costing: text(s, "COSTINGMETHOD")
        }
      ];
    })
  );
  const gstRateOn = (item: string, date: string): Decimal | null => {
    const slabs = stockItems.get(item)?.gst ?? [];
    return [...slabs].reverse().find((s) => s.from <= date)?.rate ?? null;
  };

  // Template codes are at most 64 characters; longer Tally names get a stable shortened code.
  const codeFor = (name: string) => (name.length <= 64 ? name : `${name.slice(0, 55)}~${createHash("sha256").update(name).digest("hex").slice(0, 8)}`);

  // ── Vouchers ─────────────────────────────────────────────────────────────
  type Bill = { kind: (typeof INVOICE_KIND)[string]; number: string; party: string };
  const billByRef = new Map<string, Bill>(); // "receivable|ref" / "payable|ref"
  const voucherRows: VoucherRow[] = [];
  const settlementRows: SettlementRow[] = [];
  const usedParties = new Map<string, Set<"customer" | "supplier">>();
  const referencedItems = new Map<string, { firstRate: Decimal | null }>();
  const imported: Record<string, number> = {};
  const usedNumbers = new Set<string>();
  const dates: string[] = [];
  let unallocatedReceipts = ZERO;
  let unallocatedPayments = ZERO;

  type Pending = { node: TallyNode; base: string; date: string; label: string };
  const pending: Pending[] = [];
  objects.VOUCHER.forEach((v, i) => {
    const typeName = text(v, "VOUCHERTYPENAME") || (typeof v["@VCHTYPE"] === "string" ? (v["@VCHTYPE"] as string) : "");
    const label = `${typeName || "voucher"} ${text(v, "VOUCHERNUMBER") || `#${i + 1}`}`;
    if (yes(text(v, "ISCANCELLED")) || yes(text(v, "ISDELETED"))) return skip("Cancelled", label);
    if (yes(text(v, "ISOPTIONAL"))) return skip("Optional (memorandum) voucher", label);
    if (v["@ACTION"] === "Delete") return skip("Deleted", label);
    const date = tallyDate(text(v, "DATE"));
    if (!date) return fail("TALLY_BAD_DATE", "voucher", `${label}: date "${text(v, "DATE")}" is not YYYYMMDD`);
    const base = baseType(typeName);
    if (!base) return skip(`Unknown voucher type "${typeName}" (include voucher type masters in the export)`, label);
    if (!(base in INVOICE_KIND) && base !== "Receipt" && base !== "Payment") {
      return skip(STOCK_AFFECTING.has(base) ? `${base}: changes stock but is not imported yet` : `${base}: no sales, purchase or bill effect`, label);
    }
    pending.push({ node: v, base, date, label });
  });

  const numberFor = (kindKey: string, raw: string, date: string, label: string) => {
    let number = raw || `${label.replace(/\s+/g, "-")}-${date}`;
    if (!raw) warn("TALLY_NO_NUMBER", "voucher", `${label} on ${date} has no voucher number; using "${number}"`);
    if (usedNumbers.has(`${kindKey}|${number}`)) {
      const unique = `${number}/${date}`;
      warn("TALLY_DUPLICATE_NUMBER", "voucher", `${label}: number ${number} is used more than once; imported as ${unique}`);
      number = unique;
    }
    usedNumbers.add(`${kindKey}|${number}`);
    return number;
  };
  const recordPartyRole = (name: string, role: "customer" | "supplier") => {
    if (!usedParties.has(name)) usedParties.set(name, new Set());
    usedParties.get(name)!.add(role);
  };

  // Invoices first (all of them), so returns and settlements can resolve bill references.
  const invoices = pending.filter((p) => p.base === "Sales" || p.base === "Purchase");
  const notes = pending.filter((p) => p.base === "Credit Note" || p.base === "Debit Note");
  const settlements = pending.filter((p) => p.base === "Receipt" || p.base === "Payment");

  const buildInvoice = ({ node: v, base, date, label }: Pending) => {
    const kind = INVOICE_KIND[base];
    const s = kind === "sales_invoice" || kind === "purchase_return" ? 1 : -1;
    const entries = list(v, "LEDGERENTRIES.LIST", "ALLLEDGERENTRIES.LIST");
    const partyName = text(v, "PARTYLEDGERNAME") || entries.map((e) => text(e, "LEDGERNAME")).find((n) => ["debtor", "creditor", "cash", "bank"].includes(kindOf(n))) || "";
    if (!partyName) return fail("TALLY_NO_PARTY", "voucher", `${label}: no party ledger`);
    const partyKind = kindOf(partyName);

    // Item lines: invoice view keeps them at voucher level; accounting view nests them under the sales/purchase ledger.
    const itemEntries = [...list(v, "ALLINVENTORYENTRIES.LIST", "INVENTORYENTRIES.LIST"), ...entries.flatMap((e) => list(e, "INVENTORYALLOCATIONS.LIST"))];
    if (itemEntries.length === 0) return skip(`${base} without stock items (accounting-only invoice)`, label);

    let partyAmount = ZERO;
    let tax = ZERO;
    let adjustment = ZERO;
    let cess = ZERO;
    let nonItemSales = ZERO;
    let billRef = "";
    let creditDays: number | null = null;
    const againstRefs: string[] = [];
    for (const e of entries) {
      const ledger = text(e, "LEDGERNAME");
      const amount = tallyAmount(text(e, "AMOUNT"));
      if (amount === null) return fail("TALLY_BAD_AMOUNT", "voucher", `${label}: amount "${text(e, "AMOUNT")}" of ${ledger} is not a number`);
      if (ledger === partyName) {
        partyAmount = partyAmount.add(amount);
        for (const b of list(e, "BILLALLOCATIONS.LIST")) {
          const type = text(b, "BILLTYPE");
          if (type === "New Ref" && !billRef) {
            billRef = text(b, "NAME");
            creditDays = tallyCreditDays(text(b, "BILLCREDITPERIOD"));
          } else if (type === "Agst Ref") againstRefs.push(text(b, "NAME"));
        }
        continue;
      }
      if (list(e, "INVENTORYALLOCATIONS.LIST").length > 0) continue; // the item lines carry this amount
      const k = kindOf(ledger);
      if (k === "gst") tax = tax.add(amount.mul(s));
      else if (k === "cess") cess = cess.add(amount.mul(s));
      else {
        if (k === "sales" || k === "purchase") nonItemSales = nonItemSales.add(amount.mul(s));
        adjustment = adjustment.add(amount.mul(s));
      }
    }
    adjustment = adjustment.add(cess);
    const billTotal = partyAmount.mul(-s);

    const lines: { item: string; qty: Decimal; rate: Decimal; gross: Decimal; discount: Decimal; taxable: Decimal; gstRate: Decimal | null }[] = [];
    for (const e of itemEntries) {
      const item = text(e, "STOCKITEMNAME");
      const amount = tallyAmount(text(e, "AMOUNT"));
      const actual = tallyQty(text(e, "ACTUALQTY"));
      const billed = tallyQty(text(e, "BILLEDQTY")) ?? actual;
      if (!item || amount === null || !billed) return fail("TALLY_BAD_LINE", "voucher", `${label}: an item line has no item, amount or quantity`);
      const taxable = amount.mul(s);
      const qty = (actual ?? billed).qty.abs().toDecimalPlaces(3);
      if (taxable.lt(0) || qty.isZero()) return fail("TALLY_UNSUPPORTED_LINE", "voucher", `${label}: ${item} has a negative amount or zero quantity; mixed-direction invoices are not supported`);
      const billedQty = billed.qty.abs();
      const statedRate = tallyRate(text(e, "RATE")) ?? (billedQty.isZero() ? ZERO : taxable.div(billedQty));
      if (!billedQty.eq(qty)) warn("TALLY_FREE_QUANTITY", "voucher", `${label}: ${item} billed ${billedQty} but moved ${qty}; the rate is spread over the quantity moved`);
      let rate = billedQty.eq(qty) ? statedRate.toDecimalPlaces(4) : statedRate.mul(billedQty).div(qty).toDecimalPlaces(4);
      let gross = qty.mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP);
      if (gross.lt(taxable)) {
        // No discount, and the stated rate rounds below the amount: derive the rate from the amount.
        rate = taxable.div(qty).toDecimalPlaces(4);
        gross = qty.mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP);
      }
      let discount = gross.sub(taxable);
      if (discount.lt(0)) {
        if (discount.lt(new D(-0.01))) return fail("TALLY_LINE_ARITHMETIC", "voucher", `${label}: ${item} amount ${money(taxable)} cannot be expressed as quantity x rate`);
        discount = ZERO;
      }
      lines.push({ item, qty, rate, gross, discount, taxable, gstRate: gstRateOn(item, date) });
      if (!referencedItems.has(item)) referencedItems.set(item, { firstRate: gstRateOn(item, date) });
    }

    const itemsTotal = lines.reduce((a, l) => a.add(l.taxable), ZERO);
    if (!itemsTotal.add(tax).add(adjustment).eq(billTotal)) {
      return fail(
        "TALLY_UNBALANCED",
        "voucher",
        `${label}: items ${money(itemsTotal)} + GST ${money(tax)} + other ${money(adjustment)} != party amount ${money(billTotal)}; not imported`
      );
    }
    if (!cess.isZero()) warn("TALLY_CESS", "voucher", `${label}: cess ${money(cess)} is kept in the bill total but not as GST`);
    if (!nonItemSales.isZero()) warn("TALLY_NON_ITEM_SALES", "voucher", `${label}: ${money(nonItemSales)} posted to sales/purchase ledgers without items is kept in the bill total, not in product sales`);

    // GST rate per line: item master, else the voucher's effective rate when it is a standard slab.
    if (lines.some((l) => l.gstRate === null)) {
      const effective = itemsTotal.isZero() ? null : tax.div(itemsTotal).mul(100);
      const slab = effective === null ? undefined : GST_SLABS.find((g) => effective.sub(g).abs().lt(0.05));
      if (slab === undefined) return fail("TALLY_NO_GST_RATE", "voucher", `${label}: an item has no GST rate in its master and the voucher's rate (${effective?.toFixed(2) ?? "—"}%) is not a standard slab`);
      for (const l of lines) if (l.gstRate === null) l.gstRate = new D(slab);
      warn("TALLY_GST_RATE_INFERRED", "voucher", `${label}: GST rate ${slab}% taken from the voucher; add GST details to the item master`);
    }
    // Allocate the voucher's GST to lines: computed per line, rounding residue on the largest line.
    const lineTax = lines.map((l) => l.taxable.mul(l.gstRate!).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP));
    let residue = tax.sub(lineTax.reduce((a, t) => a.add(t), ZERO));
    if (!residue.isZero()) {
      if (residue.abs().lte(1)) {
        const largest = lines.reduce((best, l, i) => (l.taxable.gt(lines[best].taxable) ? i : best), 0);
        lineTax[largest] = lineTax[largest].add(residue);
      } else {
        warn("TALLY_GST_MISMATCH", "voucher", `${label}: GST ledgers differ from item rates by ${money(residue)}; the difference is kept in the bill total`);
        adjustment = adjustment.add(residue);
      }
      residue = ZERO;
    }

    const partyRole = kind.startsWith("sales") ? "customer" : "supplier";
    if (partyKind === "creditor" && partyRole === "customer") warn("TALLY_PARTY_SIDE", "voucher", `${label}: party ${partyName} is a creditor but the voucher is a sale`);
    recordPartyRole(partyName, partyRole);
    const number = numberFor(kind, text(v, "VOUCHERNUMBER"), date, label);
    const side = kind === "sales_invoice" || kind === "sales_return" ? "receivable" : "payable";
    if (kind === "sales_invoice" || kind === "purchase_invoice") {
      const ref = billRef || number;
      if (billByRef.has(`${side}|${ref}`)) warn("TALLY_DUPLICATE_BILL_REF", "voucher", `${label}: bill reference ${ref} is used by more than one invoice`);
      else billByRef.set(`${side}|${ref}`, { kind, number, party: partyName });
    }
    const days = creditDays ?? ledgers.get(partyName)?.creditDays ?? null;
    const dueDate = days === null || kind.endsWith("return") ? "" : new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    let original = "";
    if (kind.endsWith("return")) {
      const ref = againstRefs[0];
      const originalKind = kind === "sales_return" ? "sales_invoice" : "purchase_invoice";
      const bill = ref ? billByRef.get(`${side}|${ref}`) : undefined;
      if (bill && bill.kind === originalKind) original = bill.number;
      else if (ref) warn("TALLY_RETURN_BILL_UNKNOWN", "voucher", `${label}: against bill ${ref}, which is not in this export`);
      else warn("TALLY_RETURN_NOT_AGAINST_BILL", "voucher", `${label}: not adjusted against an invoice (New Ref or On Account); receivables/payables will not net it`);
    }

    lines.forEach((l, i) =>
      voucherRows.push({
        voucher_type: kind,
        voucher_no: number,
        date,
        party_code: codeFor(partyName),
        channel: partyKind === "cash" ? "counter" : "",
        order_ref: "",
        due_date: dueDate,
        original_voucher_no: original,
        line_no: String(i + 1),
        item_code: codeFor(l.item),
        qty: l.qty.toFixed(),
        rate: l.rate.toFixed(),
        discount_amount: money(l.discount),
        taxable_amount: money(l.taxable),
        gst_rate: l.gstRate!.toFixed(2),
        tax_amount: money(lineTax[i]),
        adjustment_incl_tax: adjustment.isZero() ? "" : money(adjustment)
      })
    );
    imported[kind] = (imported[kind] ?? 0) + 1;
    dates.push(date);
  };

  const buildSettlement = ({ node: v, base, date, label }: Pending) => {
    const type = base === "Receipt" ? "receipt" : "payment";
    const partyKind = type === "receipt" ? "debtor" : "creditor";
    const side = type === "receipt" ? "receivable" : "payable";
    const entries = list(v, "LEDGERENTRIES.LIST", "ALLLEDGERENTRIES.LIST").filter((e) => {
      const k = kindOf(text(e, "LEDGERNAME"));
      return k === "debtor" || k === "creditor";
    });
    if (entries.length === 0) return skip(`${base} not involving a customer or supplier`, label);
    const baseNumber = numberFor(type, text(v, "VOUCHERNUMBER"), date, label);
    let made = 0;
    entries.forEach((e) => {
      const ledger = text(e, "LEDGERNAME");
      if (kindOf(ledger) !== partyKind) {
        warn("TALLY_SETTLEMENT_SIDE", "settlement", `${label}: ${type} from ${ledger}, a ${kindOf(ledger)}, is not imported (refunds and contra settlements are not supported yet)`);
        return;
      }
      const amount = tallyAmount(text(e, "AMOUNT")) ?? ZERO;
      const bills = list(e, "BILLALLOCATIONS.LIST");
      let allocated = ZERO;
      const number = made === 0 ? baseNumber : `${baseNumber}#${made + 1}`;
      for (const b of bills) {
        const value = (tallyAmount(text(b, "AMOUNT")) ?? ZERO).abs();
        if (text(b, "BILLTYPE") !== "Agst Ref") continue;
        const ref = text(b, "NAME");
        const bill = billByRef.get(`${side}|${ref}`);
        settlementRows.push({ voucher_type: type, voucher_no: number, date, party_code: codeFor(ledger), against_voucher_no: bill?.number ?? ref, amount: money(value) });
        allocated = allocated.add(value);
      }
      const rest = amount.abs().sub(allocated);
      if (rest.gt(0.005)) {
        if (type === "receipt") unallocatedReceipts = unallocatedReceipts.add(rest);
        else unallocatedPayments = unallocatedPayments.add(rest);
      }
      if (allocated.gt(0)) {
        recordPartyRole(ledger, type === "receipt" ? "customer" : "supplier");
        made += 1;
      }
    });
    if (made > 0) {
      imported[type] = (imported[type] ?? 0) + 1;
      dates.push(date);
    } else skip(`${base} not against any bill (on account or advance)`, label);
  };

  invoices.forEach(buildInvoice);
  notes.forEach(buildInvoice);
  settlements.forEach(buildSettlement);
  if (unallocatedReceipts.gt(0)) warn("TALLY_UNALLOCATED", "settlement", `Receipts of ${money(unallocatedReceipts)} were on account or advances, not against bills, and are not imported`);
  if (unallocatedPayments.gt(0)) warn("TALLY_UNALLOCATED", "settlement", `Payments of ${money(unallocatedPayments)} were on account or advances, not against bills, and are not imported`);
  for (const [reason, s] of Object.entries(skipped)) {
    const stock = reason.includes("changes stock");
    issues.push({ severity: stock ? "warning" : "info", code: stock ? "TALLY_STOCK_VOUCHER_SKIPPED" : "TALLY_SKIPPED", entity: "voucher", message: `${s.count} skipped — ${reason} (e.g. ${s.examples.join(", ")})` });
  }

  // ── Template rows ────────────────────────────────────────────────────────
  const period = dates.length ? { from: dates.reduce((a, b) => (a < b ? a : b)), to: dates.reduce((a, b) => (a > b ? a : b)) } : null;
  const groupName = (parent: string) => (!parent || /^primary$/i.test(parent) ? "Ungrouped" : parent);

  const itemRows: ItemRow[] = [];
  const itemNames = new Set([...stockItems.keys(), ...referencedItems.keys()]);
  for (const name of itemNames) {
    const m = stockItems.get(name);
    if (!m) warn("TALLY_ITEM_MASTER_MISSING", "item", `${name} is used in vouchers but not in the masters export; it is created without group, HSN or opening stock`);
    const rate = m?.gst.at(-1)?.rate ?? referencedItems.get(name)?.firstRate ?? null;
    const openingQty = m?.openingQty ?? null;
    itemRows.push({
      item_code: codeFor(name),
      name: name.slice(0, 200),
      group: groupName(m?.parent ?? ""),
      uom: m?.unit ?? "",
      hsn_code: m?.hsn ?? "",
      gst_rate: rate === null ? "0.00" : rate.toFixed(2),
      opening_qty: openingQty === null ? "0" : openingQty.toFixed(),
      // Opening stock without a value is left blank (cost unknown), never zero.
      opening_value: !openingQty || openingQty.isZero() ? "0.00" : m?.openingValue ? money(m.openingValue) : "",
      // Attributes follow the domain pack's schema; Tally has no equivalent fields. The costing
      // method travels with the closing stock (stock_summary.valuation_method).
      attributes_json: "{}"
    });
  }

  const partyRows: PartyRow[] = [];
  const partyNames = new Set([...[...ledgers.values()].filter((l) => ["debtor", "creditor"].includes(kindOf(l.name))).map((l) => l.name), ...usedParties.keys()]);
  for (const name of partyNames) {
    const l = ledgers.get(name);
    const k = kindOf(name);
    const roles = usedParties.get(name) ?? new Set([k === "creditor" ? "supplier" : "customer"]);
    const anonymous = k === "cash" || k === "bank";
    partyRows.push({
      party_code: codeFor(name),
      name: anonymous ? `${name} (counter sales)` : name.slice(0, 200),
      party_type: roles.size > 1 ? "both" : [...roles][0],
      segment: anonymous ? "counter" : "",
      city: "",
      state_code: stateCode(l?.gstin, l?.state),
      gstin: l?.gstin && /^[0-9A-Z]{15}$/i.test(l.gstin) ? l.gstin.toUpperCase() : "",
      credit_days: l?.creditDays === null || l?.creditDays === undefined ? "" : String(l.creditDays),
      phone: l?.phone ?? "",
      email: l?.email ?? "",
      buyer_identity: anonymous ? "anonymous" : "named"
    });
  }

  const stockRows: StockSummaryRow[] = period
    ? [...stockItems.values()]
        .filter((s) => s.closingQty !== null)
        .map((s) => ({ item_code: codeFor(s.name), as_of: period.to, qty: s.closingQty!.toFixed(), value: s.closingValue === null ? "" : money(s.closingValue), valuation_method: s.costing }))
    : [];

  // Control totals from the ledger side of each voucher. Every imported voucher was checked to
  // balance (items + GST + other = party amount), so these confirm the conversion end to end;
  // completeness against Tally's own registers is a separate check shown to the owner.
  const sum = (rows: VoucherRow[], field: "taxable_amount" | "tax_amount") => rows.reduce((a, r) => a.add(r[field]), ZERO);
  const ofType = (t: string) => voucherRows.filter((r) => r.voucher_type === t);
  const settled = (t: string) => settlementRows.filter((r) => r.voucher_type === t).reduce((a, r) => a.add(r.amount), ZERO);
  const controls: Record<string, Decimal> = {
    sales_taxable: sum(ofType("sales_invoice"), "taxable_amount"),
    sales_tax: sum(ofType("sales_invoice"), "tax_amount"),
    sales_return_taxable: sum(ofType("sales_return"), "taxable_amount"),
    purchase_taxable: sum(ofType("purchase_invoice"), "taxable_amount"),
    purchase_return_taxable: sum(ofType("purchase_return"), "taxable_amount"),
    receipts: settled("receipt"),
    payments: settled("payment"),
    channel_charges: ZERO
  };

  const files: UploadedFile[] = [
    { name: TEMPLATE_FILES.items, content: Buffer.from(toCsv(ITEM_COLUMNS, itemRows)) },
    { name: TEMPLATE_FILES.parties, content: Buffer.from(toCsv(PARTY_COLUMNS, partyRows)) },
    { name: TEMPLATE_FILES.vouchers, content: Buffer.from(toCsv(VOUCHER_COLUMNS, voucherRows)) },
    { name: TEMPLATE_FILES.settlements, content: Buffer.from(toCsv(SETTLEMENT_COLUMNS, settlementRows)) },
    ...(stockRows.length ? [{ name: TEMPLATE_FILES.stockSummary, content: Buffer.from(toCsv(STOCK_SUMMARY_COLUMNS, stockRows)) }] : []),
    ...(period
      ? [
          {
            name: TEMPLATE_FILES.controlTotals,
            content: Buffer.from(
              toCsv(
                CONTROL_TOTAL_COLUMNS,
                Object.entries(controls).map(([metric, value]) => ({ metric, period_from: period.from, period_to: period.to, value: money(value) }))
              )
            )
          }
        ]
      : [])
  ];
  if (!period) fail("TALLY_NO_VOUCHERS", "bundle", "The export contains no sales, purchase, return, receipt or payment vouchers to import");

  const company = objects.company ?? objects.COMPANY.map(nameOf).find(Boolean) ?? null;
  return {
    files,
    issues,
    summary: {
      company,
      sourceFiles: objects.files,
      period,
      masters: { ledgers: ledgers.size, stockItems: stockItems.size, groups: groupParent.size, voucherTypes: typeParent.size },
      vouchersRead: objects.VOUCHER.length,
      imported,
      skipped,
      unallocated: { receipts: money(unallocatedReceipts), payments: money(unallocatedPayments) }
    }
  };
}
