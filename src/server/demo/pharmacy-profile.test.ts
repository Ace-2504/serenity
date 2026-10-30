import { beforeAll, describe, expect, it } from "vitest";
import { pharmacyPack } from "@/domain/packs/pharmacy";
import { backOutTax, generateDemoDataset, type DemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { pharmacyDemoProfile } from "@/server/demo/profiles/pharmacy";
import { IssueLog } from "@/server/ingest/issues";
import { parseBundle } from "@/server/ingest/parse";
import { parsePaise } from "@/server/ingest/template";
import { emptyKnown, validateBundle } from "@/server/ingest/validate";

/** The pharmacy demo profile, read back from its emitted rows only (black box). */

let data: DemoDataset;
beforeAll(() => {
  data = generateDemoDataset(pharmacyDemoProfile, 42);
}, 60_000);

describe("pharmacy demo data", () => {
  it("imports with no errors and reconciles; the only warnings are the planted missing opening values", () => {
    const log = new IssueLog();
    const reconciliation = validateBundle(parseBundle(datasetToFiles(data), log), emptyKnown(), log);
    expect(reconciliation.every((r) => r.ok && r.difference === "0.00")).toBe(true);
    expect(log.issues.map((i) => `${i.severity}:${i.code}`)).toEqual(Array(data.groundTruth.planted.missingOpeningValue.length).fill("warning:MISSING_OPENING_VALUE"));
   }, 60_000);

  it("gives every item valid pharmacy attributes", () => {
    for (const item of data.items) expect(pharmacyPack.itemAttributes.safeParse(JSON.parse(item.attributes_json)).success, item.item_code).toBe(true);
  });

  it("puts a batch and expiry on every stock line, and bills retail at or below MRP", () => {
    const stockLines = data.vouchers.filter((v) => v.voucher_type !== "purchase_return" || v.batch_no);
    expect(stockLines.every((v) => v.batch_no && v.expiry_date && v.mrp)).toBe(true);
    for (const v of data.vouchers.filter((r) => r.voucher_type === "sales_invoice" && r.amount_incl_tax)) {
      expect(parsePaise(v.amount_incl_tax!)).toBeLessThanOrEqual(Number(v.qty) * parsePaise(v.mrp!));
    }
  });

  it("sells earliest-expiring stock first and never sells a batch after its expiry (replayed from the rows)", () => {
    const lots = new Map<string, { item: string; expiry: string; qty: number }>();
    const byItem = new Map<string, string[]>();
    const add = (item: string, batch: string, expiry: string, qty: number) => {
      let lot = lots.get(batch);
      if (!lot) {
        lot = { item, expiry, qty: 0 };
        lots.set(batch, lot);
        byItem.set(item, [...(byItem.get(item) ?? []), batch]);
      }
      lot.qty += qty;
    };
    for (const b of data.batches) add(b.item_code, b.batch_no, b.expiry_date, Number(b.opening_qty));
    const violations: string[] = [];
    for (const v of data.vouchers) {
      const qty = Number(v.qty);
      if (v.voucher_type === "purchase_invoice" || v.voucher_type === "sales_return") add(v.item_code, v.batch_no!, v.expiry_date!, qty);
      else if (v.voucher_type === "purchase_return") add(v.item_code, v.batch_no!, v.expiry_date!, -qty);
      else {
        if (v.expiry_date! < v.date) violations.push(`${v.voucher_no} sold ${v.batch_no} after expiry`);
        const earlier = (byItem.get(v.item_code) ?? []).find((no) => {
          const l = lots.get(no)!;
          return no !== v.batch_no && l.qty > 0 && l.expiry >= v.date && l.expiry < v.expiry_date!;
        });
        if (earlier) violations.push(`${v.voucher_no} sold ${v.batch_no} while ${earlier} expires earlier`);
        add(v.item_code, v.batch_no!, v.expiry_date!, -qty);
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    const onHand = [...lots.entries()].filter(([, l]) => l.qty > 0).map(([no, l]) => `${l.item}|${no}|${l.qty}`).sort();
    expect(onHand).toEqual(data.groundTruth.batchesOnHand.map((b) => `${b.itemCode}|${b.batchNo}|${b.qty}`).sort());
  }, 60_000);

  it("leaves expired and short-dated stock to find", () => {
    const end = data.meta.periodTo;
    expect(data.groundTruth.batchesOnHand.some((b) => b.expiryDate < end)).toBe(true);
    expect(data.groundTruth.planted.shortDated.length).toBe(6);
  });
});

describe("backing GST out of an inclusive amount", () => {
  it("rounds half up exactly as decimal arithmetic does", () => {
    // 100.80 incl. 12% -> 90.00; 1.12 incl. 12% -> 1.00; 0.05 incl. 18% -> 0.04 (0.0423...)
    expect([backOutTax(10_080, 12), backOutTax(112, 12), backOutTax(5, 18), backOutTax(1_050, 5)]).toEqual([9_000, 100, 4, 1_000]);
  });
});
