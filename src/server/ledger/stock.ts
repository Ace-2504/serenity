import { randomUUID } from "node:crypto";
import { Prisma, type CostBasis, type VoucherType } from "@prisma/client";
import { bulkInsert, bulkUpdate } from "@/server/db/bulk";

/**
 * Perpetual stock ledger at weighted-average cost (WAC), rebuilt from the tenant's active vouchers.
 *
 * Order: date, then opening stock -> purchases -> sales -> sales returns -> purchase returns,
 * then the source's posting order. Costing rules (docs/platform/04-kpi-dictionary.md):
 *   - purchases add their taxable value (landed cost excluding recoverable GST);
 *   - an issue of q units costs round(q x value / qtyOnHand) and reduces the pool by that amount;
 *   - when stock reaches zero the pool value resets to zero;
 *   - sales returns come back at the original sale line's unit cost (else current WAC, flagged);
 *   - purchase returns leave at their invoiced value;
 *   - an item whose opening value is unknown has unknown cost until its stock reaches zero.
 * Sources that allow negative stock (Tally does) are costed at the last known unit cost and counted.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type RawTx = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

type LedgerLine = {
  id: string;
  itemId: string;
  batchId: string | null;
  qty: Decimal;
  taxableAmount: Decimal;
  costAmount: Decimal | null;
  type: VoucherType;
  date: Date;
  voucherId: string;
  originalVoucherId: string | null;
};

export type LedgerSummary = {
  items: number;
  movements: number;
  costedLines: number;
  unknownCostLines: number;
  negativeStockEvents: number;
  returnsAtCurrentCost: number;
  durationMs: number;
};

const RANK: Partial<Record<VoucherType, number>> = { opening_stock: 0, purchase_invoice: 1, sales_invoice: 2, sales_return: 3, purchase_return: 4 };

export async function rebuildStockLedger(tx: RawTx, tenantId: string): Promise<LedgerSummary> {
  const started = Date.now();
  const lines = await tx.$queryRaw<LedgerLine[]>`
    SELECT l."id", l."itemId", l."batchId", l."qty", l."taxableAmount", l."costAmount", v."type", v."date", v."id" AS "voucherId", v."originalVoucherId"
    FROM "VoucherLine" l
    JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
    WHERE l."tenantId" = ${tenantId} AND v."status" = 'active'
      AND v."type" IN ('opening_stock', 'purchase_invoice', 'sales_invoice', 'sales_return', 'purchase_return')
    ORDER BY v."date",
      CASE v."type" WHEN 'opening_stock' THEN 0 WHEN 'purchase_invoice' THEN 1 WHEN 'sales_invoice' THEN 2 WHEN 'sales_return' THEN 3 ELSE 4 END,
      v."postingSeq" NULLS LAST, v."number", l."lineNo"`;

  type State = { qty: Decimal; value: Decimal | null; lastUnitCost: Decimal | null; seq: number };
  const state = new Map<string, State>();
  const saleCost = new Map<string, { cost: Decimal | null; qty: Decimal }>();
  const movements: Record<string, unknown>[] = [];
  const costUpdates: { id: string; costAmount: Decimal | null; costBasis: CostBasis }[] = [];
  const summary = { unknownCostLines: 0, negativeStockEvents: 0, returnsAtCurrentCost: 0 };
  const zero = new D(0);
  const round2 = (d: Decimal) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

  for (const line of lines) {
    if (RANK[line.type] === undefined) continue;
    const s = state.get(line.itemId) ?? { qty: zero, value: zero, lastUnitCost: null, seq: 0 };
    const q = new D(line.qty);
    let qtyIn = zero;
    let qtyOut = zero;
    let valueIn: Decimal | null = null;
    let valueOut: Decimal | null = null;

    switch (line.type) {
      case "opening_stock": {
        qtyIn = q;
        valueIn = line.costAmount === null ? null : new D(line.costAmount);
        s.value = s.value === null || valueIn === null ? null : s.value.add(valueIn);
        break;
      }
      case "purchase_invoice": {
        qtyIn = q;
        valueIn = new D(line.taxableAmount);
        s.value = s.value === null ? null : s.value.add(valueIn);
        if (q.gt(0)) s.lastUnitCost = valueIn.div(q);
        break;
      }
      case "sales_invoice": {
        qtyOut = q;
        let cost: Decimal | null = null;
        if (s.value !== null) {
          if (s.qty.gte(q) && s.qty.gt(0)) {
            cost = round2(q.mul(s.value).div(s.qty));
          } else {
            summary.negativeStockEvents += 1;
            const unit = s.qty.gt(0) ? s.value.div(s.qty) : s.lastUnitCost;
            cost = unit === null ? null : round2(q.mul(unit));
          }
        }
        valueOut = cost;
        if (s.value !== null) s.value = cost === null ? null : s.value.sub(cost);
        saleCost.set(`${line.voucherId}|${line.itemId}`, { cost, qty: q });
        costUpdates.push({ id: line.id, costAmount: cost, costBasis: cost === null ? "unknown" : "derived_wac" });
        if (cost === null) summary.unknownCostLines += 1;
        break;
      }
      case "sales_return": {
        qtyIn = q;
        const original = line.originalVoucherId ? saleCost.get(`${line.originalVoucherId}|${line.itemId}`) : undefined;
        let cost: Decimal | null;
        if (original && original.cost !== null) {
          cost = round2(original.cost.mul(q).div(original.qty));
        } else {
          summary.returnsAtCurrentCost += 1;
          const unit = s.value !== null && s.qty.gt(0) ? s.value.div(s.qty) : s.lastUnitCost;
          cost = s.value === null || unit === null ? null : round2(q.mul(unit));
        }
        valueIn = cost;
        if (s.value !== null) s.value = cost === null ? s.value : s.value.add(cost);
        costUpdates.push({ id: line.id, costAmount: cost, costBasis: cost === null ? "unknown" : "derived_wac" });
        if (cost === null) summary.unknownCostLines += 1;
        break;
      }
      case "purchase_return": {
        qtyOut = q;
        valueOut = new D(line.taxableAmount);
        if (s.value !== null) s.value = s.value.sub(valueOut);
        break;
      }
    }

    s.qty = s.qty.add(qtyIn).sub(qtyOut);
    if (s.qty.lt(0)) summary.negativeStockEvents += line.type === "sales_invoice" ? 0 : 1;
    if (s.qty.isZero()) s.value = zero;
    s.seq += 1;
    state.set(line.itemId, s);
    movements.push({
      id: randomUUID(),
      tenantId,
      itemId: line.itemId,
      // Cost is pooled per item (WAC); the batch only records which pack moved, for expiry.
      batchId: line.batchId,
      voucherLineId: line.id,
      date: line.date,
      seq: s.seq,
      qtyIn,
      qtyOut,
      unitCost: qtyIn.gt(0) && valueIn !== null ? valueIn.div(qtyIn).toDecimalPlaces(4) : qtyOut.gt(0) && valueOut !== null ? valueOut.div(qtyOut).toDecimalPlaces(4) : null,
      valueIn,
      valueOut,
      runningQty: s.qty,
      runningValue: s.value,
      reason: line.type
    });
  }

  await tx.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "tenantId" = $1`, tenantId);
  await bulkInsert(tx, tenantId, "StockMovement", MOVEMENT_COLUMNS, movements);
  await bulkUpdate(tx, tenantId, "VoucherLine", { costAmount: "numeric", costBasis: '"CostBasis"' }, costUpdates);
  await tx.$executeRawUnsafe('ANALYZE "StockMovement", "VoucherLine"');

  return {
    items: state.size,
    movements: movements.length,
    costedLines: costUpdates.length - summary.unknownCostLines,
    ...summary,
    durationMs: Date.now() - started
  };
}

const MOVEMENT_COLUMNS = {
  id: "text",
  tenantId: "text",
  itemId: "text",
  batchId: "text",
  voucherLineId: "text",
  date: "date",
  seq: "int",
  qtyIn: "numeric",
  qtyOut: "numeric",
  unitCost: "numeric",
  valueIn: "numeric",
  valueOut: "numeric",
  runningQty: "numeric",
  runningValue: "numeric",
  reason: "text"
};
