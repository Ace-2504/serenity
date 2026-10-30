import { Prisma } from "@prisma/client";
import { column, looseDate, looseMoney, money, normalise, type Table } from "@/server/adapters/marketplace/table";
import type { Issue } from "@/server/ingest/issues";
import type { ChannelChargeRow } from "@/server/ingest/template";

/**
 * Meesho supplier-panel payments export (one row per sub-order) -> channel charges.
 *
 * LOW CONFIDENCE: Meesho publishes no file specification. Column names below come from public
 * sample files and may differ in yours; unrecognised money columns are listed so they can be
 * mapped. Fee columns marked "incl. GST" are split assuming 18% GST on platform fees (stated
 * as an assumption on the import). The sign convention is detected from the file.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const MEESHO_ID = ["Sub Order No", "Sub Order Number", "Suborder ID"];
const COLUMNS = {
  order: MEESHO_ID,
  paymentDate: ["Payment Date", "Settlement Date"],
  transaction: ["Transaction ID", "UTR", "Payment Reference"],
  sale: ["Total Sale Amount (Incl. Shipping & GST)", "Total Sale Amount"],
  finalAmount: ["Final Settlement Amount", "Net Settlement Amount"]
};

/** Charge columns: [aliases, charge type, includes GST?, credit (paid to the seller)?] */
const CHARGES: [string[], string, boolean, boolean][] = [
  [["Meesho Commission (Incl. GST)", "Meesho Commission"], "referral_fee", true, false],
  [["Fixed Fee (Incl. GST)", "Fixed Fee"], "closing_fee", true, false],
  [["Shipping Charge (Incl. GST)", "Shipping Charge"], "shipping_fee", true, false],
  [["Return Shipping Charge (Incl. GST)", "Return Shipping Charge"], "return_shipping_fee", true, false],
  [["Warehousing fee (inc Gst)", "Warehousing fee"], "warehousing_fee", true, false],
  [["Return premium (incl GST)", "Return premium"], "return_fee", true, false],
  [["Meesho gold platform fee"], "platform_fee", true, false],
  [["Meesho mall platform fee"], "platform_fee", true, false],
  [["Net Other Support Service Charges (Excl. GST)"], "other_fee", false, false],
  [["GST on Net Other Support Service Charges"], "other_fee_gst", false, false],
  [["TCS"], "tcs_gst", false, false],
  [["TDS"], "tds_income_tax", false, false],
  [["Recovery"], "recovery", false, false],
  [["Compensation", "Claims"], "compensation_credit", false, true]
];
const FEE_GST_RATE = new D(18);

export const isMeeshoPayments = (t: Table) => column(t.header, MEESHO_ID) >= 0 && column(t.header, COLUMNS.paymentDate) >= 0;

export type MeeshoConversion = { rows: ChannelChargeRow[]; issues: Issue[]; signConvention: "negative_is_deduction" | "positive_is_deduction"; unmapped: string[] };

export function convertMeeshoPayments(tables: Table[]): MeeshoConversion {
  const issues: Issue[] = [];
  const rows: ChannelChargeRow[] = [];
  const unmapped = new Set<string>();
  const known = new Set([...Object.values(COLUMNS).flat(), ...CHARGES.flatMap((c) => c[0])].map(normalise));

  // Sign convention: deductions are usually shown negative. Decide from the data, not assumption.
  let negatives = 0;
  let positives = 0;
  for (const t of tables) {
    for (const [aliases, , , credit] of CHARGES) {
      const i = column(t.header, aliases);
      if (i < 0 || credit) continue;
      for (const r of t.rows) {
        const v = looseMoney(r[i]);
        if (v?.gt(0)) positives += 1;
        else if (v?.lt(0)) negatives += 1;
      }
    }
  }
  const convention = negatives >= positives ? "negative_is_deduction" : "positive_is_deduction";
  const asCharge = (v: Decimal, credit: boolean) => {
    const deducted = convention === "negative_is_deduction" ? v.neg() : v;
    return credit ? deducted.neg().abs().neg() : deducted; // credits always reduce charges
  };

  for (const t of tables) {
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, a]) => [k, column(t.header, a)])) as Record<keyof typeof COLUMNS, number>;
    for (const [i, h] of t.header.entries()) {
      const looksMoney = t.rows.slice(0, 50).some((r) => (looseMoney(r[i])?.isZero() === false) && /\d/.test(r[i] ?? ""));
      if (looksMoney && !known.has(normalise(h)) && /fee|charge|commission|deduction|penalt|amount|tax/i.test(h)) unmapped.add(h);
    }
    t.rows.forEach((r, n) => {
      const ref = `${t.file}:${n + 2}`;
      const order = r[col.order] ?? "";
      const date = looseDate(r[col.paymentDate]);
      if (!order) return;
      if (!date) {
        issues.push({ severity: "warning", code: "MEESHO_NOT_PAID_YET", entity: "channel_charge", rowRef: ref, message: `Sub-order ${order} has no payment date; skipped` });
        return;
      }
      const settlementRef = (col.transaction >= 0 && r[col.transaction]) || `MEESHO-${date}`;
      for (const [aliases, type, inclGst, credit] of CHARGES) {
        const i = column(t.header, aliases);
        if (i < 0) continue;
        const value = looseMoney(r[i]);
        if (value === null) {
          issues.push({ severity: "error", code: "MEESHO_BAD_AMOUNT", entity: "channel_charge", rowRef: ref, message: `${t.header[i]} "${r[i]}" is not a number` });
          continue;
        }
        if (value.isZero()) continue;
        const charge = asCharge(value, credit);
        const amount = inclGst ? charge.mul(100).div(FEE_GST_RATE.add(100)).toDecimalPlaces(2, D.ROUND_HALF_UP) : type === "other_fee_gst" ? new D(0) : charge;
        const gst = inclGst ? charge.sub(amount) : type === "other_fee_gst" ? charge : new D(0);
        rows.push({
          channel: "meesho",
          settlement_ref: settlementRef,
          settlement_date: date,
          order_voucher_no: type === "tds_income_tax" ? "" : order,
          charge_type: type === "other_fee_gst" ? "other_fee" : type,
          amount: money(amount),
          gst_amount: money(gst)
        });
      }
    });
  }
  if (unmapped.size > 0) {
    issues.push({
      severity: "warning",
      code: "MEESHO_UNMAPPED_COLUMNS",
      entity: "channel_charge",
      message: `Columns not recognised as charges, so not imported: ${[...unmapped].join(", ")}. Check whether they are deductions.`
    });
  }
  return { rows, issues, signConvention: convention, unmapped: [...unmapped] };
}
