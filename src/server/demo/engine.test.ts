import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { generateDemoDataset, type DemoDataset } from "@/server/demo/engine";
import { stationeryDemoProfile as profile } from "@/server/demo/profiles/stationery";
import { parsePaise, TAX_WITHHELD_CHARGE_TYPES, type VoucherRow } from "@/server/ingest/template";

/**
 * These tests treat the generator as a black box: they read only the emitted template rows
 * and rebuild stock, weighted-average cost, bills and contribution independently. The
 * generator's ground truth is then checked against that independent rebuild.
 */

const TYPE_RANK: Record<string, number> = { purchase_invoice: 0, sales_invoice: 1, sales_return: 2, purchase_return: 3 };

type Replay = {
  finalQty: Map<string, number>;
  finalValue: Map<string, number | null>;
  zeroStockDays: Map<string, Set<string>>;
  /** Cost of each sales line, keyed by voucher_no|item_code; null when unknown. */
  saleCost: Map<string, number | null>;
  /** Cost restored by each credit note row, keyed by voucher_no|item_code. */
  returnCost: Map<string, number | null>;
  minQtySeen: number;
};

function replayLedger(data: DemoDataset): Replay {
  const qty = new Map<string, number>();
  const value = new Map<string, number | null>();
  for (const item of data.items) {
    qty.set(item.item_code, Number(item.opening_qty));
    value.set(item.item_code, item.opening_value === "" ? null : parsePaise(item.opening_value));
  }
  const saleCost = new Map<string, number | null>();
  const returnCost = new Map<string, number | null>();
  const saleQty = new Map<string, number>();
  const zeroStockDays = new Map<string, Set<string>>();
  let minQtySeen = Infinity;

  const settle = (code: string, date: string) => {
    const q = qty.get(code)!;
    minQtySeen = Math.min(minQtySeen, q);
    if (q === 0) {
      value.set(code, 0);
      zeroStockDays.set(code, (zeroStockDays.get(code) ?? new Set()).add(date));
    }
  };

  for (const row of data.vouchers) {
    const code = row.item_code;
    const q = Number(row.qty);
    const v = value.get(code)!;
    const taxable = parsePaise(row.taxable_amount);
    switch (row.voucher_type) {
      case "purchase_invoice":
        qty.set(code, qty.get(code)! + q);
        value.set(code, v === null ? null : v + taxable);
        break;
      case "sales_invoice": {
        const onHand = qty.get(code)!;
        const cost = v === null ? null : Math.round((q * v) / onHand);
        qty.set(code, onHand - q);
        value.set(code, v === null || cost === null ? null : v - cost);
        saleCost.set(`${row.voucher_no}|${code}`, cost);
        saleQty.set(`${row.voucher_no}|${code}`, q);
        break;
      }
      case "sales_return": {
        const key = `${row.original_voucher_no}|${code}`;
        const original = saleCost.get(key);
        const cost = original === null || original === undefined ? null : Math.round((original * q) / saleQty.get(key)!);
        qty.set(code, qty.get(code)! + q);
        value.set(code, v === null || cost === null ? v : v + cost);
        returnCost.set(`${row.voucher_no}|${code}`, cost);
        break;
      }
      case "purchase_return":
        qty.set(code, qty.get(code)! - q);
        value.set(code, v === null ? null : v - taxable);
        break;
    }
    settle(code, row.date);
  }
  return { finalQty: qty, finalValue: value, zeroStockDays, saleCost, returnCost, minQtySeen };
}

const vouchersOf = (data: DemoDataset, type: string) => data.vouchers.filter((v) => v.voucher_type === type);
const groupBy = <T>(rows: T[], key: (row: T) => string) => {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
};
const lineTotal = (row: VoucherRow) => parsePaise(row.taxable_amount) + parsePaise(row.tax_amount);
const fyOf = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
};

let data: DemoDataset;
let replay: Replay;

beforeAll(() => {
  data = generateDemoDataset(profile, 42);
  replay = replayLedger(data);
}, 60_000);

