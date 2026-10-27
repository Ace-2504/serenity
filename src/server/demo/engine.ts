import { getDomainPack } from "@/domain/packs";
import { createRng, type Rng } from "@/server/demo/rng";
import type { ChargeRule, ChannelSpec, DemoProfile, SegmentSpec } from "@/server/demo/profile";
import {
  formatPaise,
  TAX_WITHHELD_CHARGE_TYPES,
  type ChannelChargeRow,
  type ControlTotalRow,
  type CustomerOrderRow,
  type ItemRow,
  type OutstandingRow,
  type PartyRow,
  type SettlementRow,
  type StockSummaryRow,
  type BatchRow,
  type VoucherRow
} from "@/server/ingest/template";

/**
 * Synthetic-data engine. All money is integer paise and all quantities integers, so the
 * output is exact and reproducible. Inventory is costed at weighted-average cost (WAC):
 * an issue of q units costs round(q * value / qtyOnHand) and reduces the pool by that
 * rounded amount; when stock reaches zero the pool value resets to zero.
 *
 * Posting order within a day (the order rows appear in vouchers.csv):
 *   purchase arrivals -> sales -> sales returns -> purchase returns -> settlements -> weekly reorder review
 */

const DAY_MS = 86_400_000;

export const GENERATOR_VERSION = "1.2.0";

export type DemoDataset = {
  meta: {
    company: string;
    packId: string;
    seed: number;
    generatorVersion: string;
    isDemo: true;
    periodFrom: string;
    periodTo: string;
    notice: string;
  };
  items: ItemRow[];
  parties: PartyRow[];
  vouchers: VoucherRow[];
  settlements: SettlementRow[];
  stockSummary: StockSummaryRow[];
  outstanding: OutstandingRow[];
  channelCharges: ChannelChargeRow[];
  customerOrders: CustomerOrderRow[];
  /** Opening stock by batch (batch-tracked profiles only; empty otherwise). */
  batches: BatchRow[];
  controlTotals: ControlTotalRow[];
  groundTruth: GroundTruth;
};

export type GroundTruth = {
  planted: {
    slowMovers: { itemCode: string; stopSellingFrom: string; bulkBuyOn: string }[];
    lapsingKeyCustomers: { partyCode: string; stopFrom: string; ordersBefore: number }[];
    schoolsNotReordering: { partyCode: string; stopFrom: string }[];
    marginErosion: { group: string; costIncreasePct: number; from: string; extraDiscountPct: number; discountFrom: string };
    slowPayers: { partyCode: string; from: string; extraDelayDays: number }[];
    stockoutItems: { itemCode: string }[];
    missingOpeningValue: { itemCode: string }[];
    shortDated: { itemCode: string; batchNo: string; expiryDate: string }[];
    expiredOpening: { itemCode: string; batchNo: string; expiryDate: string }[];
  };
  /** Batch-tracked profiles: every batch still holding stock at the end, with its expiry. */
  batchesOnHand: { itemCode: string; batchNo: string; expiryDate: string; qty: number }[];
  /** Per financial year: what an importer + metrics layer must reproduce. Paise. */
  byFinancialYear: Record<
    string,
    { netSales: number; netSalesKnownCost: number; cogsKnownCost: number; salesReturns: number; discounts: number }
  >;
  /** Contribution per channel and item: net sales - COGS - channel charges (ex-GST, ex tax withheld). Paise. */
  contributionByChannelItem: { channel: string; itemCode: string; netSales: number; cogs: number; charges: number; contribution: number }[];
  lostDemandQtyByChannel: Record<string, number>;
  /** Quick-commerce purchase orders: units ordered and supplied per channel (fill rate = supplied / ordered). */
  purchaseOrderUnitsByChannel: Record<string, { ordered: number; supplied: number }>;
  demandQtyByChannel: Record<string, number>;
};

type Item = {
  idx: number;
  code: string;
  name: string;
  group: string;
  hsnCode: string;
  gstPct: number;
  baseCost: number;
  markup: number;
  popularity: number;
  supplierIdx: number;
  attributes: Record<string, string>;
};

type Customer = {
  idx: number;
  code: string;
  segment: SegmentSpec;
  ordersPerWeek: number;
  sizeFactor: number;
  discountPct: number;
  payDelayMean: number;
  city: { name: string; stateCode: string };
};

type Supplier = { idx: number; code: string; name: string; leadDays: number; creditDays: number; tradeDiscountPct: number };

type Intent = { day: number; customerIdx: number; lines: { itemIdx: number; qty: number }[] };

/** A batch of one item: what is printed on the pack. Quantities change as stock moves. */
type BatchLot = { no: string; itemIdx: number; expiryDay: number; mfgDay: number; mrp: number; qty: number };

type SalesLine = {
  lineNo: number;
  itemIdx: number;
  qty: number;
  rate: number;
  discount: number;
  taxable: number;
  gstPct: number;
  tax: number;
  cost: number | null;
  batch?: BatchLot;
  /** Tax-inclusive line total when the line was billed at MRP. */
  inclusive?: number;
};

type SalesInvoice = {
  no: string;
  day: number;
  customerIdx: number;
  channel: string;
  lines: SalesLine[];
  total: number;
  credited: number;
  creditedTaxable: number;
  paid: number;
  dueDay: number | null;
  /** First day a payment arrives; returns are only accepted before it. */
  firstPayDay: number;
  returnedQtyByLine: Map<number, number>;
  returnedCostByLine: Map<number, number>;
  returnedTaxableByLine: Map<number, number>;
  hadReturn: boolean;
};

type PurchaseLine = { lineNo: number; itemIdx: number; qty: number; rate: number; discount: number; taxable: number; gstPct: number; tax: number; batch?: BatchLot };

type PurchaseInvoice = { no: string; day: number; supplierIdx: number; lines: PurchaseLine[]; total: number; returned: number; paid: number; payDay: number };