describe("determinism and labelling", () => {
  it("produces identical output for the same seed and different output for another", () => {
    const hash = (d: DemoDataset) => createHash("sha256").update(JSON.stringify(d)).digest("hex");
    expect(hash(generateDemoDataset(profile, 42))).toBe(hash(data));
    expect(hash(generateDemoDataset(profile, 7))).not.toBe(hash(data));
  }, 60_000);

  it("is labelled as synthetic demo data", () => {
    expect(data.meta.isDemo).toBe(true);
    expect(data.meta.company).toMatch(/DEMO/);
    expect(data.meta.notice).toMatch(/SYNTHETIC/);
  });

  it("contains no realistic contact details or tax ids", () => {
    for (const party of data.parties) {
      expect(party.phone === "" || /^\+91 00000 \d{5}$/.test(party.phone)).toBe(true);
      expect(party.email === "" || party.email.endsWith("@example.com")).toBe(true);
      expect(party.gstin).toBe("");
    }
  });
});

describe("referential integrity", () => {
  it("only references known items and parties, with the right party roles", () => {
    const items = new Set(data.items.map((i) => i.item_code));
    const role = new Map(data.parties.map((p) => [p.party_code, p.party_type]));
    const violations: string[] = [];
    for (const row of data.vouchers) {
      const expected = row.voucher_type.startsWith("sales") ? "customer" : "supplier";
      if (!items.has(row.item_code) || role.get(row.party_code) !== expected) violations.push(row.voucher_no);
    }
    for (const s of data.settlements) {
      if (role.get(s.party_code) !== (s.voucher_type === "receipt" ? "customer" : "supplier")) violations.push(s.voucher_no);
    }
    expect(violations).toEqual([]);
  });

  it("emits vouchers in posting order", () => {
    const violations: number[] = [];
    for (let i = 1; i < data.vouchers.length; i += 1) {
      const a = data.vouchers[i - 1];
      const b = data.vouchers[i];
      if (!(a.date < b.date || (a.date === b.date && TYPE_RANK[a.voucher_type] <= TYPE_RANK[b.voucher_type]))) violations.push(i);
    }
    expect(violations).toEqual([]);
  });
});

describe("line arithmetic", () => {
  it("satisfies taxable = qty x rate - discount and tax = round(taxable x rate) on every line", () => {
    const violations: string[] = [];
    for (const row of data.vouchers) {
      const qty = Number(row.qty);
      const rate = parsePaise(row.rate);
      const discount = parsePaise(row.discount_amount);
      const taxable = parsePaise(row.taxable_amount);
      const tax = parsePaise(row.tax_amount);
      if (!Number.isInteger(qty) || qty <= 0 || discount < 0 || taxable !== qty * rate - discount || tax !== Math.round((taxable * Number(row.gst_rate)) / 100)) {
        violations.push(`${row.voucher_no} line ${row.line_no}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("has unique item codes and unique (voucher, item) lines", () => {
    expect(new Set(data.items.map((i) => i.item_code)).size).toBe(data.items.length);
    const keys = data.vouchers.map((r) => `${r.voucher_type}|${r.voucher_no}|${r.item_code}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("inventory", () => {
  it("never lets stock go negative and ends at the reported stock summary", () => {
    expect(replay.minQtySeen).toBeGreaterThanOrEqual(0);
    for (const row of data.stockSummary) {
      expect(replay.finalQty.get(row.item_code)).toBe(Number(row.qty));
    }
  });

  it("reproduces the reported closing value with an independent weighted-average replay", () => {
    for (const row of data.stockSummary) {
      const value = replay.finalValue.get(row.item_code);
      expect(row.value === "" ? null : parsePaise(row.value)).toBe(value ?? null);
    }
  });
});

describe("returns", () => {
  it("only returns goods that were sold to the same party earlier, within the quantity sold", () => {
    const sales = groupBy(vouchersOf(data, "sales_invoice"), (r) => `${r.voucher_no}|${r.item_code}`);
    const returned = new Map<string, number>();
    for (const ret of vouchersOf(data, "sales_return")) {
      const key = `${ret.original_voucher_no}|${ret.item_code}`;
      const [orig] = sales.get(key) ?? [];
      expect(orig).toBeDefined();
      expect(orig.party_code).toBe(ret.party_code);
      expect(orig.date <= ret.date).toBe(true);
      returned.set(key, (returned.get(key) ?? 0) + Number(ret.qty));
      expect(returned.get(key)!).toBeLessThanOrEqual(Number(orig.qty));
    }
  });

  it("only returns purchases to the supplier they came from", () => {
    const purchases = groupBy(vouchersOf(data, "purchase_invoice"), (r) => `${r.voucher_no}|${r.item_code}`);
    for (const ret of vouchersOf(data, "purchase_return")) {
      const [orig] = purchases.get(`${ret.original_voucher_no}|${ret.item_code}`) ?? [];
      expect(orig?.party_code).toBe(ret.party_code);
      expect(Number(ret.qty)).toBeLessThanOrEqual(Number(orig.qty));
    }
  });
});

describe("receivables, payables and settlements", () => {
  function bills(invoiceType: string, returnType: string, settlementType: string, side: string) {
    const totals = new Map<string, { party: string; date: string; total: number; reduced: number; settled: number }>();
    for (const row of vouchersOf(data, invoiceType)) {
      const bill = totals.get(row.voucher_no) ?? { party: row.party_code, date: row.date, total: 0, reduced: 0, settled: 0 };
      bill.total += lineTotal(row);
      totals.set(row.voucher_no, bill);
    }
    for (const row of vouchersOf(data, returnType)) {
      totals.get(row.original_voucher_no)!.reduced += lineTotal(row);
    }
    for (const s of data.settlements.filter((x) => x.voucher_type === settlementType)) {
      const bill = totals.get(s.against_voucher_no);
      expect(bill, `${s.voucher_no} settles unknown bill ${s.against_voucher_no}`).toBeDefined();
      expect(bill!.party).toBe(s.party_code);
      expect(s.date >= bill!.date).toBe(true);
      bill!.settled += parsePaise(s.amount);
    }
    const reported = new Map(data.outstanding.filter((o) => o.side === side).map((o) => [o.bill_ref, parsePaise(o.pending_incl_tax)]));
    for (const [no, bill] of totals) {
      const pending = bill.total - bill.reduced - bill.settled;
      expect(pending, `${no} over-settled`).toBeGreaterThanOrEqual(0);
      expect(reported.get(no) ?? 0).toBe(pending);
    }
    expect([...reported.keys()].every((no) => totals.has(no))).toBe(true);
  }

  it("never over-settles a sales bill, and reports exactly the open receivables", () => {
    bills("sales_invoice", "sales_return", "receipt", "receivable");
  });

  it("never over-settles a purchase bill, and reports exactly the open payables", () => {
    bills("purchase_invoice", "purchase_return", "payment", "payable");
  });
});

describe("control totals", () => {
  it("match totals recomputed from the rows", () => {
    const sum = (rows: Record<string, string>[], field: string) => rows.reduce((s, r) => s + parsePaise(r[field]), 0);
    const expected: Record<string, number> = {
      sales_taxable: sum(vouchersOf(data, "sales_invoice"), "taxable_amount"),
      sales_tax: sum(vouchersOf(data, "sales_invoice"), "tax_amount"),
      sales_return_taxable: sum(vouchersOf(data, "sales_return"), "taxable_amount"),
      purchase_taxable: sum(vouchersOf(data, "purchase_invoice"), "taxable_amount"),
      purchase_return_taxable: sum(vouchersOf(data, "purchase_return"), "taxable_amount"),
      receipts: sum(data.settlements.filter((s) => s.voucher_type === "receipt"), "amount"),
      payments: sum(data.settlements.filter((s) => s.voucher_type === "payment"), "amount"),
      channel_charges: sum(data.channelCharges, "amount")
    };
    for (const row of data.controlTotals) {
      expect(parsePaise(row.value), row.metric).toBe(expected[row.metric]);
    }
  });
});

describe("channel charges", () => {
  it("attach to the channel's own orders; period-level TDS carries no order", () => {
    const invoiceChannel = new Map(vouchersOf(data, "sales_invoice").map((r) => [r.voucher_no, { channel: r.channel, date: r.date }]));
    for (const charge of data.channelCharges) {
      if (charge.charge_type === "tds_income_tax") {
        expect(charge.order_voucher_no).toBe("");
        continue;
      }
      const order = invoiceChannel.get(charge.order_voucher_no);
      expect(order?.channel).toBe(charge.channel);
      expect(charge.settlement_date >= order!.date).toBe(true);
    }
  });

  it("charges marketplaces and gateways only", () => {
    const charged = new Set(data.channelCharges.map((c) => c.channel));
    expect([...charged].sort()).toEqual(["amazon", "meesho", "own_web"]);
  });
});

describe("ground truth agrees with the independent rebuild", () => {
  it("net sales and known-cost COGS per financial year", () => {
    const fy = new Map<string, { netSales: number; cogs: number }>();
    const bucket = (iso: string) => fy.get(fyOf(iso)) ?? fy.set(fyOf(iso), { netSales: 0, cogs: 0 }).get(fyOf(iso))!;
    for (const row of vouchersOf(data, "sales_invoice")) {
      bucket(row.date).netSales += parsePaise(row.taxable_amount);
      bucket(row.date).cogs += replay.saleCost.get(`${row.voucher_no}|${row.item_code}`) ?? 0;
    }
    for (const row of vouchersOf(data, "sales_return")) {
      bucket(row.date).netSales -= parsePaise(row.taxable_amount);
      bucket(row.date).cogs -= replay.returnCost.get(`${row.voucher_no}|${row.item_code}`) ?? 0;
    }
    for (const [year, truth] of Object.entries(data.groundTruth.byFinancialYear)) {
      expect(fy.get(year)?.netSales, year).toBe(truth.netSales);
      expect(fy.get(year)?.cogs, year).toBe(truth.cogsKnownCost);
    }
  });

  it("contribution by channel and item", () => {
    const taxWithheld = new Set<string>(TAX_WITHHELD_CHARGE_TYPES);
    const chargesByOrder = new Map<string, number>();
    for (const c of data.channelCharges) {
      if (taxWithheld.has(c.charge_type)) continue;
      chargesByOrder.set(c.order_voucher_no, (chargesByOrder.get(c.order_voucher_no) ?? 0) + parsePaise(c.amount));
    }
    const sales = vouchersOf(data, "sales_invoice");
    const orderTaxable = new Map<string, number>();
    for (const row of sales) orderTaxable.set(row.voucher_no, (orderTaxable.get(row.voucher_no) ?? 0) + parsePaise(row.taxable_amount));
    const returns = groupBy(vouchersOf(data, "sales_return"), (r) => `${r.original_voucher_no}|${r.item_code}`);

    const rebuilt = new Map<string, { netSales: number; cogs: number; charges: number }>();
    for (const row of sales) {
      const cost = replay.saleCost.get(`${row.voucher_no}|${row.item_code}`);
      if (cost === null || cost === undefined) continue;
      const key = `${row.channel}|${row.item_code}`;
      const entry = rebuilt.get(key) ?? { netSales: 0, cogs: 0, charges: 0 };
      const rets = returns.get(`${row.voucher_no}|${row.item_code}`) ?? [];
      const taxable = parsePaise(row.taxable_amount);
      entry.netSales += taxable - rets.reduce((s, r) => s + parsePaise(r.taxable_amount), 0);
      entry.cogs += cost - rets.reduce((s, r) => s + (replay.returnCost.get(`${r.voucher_no}|${r.item_code}`) ?? 0), 0);
      entry.charges += Math.round(((chargesByOrder.get(row.voucher_no) ?? 0) * taxable) / orderTaxable.get(row.voucher_no)!);
      rebuilt.set(key, entry);
    }
    for (const truth of data.groundTruth.contributionByChannelItem) {
      const mine = rebuilt.get(`${truth.channel}|${truth.itemCode}`) ?? { netSales: 0, cogs: 0, charges: 0 };
      expect(mine, `${truth.channel}|${truth.itemCode}`).toEqual({ netSales: truth.netSales, cogs: truth.cogs, charges: truth.charges });
    }
  });
});

describe("planted problems are visible in the emitted data", () => {
  const planted = () => data.groundTruth.planted;
  const salesRows = () => vouchersOf(data, "sales_invoice");

  it("slow movers: bulk-bought, then no sales, with stock left on hand", () => {
    for (const { itemCode, stopSellingFrom, bulkBuyOn } of planted().slowMovers) {
      const sold = salesRows().filter((r) => r.item_code === itemCode);
      expect(sold.some((r) => r.date < stopSellingFrom)).toBe(true);
      expect(sold.some((r) => r.date >= stopSellingFrom)).toBe(false);
      expect(vouchersOf(data, "purchase_invoice").some((r) => r.item_code === itemCode && r.date === bulkBuyOn)).toBe(true);
      expect(replay.finalQty.get(itemCode)!).toBeGreaterThan(0);
    }
    expect(planted().slowMovers).toHaveLength(profile.plant.slowMovers.count);
  });

  it("lapsing key customers: among the top buyers, then silent", () => {
    const { stopFrom } = planted().lapsingKeyCustomers[0];
    const before = new Map<string, number>();
    for (const r of salesRows()) {
      if (r.date < stopFrom && r.channel === "direct") before.set(r.party_code, (before.get(r.party_code) ?? 0) + parsePaise(r.taxable_amount));
    }
    const ranking = [...before.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
    for (const { partyCode } of planted().lapsingKeyCustomers) {
      expect(ranking.indexOf(partyCode)).toBeLessThan(15);
      expect(salesRows().some((r) => r.party_code === partyCode && r.date >= stopFrom)).toBe(false);
    }
  });

  it("schools that bought for last school year have not reordered", () => {
    const [from, to] = profile.plant.schoolsNotReordering.orderedBetween;
    for (const { partyCode, stopFrom } of planted().schoolsNotReordering) {
      const rows = salesRows().filter((r) => r.party_code === partyCode);
      expect(rows.some((r) => r.date >= from && r.date <= to)).toBe(true);
      expect(rows.some((r) => r.date >= stopFrom)).toBe(false);
    }
    expect(planted().schoolsNotReordering).toHaveLength(profile.plant.schoolsNotReordering.count);
  });

  it("margin erosion: the planted group's gross margin falls by at least 5 points", () => {
    const { group, from } = planted().marginErosion;
    const groupOf = new Map(data.items.map((i) => [i.item_code, i.group]));
    const margin = (rows: VoucherRow[]) => {
      let sales = 0;
      let cost = 0;
      for (const r of rows) {
        const c = replay.saleCost.get(`${r.voucher_no}|${r.item_code}`);
        if (c === null || c === undefined) continue;
        sales += parsePaise(r.taxable_amount);
        cost += c;
      }
      return (sales - cost) / sales;
    };
    const inGroup = salesRows().filter((r) => groupOf.get(r.item_code) === group);
    const before = margin(inGroup.filter((r) => r.date < from));
    const after = margin(inGroup.filter((r) => r.date >= "2026-04-01"));
    expect(before - after).toBeGreaterThan(0.05);

    const others = salesRows().filter((r) => groupOf.get(r.item_code) !== group);
    const othersShift = margin(others.filter((r) => r.date < from)) - margin(others.filter((r) => r.date >= "2026-04-01"));
    expect(Math.abs(othersShift)).toBeLessThan(0.03);
  });

  it("slow payers take at least 20 days longer to pay after the change", () => {
    const finalPay = new Map<string, string>();
    for (const s of data.settlements) if (s.voucher_type === "receipt") finalPay.set(s.against_voucher_no, s.date);
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    const invoices = [...new Map(salesRows().map((r) => [r.voucher_no, r])).values()];
    const avgDelay = (codes: Set<string>, pick: (date: string) => boolean) => {
      const delays = invoices
        .filter((r) => codes.has(r.party_code) && pick(r.date) && finalPay.has(r.voucher_no))
        .map((r) => days(r.date, finalPay.get(r.voucher_no)!));
      return delays.reduce((s, d) => s + d, 0) / delays.length;
    };
    const codes = new Set(planted().slowPayers.map((p) => p.partyCode));
    const from = planted().slowPayers[0].from;
    expect(avgDelay(codes, (d) => d >= from && d < "2026-07-01") - avgDelay(codes, (d) => d < from)).toBeGreaterThan(20);
  });

  it("stockout items run out of stock repeatedly", () => {
    for (const { itemCode } of planted().stockoutItems) {
      expect(replay.zeroStockDays.get(itemCode)?.size ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it("items with missing opening values are exactly the planted ones", () => {
    const missing = data.items.filter((i) => Number(i.opening_qty) > 0 && i.opening_value === "").map((i) => i.item_code);
    expect(missing.sort()).toEqual(planted().missingOpeningValue.map((m) => m.itemCode).sort());
  });

  it("some items are profitable direct but lose money on a marketplace after fees", () => {
    const byKey = new Map(data.groundTruth.contributionByChannelItem.map((c) => [`${c.channel}|${c.itemCode}`, c]));
    const lossMakers = data.groundTruth.contributionByChannelItem.filter(
      (c) => (c.channel === "meesho" || c.channel === "amazon") && c.contribution < 0 && (byKey.get(`direct|${c.itemCode}`)?.contribution ?? 0) > 0
    );
    expect(lossMakers.length).toBeGreaterThan(0);
  });
});