export function generateDemoDataset(profile: DemoProfile, seed: number): DemoDataset {
  const root = createRng(seed);
  const startMs = Date.parse(`${profile.start}T00:00:00Z`);
  const dayOf = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - startMs) / DAY_MS);
  const isoOf = (day: number) => new Date(startMs + day * DAY_MS).toISOString().slice(0, 10);
  const monthOf = (day: number) => new Date(startMs + day * DAY_MS).getUTCMonth() + 1;
  const fyOf = (day: number) => {
    const date = new Date(startMs + day * DAY_MS);
    const year = date.getUTCMonth() + 1 >= 4 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    return `${String(year).slice(2)}${String(year + 1).slice(2)}`;
  };
  const days = dayOf(profile.end) + 1;
  const channelById = new Map(profile.channels.map((c) => [c.id, c]));
  const seasonsByMonth = buildSeasonLookup(profile);

  // ── Catalogue ────────────────────────────────────────────────────────────
  const suppliers = buildSuppliers(profile, root.fork("suppliers"));
  const items = buildItems(profile, root.fork("items"), suppliers.length);
  const itemsByGroup = new Map<string, Item[]>();
  for (const item of items) {
    itemsByGroup.set(item.group, [...(itemsByGroup.get(item.group) ?? []), item]);
  }

  // ── Customers ────────────────────────────────────────────────────────────
  const customers = buildCustomers(profile, root.fork("customers"));

  // ── Plants: item-level choices that shape demand ─────────────────────────
  const plantRng = root.fork("plant");
  const plant = profile.plant;
  const taken = new Set<number>();
  const pickItems = (groups: string[], count: number, rng: Rng, preferPopular: boolean) => {
    const pool = items
      .filter((it) => groups.includes(it.group) && !taken.has(it.idx))
      .sort((a, b) => (preferPopular ? b.popularity - a.popularity : a.idx - b.idx));
    const chosen: Item[] = [];
    const candidates = preferPopular ? pool.slice(0, Math.max(count * 2, count)) : pool;
    while (chosen.length < count && candidates.length > 0) {
      const [it] = candidates.splice(rng.int(0, candidates.length - 1), 1);
      chosen.push(it);
      taken.add(it.idx);
    }
    return chosen;
  };
  const slowMovers = pickItems(plant.slowMovers.groups, plant.slowMovers.count, plantRng.fork("slow"), false);
  const stockoutItems = pickItems(plant.stockoutItems.groups, plant.stockoutItems.count, plantRng.fork("stockout"), true);
  const missingOpening = pickItems(
    profile.groups.map((g) => g.name),
    plant.missingOpeningValue.count,
    plantRng.fork("missing"),
    false
  );
  const slowStopDay = dayOf(plant.slowMovers.stopSellingFrom);
  const slowMoverSet = new Set(slowMovers.map((i) => i.idx));
  const stockoutSet = new Set(stockoutItems.map((i) => i.idx));
  const missingOpeningSet = new Set(missingOpening.map((i) => i.idx));
  const batchCfg = profile.batches;
  const shortDatedItems = batchCfg && plant.shortDated ? pickItems(plant.shortDated.groups, plant.shortDated.count, plantRng.fork("short-dated"), false) : [];
  const expiredOpeningItems = batchCfg && plant.expiredOpening ? pickItems(plant.expiredOpening.groups, plant.expiredOpening.count, plantRng.fork("expired-opening"), false) : [];
  const expiredOpeningSet = new Set(expiredOpeningItems.map((i) => i.idx));

  // ── Pass 1: demand intents (independent of stock) ───────────────────────
  const intents: Intent[] = [];
  for (const customer of customers) {
    const rng = root.fork(`demand/${customer.code}`);
    const seg = customer.segment;
    const groupNames = Object.keys(seg.groupWeights).filter((g) => itemsByGroup.has(g));
    const groupWeights = groupNames.map((g) => seg.groupWeights[g]);
    for (let day = 0; day < days; day += 1) {
      const lambda = (customer.ordersPerWeek * seasonFactor(seg, seasonsByMonth.get(monthOf(day)) ?? [])) / 7;
      const orders = rng.poisson(lambda);
      for (let o = 0; o < orders; o += 1) {
        const lineCount = rng.int(seg.linesPerOrder[0], seg.linesPerOrder[1]);
        const lines: Intent["lines"] = [];
        const used = new Set<number>();
        for (let attempt = 0; attempt < lineCount * 3 && lines.length < lineCount; attempt += 1) {
          const group = groupNames[rng.weightedIndex(groupWeights)];
          const pool = itemsByGroup.get(group) ?? [];
          const idx = rng.weightedIndex(pool.map((it) => it.popularity));
          const item = pool[idx];
          if (!item || used.has(item.idx)) {
            continue;
          }
          used.add(item.idx);
          const raw = rng.logUniform(seg.qty[0], seg.qty[1]) * customer.sizeFactor;
          const qty = Math.max(seg.qtyStep, Math.round(raw / seg.qtyStep) * seg.qtyStep);
          lines.push({ itemIdx: item.idx, qty });
        }
        if (lines.length > 0) {
          intents.push({ day, customerIdx: customer.idx, lines });
        }
      }
    }
  }

  // Customer-level plants are chosen after demand exists, so they are guaranteed to be real.
  const intentCountBefore = (customerIdx: number, beforeDay: number) =>
    intents.filter((i) => i.customerIdx === customerIdx && i.day < beforeDay).length;

  const lapsingStop = dayOf(plant.lapsingKeyCustomers.stopFrom);
  const lapsing = customers
    .filter((c) => c.segment.id === plant.lapsingKeyCustomers.segment)
    .map((c) => ({ c, volume: intents.filter((i) => i.customerIdx === c.idx).reduce((s, i) => s + i.lines.reduce((t, l) => t + l.qty, 0), 0) }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, plant.lapsingKeyCustomers.count)
    .map(({ c }) => c);

  const [orderedFrom, orderedTo] = plant.schoolsNotReordering.orderedBetween.map(dayOf);
  const schoolStop = dayOf(plant.schoolsNotReordering.stopFrom);
  const schoolRng = plantRng.fork("schools");
  const eligibleSchools = customers.filter(
    (c) =>
      c.segment.id === plant.schoolsNotReordering.segment &&
      intents.some((i) => i.customerIdx === c.idx && i.day >= orderedFrom && i.day <= orderedTo)
  );
  const schoolsNotReordering: Customer[] = [];
  while (schoolsNotReordering.length < plant.schoolsNotReordering.count && eligibleSchools.length > 0) {
    schoolsNotReordering.push(eligibleSchools.splice(schoolRng.int(0, eligibleSchools.length - 1), 1)[0]);
  }

  const lapsingSet = new Set(lapsing.map((c) => c.idx));
  const schoolStopSet = new Set(schoolsNotReordering.map((c) => c.idx));
  const lapsingOrdersBefore = new Map(lapsing.map((c) => [c.idx, intentCountBefore(c.idx, lapsingStop)]));

  const keptIntents = intents
    .filter((i) => !(lapsingSet.has(i.customerIdx) && i.day >= lapsingStop))
    .filter((i) => !(schoolStopSet.has(i.customerIdx) && i.day >= schoolStop))
    .map((i) => (i.day >= slowStopDay ? { ...i, lines: i.lines.filter((l) => !slowMoverSet.has(l.itemIdx)) } : i))
    .filter((i) => i.lines.length > 0)
    .sort((a, b) => a.day - b.day || a.customerIdx - b.customerIdx);

  const intentsByDay: Intent[][] = Array.from({ length: days }, () => []);
  const desired: number[][] = items.map(() => new Array<number>(days).fill(0));
  for (const intent of keptIntents) {
    intentsByDay[intent.day].push(intent);
    for (const line of intent.lines) {
      desired[line.itemIdx][intent.day] += line.qty;
    }
  }
  const desiredPrefix = desired.map((row) => {
    const prefix = new Array<number>(row.length + 1).fill(0);
    row.forEach((v, i) => (prefix[i + 1] = prefix[i] + v));
    return prefix;
  });
  const avgDailyDemand = (itemIdx: number, fromDay: number, toDayExclusive: number) => {
    const from = Math.max(0, fromDay);
    const to = Math.max(from + 1, Math.min(days, toDayExclusive));
    return (desiredPrefix[itemIdx][to] - desiredPrefix[itemIdx][from]) / (to - from);
  };

  // ── Prices and costs ─────────────────────────────────────────────────────
  const erosion = plant.marginErosion;
  const erosionFrom = dayOf(erosion.from);
  const erosionDiscountFrom = dayOf(erosion.discountFrom);
  const revisionDays: number[] = [];
  for (let day = 1; day < days; day += 1) {
    const d = new Date(startMs + day * DAY_MS);
    if (d.getUTCDate() === 1 && d.getUTCMonth() + 1 === profile.priceRevision.month) {
      revisionDays.push(day);
    }
  }
  const revisionFactor = (item: Item, day: number) => {
    const applicable = revisionDays.filter((r) => r <= day && !(item.group === erosion.group && r >= erosionFrom));
    return (1 + profile.priceRevision.pct / 100) ** applicable.length;
  };
  const wholesalePrice = (item: Item, day: number) => Math.round(item.baseCost * (1 + item.markup) * revisionFactor(item, day));
  const retailPrice = (item: Item, day: number) => Math.round((wholesalePrice(item, day) * profile.retailFactor) / 100) * 100;
  const priceFor = (item: Item, day: number, tier: SegmentSpec["priceTier"]) => {
    if (tier === "wholesale") return wholesalePrice(item, day);
    if (tier === "retail") return retailPrice(item, day);
    return Math.round(retailPrice(item, day) * (1 - profile.platformDiscountPct / 100));
  };
  const costFor = (item: Item, day: number) => {
    const inflation = 1 + (profile.costInflationPctPerYear / 100) * (day / 365);
    const step = item.group === erosion.group && day >= erosionFrom ? 1 + erosion.costIncreasePct / 100 : 1;
    return Math.round(item.baseCost * inflation * step);
  };

  // ── Pass 2: day-by-day simulation ────────────────────────────────────────
  const stockQty = new Array<number>(items.length).fill(0);
  const stockValue: (number | null)[] = new Array<number | null>(items.length).fill(0);
  const onOrder = new Array<number>(items.length).fill(0);

  // ── Batches (batch-tracked profiles only) ────────────────────────────────
  // Each item's lots, earliest expiry first. Expiry is the last day of the printed month and the
  // pack may be sold up to and including that day.
  const lots: BatchLot[][] = items.map(() => []);
  const lotSeq = new Array<number>(items.length).fill(0);
  const batchRng = root.fork("batches");
  const shelfLife = new Map(profile.groups.map((g) => [g.name, g.shelfLifeDays ?? ([730, 1095] as [number, number])]));
  const monthEnd = (day: number) => {
    const d = new Date(startMs + day * DAY_MS);
    return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) - startMs) / DAY_MS);
  };
  const mrpFor = (item: Item, day: number) => {
    const step = batchCfg!.mrpRoundPaise;
    return Math.ceil((retailPrice(item, day) * (100 + item.gstPct)) / 100 / step) * step;
  };
  const newLot = (item: Item, day: number, qty: number, lifeLeftDays?: number): BatchLot => {
    const [minLife, maxLife] = shelfLife.get(item.group)!;
    const mfgDay = day - batchRng.int(batchCfg!.ageAtArrivalDays[0], batchCfg!.ageAtArrivalDays[1]);
    const expiryDay = monthEnd(lifeLeftDays !== undefined ? day + lifeLeftDays : mfgDay + batchRng.int(minLife, maxLife));
    lotSeq[item.idx] += 1;
    const lot: BatchLot = { no: `${item.code.replace(/-/g, "")}-${String(lotSeq[item.idx]).padStart(3, "0")}`, itemIdx: item.idx, expiryDay, mfgDay, mrp: mrpFor(item, day), qty };
    lots[item.idx].push(lot);
    lots[item.idx].sort((a, b) => a.expiryDay - b.expiryDay || a.no.localeCompare(b.no));
    return lot;
  };
  /** Units that may still be sold today: unexpired lots only. */
  const sellable = (itemIdx: number, day: number) => (batchCfg ? lots[itemIdx].reduce((s, l) => s + (l.expiryDay >= day ? l.qty : 0), 0) : stockQty[itemIdx]);
  /** Earliest-expiry-first issue across unexpired lots. */
  const takeFefo = (itemIdx: number, qty: number, day: number) => {
    const parts: { qty: number; lot: BatchLot }[] = [];
    let left = qty;
    for (const lot of lots[itemIdx]) {
      if (left === 0) break;
      if (lot.expiryDay < day || lot.qty === 0) continue;
      const take = Math.min(lot.qty, left);
      lot.qty -= take;
      left -= take;
      parts.push({ qty: take, lot });
    }
    return parts;
  };
  const batchRows: BatchRow[] = [];
  const shortDatedLots: BatchLot[] = [];
  const expiredOpeningLots: BatchLot[] = [];

  const itemRows: ItemRow[] = [];
  for (const item of items) {
    const baseOpening = roundUp(avgDailyDemand(item.idx, 0, 56) * profile.inventory.openingCoverDays, profile.inventory.caseSize) || profile.inventory.caseSize * 2;
    const openingQty = expiredOpeningSet.has(item.idx) ? roundUp(baseOpening * plant.expiredOpening!.coverMultiple, profile.inventory.caseSize) : baseOpening;
    if (batchCfg) {
      // Opening stock: an older and a newer batch, or one oversized old batch for the planted items.
      const caseSize = profile.inventory.caseSize;
      const parts: { qty: number; lifeLeft?: number }[] = expiredOpeningSet.has(item.idx)
        ? [{ qty: openingQty, lifeLeft: batchRng.int(plant.expiredOpening!.lifeLeftDays[0], plant.expiredOpening!.lifeLeftDays[1]) }]
        : [{ qty: Math.floor((openingQty * 0.4) / caseSize) * caseSize, lifeLeft: batchRng.int(150, 420) }, { qty: openingQty - Math.floor((openingQty * 0.4) / caseSize) * caseSize }];
      for (const part of parts.filter((p) => p.qty > 0)) {
        const lot = newLot(item, 0, part.qty, part.lifeLeft);
        if (expiredOpeningSet.has(item.idx)) expiredOpeningLots.push(lot);
        batchRows.push({ item_code: item.code, batch_no: lot.no, expiry_date: isoOf(lot.expiryDay), mfg_date: isoOf(lot.mfgDay), mrp: formatPaise(lot.mrp), opening_qty: String(part.qty), opening_value: "" });
      }
    }
    const openingValue = missingOpeningSet.has(item.idx) ? null : openingQty * costFor(item, 0);
    stockQty[item.idx] = openingQty;
    stockValue[item.idx] = openingValue;
    itemRows.push({
      item_code: item.code,
      name: item.name,
      group: item.group,
      uom: "pcs",
      hsn_code: item.hsnCode,
      gst_rate: item.gstPct.toFixed(2),
      opening_qty: String(openingQty),
      opening_value: openingValue === null ? "" : formatPaise(openingValue),
      attributes_json: JSON.stringify(item.attributes)
    });
  }

  const vouchers: VoucherRow[] = [];
  const settlements: SettlementRow[] = [];
  const channelCharges: ChannelChargeRow[] = [];
  const counters = new Map<string, number>();
  const nextNo = (prefix: string, day: number) => {
    const key = `${prefix}/${fyOf(day)}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return `${key}/${String(n).padStart(5, "0")}`;
  };

  const arrivals = new Map<number, Map<number, Map<number, number>>>(); // day -> supplier -> item -> qty
  const addArrival = (day: number, supplierIdx: number, itemIdx: number, qty: number) => {
    const bySupplier = arrivals.get(day) ?? new Map<number, Map<number, number>>();
    const byItem = bySupplier.get(supplierIdx) ?? new Map<number, number>();
    byItem.set(itemIdx, (byItem.get(itemIdx) ?? 0) + qty);
    bySupplier.set(supplierIdx, byItem);
    arrivals.set(day, bySupplier);
  };
  const bulkBuyDay = dayOf(plant.slowMovers.bulkBuyOn);
  const bulkRng = plantRng.fork("bulk");
  for (const item of slowMovers) {
    addArrival(bulkBuyDay, item.supplierIdx, item.idx, roundUp(bulkRng.int(plant.slowMovers.bulkQty[0], plant.slowMovers.bulkQty[1]), profile.inventory.caseSize));
  }
  // Short-dated bulk buys (batch profiles): the lot arrives with little shelf life left.
  const shortDatedLife = new Map<string, number>();
  if (plant.shortDated) {
    const day = dayOf(plant.shortDated.buyOn);
    for (const item of shortDatedItems) {
      addArrival(day, item.supplierIdx, item.idx, roundUp(bulkRng.int(plant.shortDated.qty[0], plant.shortDated.qty[1]), profile.inventory.caseSize));
      shortDatedLife.set(`${day}|${item.idx}`, bulkRng.int(plant.shortDated.lifeLeftDays[0], plant.shortDated.lifeLeftDays[1]));
    }
  }

  const salesReturnsDue = new Map<number, { invoice: SalesInvoice; line: SalesLine; qty: number }[]>();
  const purchaseReturnsDue = new Map<number, { invoice: PurchaseInvoice; line: PurchaseLine; qty: number }[]>();
  const receiptsDue = new Map<number, { invoice: SalesInvoice; partial: boolean }[]>();
  const supplierPaymentsDue = new Map<number, PurchaseInvoice[]>();
  const platformOpen = new Map<string, SalesInvoice[]>();
  const allSales: SalesInvoice[] = [];
  const allPurchases: PurchaseInvoice[] = [];
  const pushTo = <T>(map: Map<number, T[]>, day: number, value: T) => map.set(day, [...(map.get(day) ?? []), value]);

  const simRng = root.fork("simulate");
  const slowPayerRng = plantRng.fork("slow-payers");
  const slowPayerPool = customers.filter((c) => c.segment.id === plant.slowPayers.segment && !lapsingSet.has(c.idx));
  const slowPayers = new Map<number, number>();
  while (slowPayers.size < plant.slowPayers.count && slowPayerPool.length > 0) {
    const c = slowPayerPool.splice(slowPayerRng.int(0, slowPayerPool.length - 1), 1)[0];
    slowPayers.set(c.idx, slowPayerRng.int(plant.slowPayers.extraDelayDays[0], plant.slowPayers.extraDelayDays[1]));
  }
  const slowPayersFrom = dayOf(plant.slowPayers.from);

  const issue = (itemIdx: number, qty: number): number | null => {
    const value = stockValue[itemIdx];
    const cost = value === null ? null : Math.round((qty * value) / stockQty[itemIdx]);
    stockQty[itemIdx] -= qty;
    stockValue[itemIdx] = value === null || cost === null ? null : value - cost;
    if (stockQty[itemIdx] === 0) {
      stockValue[itemIdx] = 0;
    }
    return cost;
  };

  const voucherRow = (
    type: VoucherRow["voucher_type"],
    no: string,
    day: number,
    partyCode: string,
    channel: string,
    dueDay: number | null,
    original: string,
    line: { lineNo: number; itemIdx: number; qty: number; rate: number; discount: number; taxable: number; gstPct: number; tax: number; batch?: BatchLot; inclusive?: number }
  ): VoucherRow => ({
    voucher_type: type,
    voucher_no: no,
    date: isoOf(day),
    party_code: partyCode,
    channel,
    order_ref: "",
    due_date: dueDay === null ? "" : isoOf(dueDay),
    original_voucher_no: original,
    line_no: String(line.lineNo),
    item_code: items[line.itemIdx].code,
    qty: String(line.qty),
    rate: formatPaise(line.rate),
    discount_amount: formatPaise(line.discount),
    taxable_amount: formatPaise(line.taxable),
    gst_rate: line.gstPct.toFixed(2),
    tax_amount: formatPaise(line.tax),
    adjustment_incl_tax: "",
    ...(line.batch ? { batch_no: line.batch.no, expiry_date: isoOf(line.batch.expiryDay), mrp: formatPaise(line.batch.mrp) } : {}),
    // Billed at MRP: only the tax-inclusive total is stated; the importer backs GST out.
    ...(line.inclusive !== undefined ? { taxable_amount: "", tax_amount: "", amount_incl_tax: formatPaise(line.inclusive) } : {})
  });

  const lostDemand: Record<string, number> = {};
  const customerOrders: CustomerOrderRow[] = [];
  const poLineIndex = new Map<string, CustomerOrderRow>();
  const poUnits: Record<string, { ordered: number; supplied: number }> = {};
  const totalDemand: Record<string, number> = {};

  for (let day = 0; day < days; day += 1) {
    // 1. Purchase arrivals: one purchase invoice per supplier per day.
    const todaysArrivals = arrivals.get(day);
    if (todaysArrivals) {
      for (const supplierIdx of [...todaysArrivals.keys()].sort((a, b) => a - b)) {
        const supplier = suppliers[supplierIdx];
        const byItem = todaysArrivals.get(supplierIdx)!;
        const no = nextNo("PB", day);
        const lines: PurchaseLine[] = [];
        for (const itemIdx of [...byItem.keys()].sort((a, b) => a - b)) {
          const qty = byItem.get(itemIdx)!;
          const item = items[itemIdx];
          const rate = costFor(item, day);
          const gross = qty * rate;
          const discount = Math.round((gross * supplier.tradeDiscountPct) / 100);
          const taxable = gross - discount;
          const line: PurchaseLine = { lineNo: lines.length + 1, itemIdx, qty, rate, discount, taxable, gstPct: item.gstPct, tax: Math.round((taxable * item.gstPct) / 100) };
          if (batchCfg) {
            const life = shortDatedLife.get(`${day}|${itemIdx}`);
            line.batch = newLot(item, day, qty, life);
            if (life !== undefined) shortDatedLots.push(line.batch);
          }
          lines.push(line);
          stockQty[itemIdx] += qty;
          const value = stockValue[itemIdx];
          stockValue[itemIdx] = value === null ? null : value + taxable;
          onOrder[itemIdx] = Math.max(0, onOrder[itemIdx] - qty);
        }
        const total = lines.reduce((s, l) => s + l.taxable + l.tax, 0);
        const payDay = day + supplier.creditDays + Math.max(0, Math.round(simRng.normal(3, 4)));
        const invoice: PurchaseInvoice = { no, day, supplierIdx, lines, total, returned: 0, paid: 0, payDay };
        allPurchases.push(invoice);
        pushTo(supplierPaymentsDue, payDay, invoice);
        for (const line of lines) {
          vouchers.push(voucherRow("purchase_invoice", no, day, supplier.code, "", day + supplier.creditDays, "", line));
          if (simRng.chance(0.01)) {
            pushTo(purchaseReturnsDue, day + 3, { invoice, line, qty: Math.max(1, Math.round(line.qty * 0.05)) });
          }
        }
      }
    }

    // 2. Sales: fill each order line from stock; unfilled demand is lost.
    for (const intent of intentsByDay[day]) {
      const customer = customers[intent.customerIdx];
      const seg = customer.segment;
      const channel = channelById.get(seg.channel)!;
      const lines: SalesLine[] = [];
      const poNo = channel.customerPurchaseOrders ? nextNo(`PO-${seg.channel.toUpperCase()}`, day) : null;
      for (const want of intent.lines) {
        totalDemand[seg.channel] = (totalDemand[seg.channel] ?? 0) + want.qty;
        const qty = Math.min(want.qty, sellable(want.itemIdx, day));
        lostDemand[seg.channel] = (lostDemand[seg.channel] ?? 0) + (want.qty - qty);
        if (poNo) {
          // The platform's PO asks for what it wants; the shortfall shows up as fill rate below 100%.
          const units = (poUnits[seg.channel] ??= { ordered: 0, supplied: 0 });
          const existing = poLineIndex.get(`${poNo}|${want.itemIdx}`);
          if (existing) {
            existing.qty_ordered = String(Number(existing.qty_ordered) + want.qty);
            existing.qty_supplied = String(Number(existing.qty_supplied) + Math.max(qty, 0));
          } else {
            const row: CustomerOrderRow = {
              channel: seg.channel,
              po_number: poNo,
              po_date: isoOf(day),
              party_code: customer.code,
              item_code: items[want.itemIdx].code,
              qty_ordered: String(want.qty),
              qty_supplied: String(Math.max(qty, 0)),
              unit_price: formatPaise(priceFor(items[want.itemIdx], day, seg.priceTier)),
              grn_date: qty > 0 ? isoOf(day) : ""
            };
            customerOrders.push(row);
            poLineIndex.set(`${poNo}|${want.itemIdx}`, row);
          }
          units.ordered += want.qty;
          units.supplied += Math.max(qty, 0);
        }
        if (qty <= 0) {
          continue;
        }
        const item = items[want.itemIdx];
        const rate = priceFor(item, day, seg.priceTier);
        const extra = item.group === erosion.group && seg.id === erosion.discountSegment && day >= erosionDiscountFrom ? erosion.extraDiscountPct : 0;
        // Batch profiles split the line by batch, earliest expiry first.
        for (const part of batchCfg ? takeFefo(want.itemIdx, qty, day) : [{ qty, lot: undefined }]) {
          const pct = customer.discountPct + extra;
          if (part.lot && profile.retailPricesIncludeTax && seg.priceTier === "retail") {
            // Billed at MRP (tax-inclusive), with the customer's discount off MRP.
            const inclusive = Math.round((part.qty * part.lot.mrp * (100 - pct)) / 100);
            const taxable = backOutTax(inclusive, item.gstPct);
            const gross = backOutTax(part.qty * part.lot.mrp, item.gstPct);
            const cost = issue(want.itemIdx, part.qty);
            lines.push({ lineNo: lines.length + 1, itemIdx: want.itemIdx, qty: part.qty, rate: part.lot.mrp, discount: gross - taxable, taxable, gstPct: item.gstPct, tax: inclusive - taxable, cost, batch: part.lot, inclusive });
            continue;
          }
          const discount = Math.round((part.qty * rate * pct) / 100);
          const taxable = part.qty * rate - discount;
          const cost = issue(want.itemIdx, part.qty);
          lines.push({ lineNo: lines.length + 1, itemIdx: want.itemIdx, qty: part.qty, rate, discount, taxable, gstPct: item.gstPct, tax: Math.round((taxable * item.gstPct) / 100), cost, ...(part.lot ? { batch: part.lot } : {}) });
        }
      }
      if (lines.length === 0) {
        continue;
      }

      const no = nextNo(seg.billing === "platform" || seg.billing === "prepaid" ? `SO-${seg.channel.toUpperCase()}` : "SI", day);
      const total = lines.reduce((s, l) => s + l.taxable + l.tax, 0);
      const dueDay = seg.billing === "credit" ? day + seg.creditDays : null;
      // Payment days are drawn up front so that returns can be scheduled before them.
      const receiptPlan: { day: number; partial: boolean }[] = [];
      if (seg.billing === "credit") {
        const extra = slowPayers.has(customer.idx) && day >= slowPayersFrom ? slowPayers.get(customer.idx)! : 0;
        const payDay = Math.max(day + 7, day + seg.creditDays + Math.round(simRng.normal(customer.payDelayMean + extra, 6)));
        const partialDay = Math.max(day + 7, payDay - 10);
        if (simRng.chance(0.1) && partialDay < payDay) {
          receiptPlan.push({ day: partialDay, partial: true });
        }
        receiptPlan.push({ day: payDay, partial: false });
      } else if (seg.billing === "cash" || seg.billing === "prepaid") {
        receiptPlan.push({ day, partial: false });
      }
      const firstPayDay =
        seg.billing === "platform"
          ? day + channel.payout!.deliveryDays + channel.payout!.returnWindowDays + channel.payout!.cycleDays
          : receiptPlan[0].day;

      const invoice: SalesInvoice = {
        no,
        day,
        customerIdx: customer.idx,
        channel: seg.channel,
        lines,
        total,
        credited: 0,
        creditedTaxable: 0,
        paid: 0,
        dueDay,
        firstPayDay,
        returnedQtyByLine: new Map(),
        returnedCostByLine: new Map(),
        returnedTaxableByLine: new Map(),
        hadReturn: false
      };
      allSales.push(invoice);
      for (const plan of receiptPlan) {
        pushTo(receiptsDue, plan.day, { invoice, partial: plan.partial });
      }
      if (seg.billing === "platform") {
        platformOpen.set(seg.channel, [...(platformOpen.get(seg.channel) ?? []), invoice]);
      }
      if (seg.billing === "prepaid") {
        // Payment-gateway charges are deducted from the same-day payment.
        for (const charge of computeCharges(channel, invoice)) {
          channelCharges.push({
            channel: channel.id,
            settlement_ref: `GW-${isoOf(day)}`,
            settlement_date: isoOf(day),
            order_voucher_no: invoice.no,
            charge_type: charge.chargeType,
            amount: formatPaise(charge.amount),
            gst_amount: formatPaise(charge.gst)
          });
        }
      }

      for (const line of lines) {
        const row = voucherRow("sales_invoice", no, day, customer.code, seg.channel, dueDay, "", line);
        row.order_ref = seg.billing === "platform" ? `${seg.channel.toUpperCase()}-${no.split("/").pop()}-${fyOf(day)}` : (poNo ?? "");
        vouchers.push(row);
        if (line.cost !== null && seg.returnRate > 0 && simRng.chance(seg.returnRate)) {
          const returnDay =
            seg.billing === "platform"
              ? day + channel.payout!.deliveryDays + simRng.int(1, channel.payout!.returnWindowDays)
              : day + simRng.int(3, 20);
          if (returnDay < invoice.firstPayDay && returnDay < days) {
            const qty = seg.billing === "platform" ? line.qty : Math.max(1, Math.round(line.qty * simRng.float(0.1, 0.3)));
            pushTo(salesReturnsDue, returnDay, { invoice, line, qty });
          }
        }
      }
    }

    // 3. Sales returns (credit notes) restore stock at the original line's cost.
    for (const ret of salesReturnsDue.get(day) ?? []) {
      const { invoice, line, qty } = ret;
      const customer = customers[invoice.customerIdx];
      const cost = Math.round((line.cost! * qty) / line.qty);
      // A line billed at MRP is credited the same way (tax-inclusive), back into its batch.
      const inclusive = line.inclusive !== undefined ? Math.round((line.inclusive * qty) / line.qty) : undefined;
      const taxable = inclusive !== undefined ? backOutTax(inclusive, line.gstPct) : Math.round((line.taxable * qty) / line.qty);
      const tax = inclusive !== undefined ? inclusive - taxable : Math.round((taxable * line.gstPct) / 100);
      const discount = inclusive !== undefined ? backOutTax(qty * line.rate, line.gstPct) - taxable : qty * line.rate - taxable;
      const no = nextNo("CN", day);
      vouchers.push(
        voucherRow("sales_return", no, day, customer.code, invoice.channel, null, invoice.no, {
          lineNo: 1,
          itemIdx: line.itemIdx,
          qty,
          rate: line.rate,
          discount,
          taxable,
          gstPct: line.gstPct,
          tax,
          ...(line.batch ? { batch: line.batch } : {}),
          ...(inclusive !== undefined ? { inclusive } : {})
        })
      );
      if (line.batch) line.batch.qty += qty;
      stockQty[line.itemIdx] += qty;
      const value = stockValue[line.itemIdx];
      stockValue[line.itemIdx] = value === null ? null : value + cost;
      invoice.credited += taxable + tax;
      invoice.creditedTaxable += taxable;
      invoice.hadReturn = true;
      invoice.returnedQtyByLine.set(line.lineNo, (invoice.returnedQtyByLine.get(line.lineNo) ?? 0) + qty);
      invoice.returnedCostByLine.set(line.lineNo, (invoice.returnedCostByLine.get(line.lineNo) ?? 0) + cost);
      invoice.returnedTaxableByLine.set(line.lineNo, (invoice.returnedTaxableByLine.get(line.lineNo) ?? 0) + taxable);
    }

    // 4. Purchase returns leave at their invoiced value, only while stock and the bill allow.
    for (const ret of purchaseReturnsDue.get(day) ?? []) {
      const { invoice, line, qty } = ret;
      const taxable = Math.round((line.taxable * qty) / line.qty);
      const value = stockValue[line.itemIdx];
      if (stockQty[line.itemIdx] < qty || invoice.payDay <= day || (value !== null && value < taxable) || (line.batch && line.batch.qty < qty)) {
        continue;
      }
      if (line.batch) line.batch.qty -= qty;
      const tax = Math.round((taxable * line.gstPct) / 100);
      const no = nextNo("DN", day);
      vouchers.push(
        voucherRow("purchase_return", no, day, suppliers[invoice.supplierIdx].code, "", null, invoice.no, {
          lineNo: 1,
          itemIdx: line.itemIdx,
          qty,
          rate: line.rate,
          discount: qty * line.rate - taxable,
          taxable,
          gstPct: line.gstPct,
          tax,
          ...(line.batch ? { batch: line.batch } : {})
        })
      );
      stockQty[line.itemIdx] -= qty;
      stockValue[line.itemIdx] = value === null ? null : value - taxable;
      if (stockQty[line.itemIdx] === 0) {
        stockValue[line.itemIdx] = 0;
      }
      invoice.returned += taxable + tax;
    }

    // 5a. Customer receipts, grouped per party per day into one receipt voucher.
    const receiptsToday = new Map<number, { invoice: SalesInvoice; amount: number }[]>();
    for (const due of receiptsDue.get(day) ?? []) {
      const pending = due.invoice.total - due.invoice.credited - due.invoice.paid;
      const amount = due.partial ? Math.round(pending / 2) : pending;
      if (amount <= 0) {
        continue;
      }
      due.invoice.paid += amount;
      const list = receiptsToday.get(due.invoice.customerIdx) ?? [];
      list.push({ invoice: due.invoice, amount });
      receiptsToday.set(due.invoice.customerIdx, list);
    }
    for (const customerIdx of [...receiptsToday.keys()].sort((a, b) => a - b)) {
      const no = nextNo("RC", day);
      for (const { invoice, amount } of receiptsToday.get(customerIdx)!) {
        settlements.push({ voucher_type: "receipt", voucher_no: no, date: isoOf(day), party_code: customers[customerIdx].code, against_voucher_no: invoice.no, amount: formatPaise(amount) });
      }
    }

    // 5b. Platform payouts: settle orders past the return window, deduct channel charges.
    for (const channel of profile.channels) {
      if (!channel.payout || day % channel.payout.cycleDays !== channel.payout.cycleDays - 1) {
        continue;
      }
      const open = platformOpen.get(channel.id) ?? [];
      const cutoff = day - channel.payout.deliveryDays - channel.payout.returnWindowDays;
      const settle = open.filter((inv) => inv.day <= cutoff);
      if (settle.length === 0) {
        continue;
      }
      platformOpen.set(channel.id, open.filter((inv) => inv.day > cutoff));
      const settlementRef = nextNo(`STL-${channel.id.toUpperCase()}`, day);
      const receiptNo = nextNo("RC", day);
      let tdsBase = 0;
      for (const invoice of settle) {
        tdsBase += Math.max(0, invoice.total - invoice.credited);
        const amount = invoice.total - invoice.credited - invoice.paid;
        if (amount > 0) {
          invoice.paid += amount;
          settlements.push({ voucher_type: "receipt", voucher_no: receiptNo, date: isoOf(day), party_code: customers[invoice.customerIdx].code, against_voucher_no: invoice.no, amount: formatPaise(amount) });
        }
        for (const charge of computeCharges(channel, invoice)) {
          channelCharges.push({
            channel: channel.id,
            settlement_ref: settlementRef,
            settlement_date: isoOf(day),
            order_voucher_no: invoice.no,
            charge_type: charge.chargeType,
            amount: formatPaise(charge.amount),
            gst_amount: formatPaise(charge.gst)
          });
        }
      }
      // Income-tax TDS is withheld per settlement period, not per order (as Amazon reports it).
      const tds = channel.taxWithheld ? Math.round((tdsBase * channel.taxWithheld.tdsPct) / 100) : 0;
      if (tds > 0) {
        channelCharges.push({
          channel: channel.id,
          settlement_ref: settlementRef,
          settlement_date: isoOf(day),
          order_voucher_no: "",
          charge_type: "tds_income_tax",
          amount: formatPaise(tds),
          gst_amount: "0.00"
        });
      }
    }

    // 5c. Supplier payments.
    const paymentsToday = new Map<number, { invoice: PurchaseInvoice; amount: number }[]>();
    for (const invoice of supplierPaymentsDue.get(day) ?? []) {
      const amount = invoice.total - invoice.returned - invoice.paid;
      if (amount <= 0) continue;
      invoice.paid += amount;
      paymentsToday.set(invoice.supplierIdx, [...(paymentsToday.get(invoice.supplierIdx) ?? []), { invoice, amount }]);
    }
    for (const supplierIdx of [...paymentsToday.keys()].sort((a, b) => a - b)) {
      const no = nextNo("PY", day);
      for (const { invoice, amount } of paymentsToday.get(supplierIdx)!) {
        settlements.push({ voucher_type: "payment", voucher_no: no, date: isoOf(day), party_code: suppliers[supplierIdx].code, against_voucher_no: invoice.no, amount: formatPaise(amount) });
      }
    }

    // 6. Weekly reorder review on trailing 28-day demand.
    if (day % 7 === 0) {
      for (const item of items) {
        const avg = avgDailyDemand(item.idx, day - 27, day + 1);
        if (avg <= 0) continue;
        const supplier = suppliers[item.supplierIdx];
        const isStockout = stockoutSet.has(item.idx);
        const safety = isStockout ? plant.stockoutItems.reorderSafety : profile.inventory.reorderSafety;
        const cover = isStockout ? plant.stockoutItems.coverDays : profile.inventory.coverDays;
        const reorderPoint = avg * (supplier.leadDays + 7) * safety;
        // Expired lots are still on hand but cannot be sold, so they do not count as cover.
        const usable = sellable(item.idx, day);
        if (usable + onOrder[item.idx] > reorderPoint) continue;
        const qty = roundUp(avg * (supplier.leadDays + 7 + cover) - usable - onOrder[item.idx], profile.inventory.caseSize);
        if (qty <= 0) continue;
        const arrival = day + supplier.leadDays + simRng.int(0, 2);
        if (arrival >= days) continue;
        onOrder[item.idx] += qty;
        addArrival(arrival, item.supplierIdx, item.idx, qty);
      }
    }
  }

  // ── Outputs ──────────────────────────────────────────────────────────────
  const asOf = isoOf(days - 1);
  const stockSummary: StockSummaryRow[] = items.map((item) => ({
    item_code: item.code,
    as_of: asOf,
    qty: String(stockQty[item.idx]),
    value: stockValue[item.idx] === null ? "" : formatPaise(stockValue[item.idx]!),
    valuation_method: "weighted_average"
  }));

  const outstanding: OutstandingRow[] = [];
  for (const invoice of allSales) {
    const pending = invoice.total - invoice.credited - invoice.paid;
    if (pending > 0) {
      outstanding.push({
        party_code: customers[invoice.customerIdx].code,
        side: "receivable",
        bill_ref: invoice.no,
        bill_date: isoOf(invoice.day),
        due_date: invoice.dueDay === null ? "" : isoOf(invoice.dueDay),
        amount_incl_tax: formatPaise(invoice.total),
        pending_incl_tax: formatPaise(pending),
        as_of: asOf
      });
    }
  }
  for (const invoice of allPurchases) {
    const pending = invoice.total - invoice.returned - invoice.paid;
    if (pending > 0) {
      outstanding.push({
        party_code: suppliers[invoice.supplierIdx].code,
        side: "payable",
        bill_ref: invoice.no,
        bill_date: isoOf(invoice.day),
        due_date: isoOf(invoice.day + suppliers[invoice.supplierIdx].creditDays),
        amount_incl_tax: formatPaise(invoice.total),
        pending_incl_tax: formatPaise(pending),
        as_of: asOf
      });
    }
  }

  const parties: PartyRow[] = [
    ...customers.map((c) => ({
      party_code: c.code,
      name: c.segment.name(Number(c.code.split("-").pop()), c.city.name),
      party_type: "customer",
      segment: c.segment.id,
      city: c.city.name,
      state_code: c.city.stateCode,
      gstin: "",
      credit_days: c.segment.billing === "credit" ? String(c.segment.creditDays) : "0",
      phone: c.segment.hasContact ? `+91 00000 ${String(10000 + c.idx).slice(-5)}` : "",
      email: c.segment.hasContact ? `${c.code.toLowerCase()}@example.com` : "",
      buyer_identity: c.segment.anonymousBuyers ? "anonymous" : "named"
    })),
    ...suppliers.map((s) => ({
      party_code: s.code,
      name: s.name,
      party_type: "supplier",
      segment: "supplier",
      city: profile.cities[s.idx % profile.cities.length].name,
      state_code: profile.cities[s.idx % profile.cities.length].stateCode,
      gstin: "",
      credit_days: String(s.creditDays),
      phone: "",
      email: "",
      buyer_identity: "named"
    }))
  ];

  const groundTruth = buildGroundTruth();

  return {
    meta: {
      company: profile.company,
      packId: profile.packId,
      seed,
      generatorVersion: GENERATOR_VERSION,
      isDemo: true,
      periodFrom: profile.start,
      periodTo: profile.end,
      notice:
        "SYNTHETIC DEMO DATA. The business, parties, items, prices, fees and outcomes are fictional and generated by code. Fee and tax percentages are illustrative assumptions."
    },
    items: itemRows,
    parties,
    vouchers,
    settlements,
    stockSummary,
    outstanding,
    channelCharges,
    customerOrders,
    batches: batchRows,
    controlTotals: buildControlTotals(vouchers, settlements, channelCharges, profile.start, profile.end),
    groundTruth
  };

  function buildGroundTruth(): GroundTruth {
    const byFinancialYear: GroundTruth["byFinancialYear"] = {};
    const fy = (day: number) => (byFinancialYear[fyOf(day)] ??= { netSales: 0, netSalesKnownCost: 0, cogsKnownCost: 0, salesReturns: 0, discounts: 0 });
    const contribution = new Map<string, { channel: string; itemCode: string; netSales: number; cogs: number; charges: number }>();
    const chargesByInvoice = new Map<string, number>();
    for (const charge of channelCharges) {
      if ((TAX_WITHHELD_CHARGE_TYPES as readonly string[]).includes(charge.charge_type)) continue;
      chargesByInvoice.set(charge.order_voucher_no, (chargesByInvoice.get(charge.order_voucher_no) ?? 0) + parseAmount(charge.amount));
    }

    for (const invoice of allSales) {
      const invoiceTaxable = invoice.lines.reduce((s, l) => s + l.taxable, 0);
      const invoiceCharges = chargesByInvoice.get(invoice.no) ?? 0;
      for (const line of invoice.lines) {
        const returnedTaxable = invoice.returnedTaxableByLine.get(line.lineNo) ?? 0;
        const returnedCost = invoice.returnedCostByLine.get(line.lineNo) ?? 0;
        const bucket = fy(invoice.day);
        bucket.netSales += line.taxable;
        bucket.discounts += line.discount;
        if (line.cost !== null) {
          bucket.netSalesKnownCost += line.taxable;
          bucket.cogsKnownCost += line.cost;
        }

        const key = `${invoice.channel}|${line.itemIdx}`;
        const entry = contribution.get(key) ?? { channel: invoice.channel, itemCode: items[line.itemIdx].code, netSales: 0, cogs: 0, charges: 0 };
        if (line.cost !== null) {
          entry.netSales += line.taxable - returnedTaxable;
          entry.cogs += line.cost - returnedCost;
          entry.charges += invoiceTaxable === 0 ? 0 : Math.round((invoiceCharges * line.taxable) / invoiceTaxable);
        }
        contribution.set(key, entry);
      }
    }
    for (const row of vouchers) {
      if (row.voucher_type !== "sales_return") continue;
      const bucket = fy(dayOf(row.date));
      const taxable = rowTaxable(row);
      bucket.netSales -= taxable;
      bucket.salesReturns += taxable;
      bucket.netSalesKnownCost -= taxable;
    }
    // Returns count in the financial year of their credit note (KPI dictionary), and the
    // returned cost goes back into stock, reducing COGS in that year.
    const returnCostByDay = new Map<number, number>();
    for (const [day, list] of salesReturnsDue) {
      for (const ret of list) {
        if (ret.line.cost === null) continue;
        returnCostByDay.set(day, (returnCostByDay.get(day) ?? 0) + Math.round((ret.line.cost * ret.qty) / ret.line.qty));
      }
    }
    for (const [day, cost] of returnCostByDay) {
      if (day < days) fy(day).cogsKnownCost -= cost;
    }

    return {
      planted: {
        slowMovers: slowMovers.map((i) => ({ itemCode: i.code, stopSellingFrom: plant.slowMovers.stopSellingFrom, bulkBuyOn: plant.slowMovers.bulkBuyOn })),
        lapsingKeyCustomers: lapsing.map((c) => ({ partyCode: c.code, stopFrom: plant.lapsingKeyCustomers.stopFrom, ordersBefore: lapsingOrdersBefore.get(c.idx) ?? 0 })),
        schoolsNotReordering: schoolsNotReordering.map((c) => ({ partyCode: c.code, stopFrom: plant.schoolsNotReordering.stopFrom })),
        marginErosion: { group: erosion.group, costIncreasePct: erosion.costIncreasePct, from: erosion.from, extraDiscountPct: erosion.extraDiscountPct, discountFrom: erosion.discountFrom },
        slowPayers: [...slowPayers.entries()].map(([idx, extra]) => ({ partyCode: customers[idx].code, from: plant.slowPayers.from, extraDelayDays: extra })),
        stockoutItems: stockoutItems.map((i) => ({ itemCode: i.code })),
        missingOpeningValue: missingOpening.map((i) => ({ itemCode: i.code })),
        shortDated: shortDatedLots.map((l) => ({ itemCode: items[l.itemIdx].code, batchNo: l.no, expiryDate: isoOf(l.expiryDay) })),
        expiredOpening: expiredOpeningLots.map((l) => ({ itemCode: items[l.itemIdx].code, batchNo: l.no, expiryDate: isoOf(l.expiryDay) }))
      },
      batchesOnHand: lots
        .flat()
        .filter((l) => l.qty > 0)
        .map((l) => ({ itemCode: items[l.itemIdx].code, batchNo: l.no, expiryDate: isoOf(l.expiryDay), qty: l.qty }))
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.batchNo.localeCompare(b.batchNo)),
      byFinancialYear,
      contributionByChannelItem: [...contribution.values()]
        .map((e) => ({ ...e, contribution: e.netSales - e.cogs - e.charges }))
        .sort((a, b) => a.channel.localeCompare(b.channel) || a.itemCode.localeCompare(b.itemCode)),
      lostDemandQtyByChannel: lostDemand,
      purchaseOrderUnitsByChannel: poUnits,
      demandQtyByChannel: totalDemand
    };
  }
}

function computeCharges(channel: ChannelSpec, invoice: SalesInvoice): { chargeType: string; amount: number; gst: number }[] {
  const keptUnits = invoice.lines.reduce((s, l) => s + l.qty - (invoice.returnedQtyByLine.get(l.lineNo) ?? 0), 0);
  const fullyReturned = keptUnits === 0;
  const orderValue = invoice.total - invoice.credited;
  const out: { chargeType: string; amount: number; gst: number }[] = [];
  const apply = (rule: ChargeRule) => {
    const amount =
      rule.basis === "pct_of_order"
        ? Math.round((orderValue * rule.value) / 100)
        : rule.basis === "per_unit"
          ? rule.value * keptUnits
          : rule.value;
    if (amount > 0) {
      out.push({ chargeType: rule.chargeType, amount, gst: Math.round((amount * rule.gstPct) / 100) });
    }
  };
  for (const rule of channel.orderCharges) {
    // Shipping is incurred even when the order comes back; value-based fees are not.
    if (fullyReturned && rule.basis !== "per_order") continue;
    apply(rule);
  }
  if (invoice.hadReturn) {
    channel.returnCharges.forEach(apply);
  }
  if (channel.taxWithheld && !fullyReturned) {
    const taxable = invoice.lines.reduce((s, l) => s + l.taxable, 0) - invoice.creditedTaxable;
    const tcs = Math.round((taxable * channel.taxWithheld.tcsPct) / 100);
    if (tcs > 0) out.push({ chargeType: "tcs_gst", amount: tcs, gst: 0 });
  }
  return out;
}

function buildControlTotals(
  vouchers: VoucherRow[],
  settlements: SettlementRow[],
  charges: ChannelChargeRow[],
  periodFrom: string,
  periodTo: string
): ControlTotalRow[] {
  const sum = (rows: { [k: string]: string }[], field: string) => rows.reduce((s, r) => s + parseAmount(r[field]), 0);
  const ofType = (type: string) => vouchers.filter((v) => v.voucher_type === type);
  const lines = (type: string, f: (r: VoucherRow) => number) => ofType(type).reduce((s, r) => s + f(r), 0);
  const totals: [string, number][] = [
    ["sales_taxable", lines("sales_invoice", rowTaxable)],
    ["sales_tax", lines("sales_invoice", rowTax)],
    ["sales_return_taxable", lines("sales_return", rowTaxable)],
    ["purchase_taxable", lines("purchase_invoice", rowTaxable)],
    ["purchase_return_taxable", lines("purchase_return", rowTaxable)],
    ["receipts", sum(settlements.filter((s) => s.voucher_type === "receipt"), "amount")],
    ["payments", sum(settlements.filter((s) => s.voucher_type === "payment"), "amount")],
    ["channel_charges", sum(charges, "amount")]
  ];
  return totals.map(([metric, value]) => ({ metric, period_from: periodFrom, period_to: periodTo, value: formatPaise(value) }));
}

/**
 * Taxable value inside a tax-inclusive amount, in paise, rounded half up exactly as the importer
 * does with decimals: round(inclusive x 100 / (100 + GST%)).
 */
export function backOutTax(inclusivePaise: number, gstPct: number): number {
  const g = Math.round(gstPct * 100);
  const num = inclusivePaise * 10_000;
  const den = 10_000 + g;
  return Math.floor((2 * num + den) / (2 * den));
}

const isInclusive = (r: VoucherRow) => r.taxable_amount === "" && r.tax_amount === "" && !!r.amount_incl_tax;
function rowTaxable(r: VoucherRow): number {
  return isInclusive(r) ? backOutTax(parseAmount(r.amount_incl_tax!), Number(r.gst_rate)) : parseAmount(r.taxable_amount);
}
function rowTax(r: VoucherRow): number {
  return isInclusive(r) ? parseAmount(r.amount_incl_tax!) - rowTaxable(r) : parseAmount(r.tax_amount);
}

function parseAmount(value: string): number {
  const [whole, fraction = "0"] = value.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, "0")));
}

function roundUp(value: number, step: number): number {
  return value <= 0 ? 0 : Math.ceil(value / step) * step;
}

/** Month (1-12) -> names of the domain pack's seasons that include it. */
function buildSeasonLookup(profile: DemoProfile): Map<number, string[]> {
  const lookup = new Map<number, string[]>();
  for (const season of getDomainPack(profile.packId).seasonality) {
    for (const month of season.months) {
      lookup.set(month, [...(lookup.get(month) ?? []), season.name]);
    }
  }
  return lookup;
}

function seasonFactor(seg: SegmentSpec, seasons: string[]): number {
  const boosted = seasons.filter((s) => seg.seasonBoost[s] !== undefined);
  if (boosted.length === 0) {
    return seg.offSeasonFactor;
  }
  return boosted.reduce((f, s) => f * seg.seasonBoost[s], 1);
}

function buildSuppliers(profile: DemoProfile, rng: Rng): Supplier[] {
  return Array.from({ length: profile.suppliers.count }, (_, idx) => {
    const code = `SUP-${String(idx + 1).padStart(3, "0")}`;
    return {
      idx,
      code,
      name: `Demo Supplier ${String(idx + 1).padStart(2, "0")}`,
      leadDays: rng.int(profile.suppliers.leadDays[0], profile.suppliers.leadDays[1]),
      creditDays: rng.pick(profile.suppliers.creditDays),
      tradeDiscountPct: Math.round(rng.float(profile.suppliers.tradeDiscountPct[0], profile.suppliers.tradeDiscountPct[1]) * 2) / 2
    };
  });
}

function buildItems(profile: DemoProfile, rng: Rng, supplierCount: number): Item[] {
  const items: Item[] = [];
  profile.groups.forEach((group, groupIdx) => {
    const groupRng = rng.fork(group.name);
    // Each group is served by 2-3 suppliers.
    const groupSuppliers = [groupIdx % supplierCount, (groupIdx + 7) % supplierCount, (groupIdx + 13) % supplierCount].slice(0, groupRng.int(2, 3));
    for (let i = 0; i < group.count; i += 1) {
      const noun = group.nouns[i % group.nouns.length];
      const variant = group.variants[Math.floor(i / group.nouns.length) % group.variants.length];
      const brand = groupRng.pick(profile.brands);
      items.push({
        idx: items.length,
        code: `${group.codePrefix}-${String(i + 1).padStart(3, "0")}`,
        name: `${brand} ${noun} ${variant}`.trim(),
        group: group.name,
        hsnCode: group.hsnCode,
        gstPct: group.gstPct,
        baseCost: Math.round(groupRng.logUniform(group.costPaise[0], group.costPaise[1])),
        markup: groupRng.float(group.markup[0], group.markup[1]),
        popularity: 1 / (groupRng.int(1, group.count) ** 0.9),
        supplierIdx: groupRng.pick(groupSuppliers),
        attributes: group.attributes ? { ...group.attributes } : { brand, segment: group.segmentTag }
      });
    }
  });
  const codes = new Set(items.map((item) => item.code));
  if (codes.size !== items.length) {
    throw new Error("Demo profile produces duplicate item codes; check group codePrefix values");
  }
  return items;
}

function buildCustomers(profile: DemoProfile, rng: Rng): Customer[] {
  const customers: Customer[] = [];
  for (const seg of profile.segments) {
    const segRng = rng.fork(seg.id);
    for (let n = 1; n <= seg.count; n += 1) {
      customers.push({
        idx: customers.length,
        code: `${seg.codePrefix}-${String(n).padStart(seg.count >= 1000 ? 4 : 3, "0")}`,
        segment: seg,
        ordersPerWeek: segRng.float(seg.ordersPerWeek[0], seg.ordersPerWeek[1]),
        sizeFactor: Math.exp(segRng.normal(0, seg.sizeSigma)),
        discountPct: Math.round(segRng.float(seg.discountPct[0], seg.discountPct[1]) * 2) / 2,
        payDelayMean: segRng.float(seg.payDelayMean[0], seg.payDelayMean[1]),
        city: segRng.pick(profile.cities)
      });
    }
  }
  return customers;
}
