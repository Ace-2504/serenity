import { Prisma } from "@prisma/client";
import { column, looseDate, looseMoney, normalise, type Table } from "@/server/adapters/marketplace/table";
import type { Issue } from "@/server/ingest/issues";
import type { CustomerOrderRow } from "@/server/ingest/template";

/**
 * Quick-commerce purchase orders and GRNs (Blinkit, Zepto, Swiggy Instamart, distributors) ->
 * customer_orders rows for fill rate.
 *
 * LOW CONFIDENCE on exact headers: the platforms publish no file specification, so columns are
 * found by common aliases and the import lists what it used. PO and GRN may come as one file
 * or as separate files; they are joined on PO number + SKU. Platform SKUs are mapped to the
 * business's item codes through an uploaded sku_map.csv (channel, external_sku, item_code)
 * when they differ; nothing is guessed.
 */

const D = Prisma.Decimal;

export const PO_COLUMNS = {
  po: ["PO Number", "PO No", "PO No.", "PO ID", "Purchase Order Number", "Purchase Order No", "PO"],
  poDate: ["PO Date", "PO Created At", "PO Creation Date", "Order Date", "Created At"],
  sku: ["Item Code", "SKU", "SKU Code", "SKU ID", "Item ID", "Product ID", "Variant ID", "Seller SKU", "EAN", "UPC"],
  ordered: ["PO Qty", "PO Quantity", "Ordered Qty", "Order Qty", "Ordered Quantity", "Quantity Ordered", "Total Qty"],
  received: ["GRN Qty", "GRN Quantity", "Received Qty", "Received Quantity", "Accepted Qty", "Accepted Quantity", "Delivered Qty", "Qty Received"],
  price: ["Landing Price", "Unit Price", "Cost Price", "PO Price", "Basic Price", "Rate", "Price"],
  grnDate: ["GRN Date", "Received Date", "Delivery Date", "GRN Created At"]
} as const;

export const isPurchaseOrderFile = (t: Table) => column(t.header, PO_COLUMNS.po) >= 0 && column(t.header, PO_COLUMNS.sku) >= 0 && (column(t.header, PO_COLUMNS.ordered) >= 0 || column(t.header, PO_COLUMNS.received) >= 0);
export const isSkuMap = (t: Table) => ["channel", "externalsku", "itemcode"].every((h) => t.header.map(normalise).includes(h));

export const QUICK_COMMERCE_CHANNELS: Record<string, RegExp> = { blinkit: /blinkit|grofers/i, zepto: /zepto/i, instamart: /instamart|swiggy/i };

export type PoConversion = { rows: CustomerOrderRow[]; issues: Issue[]; columnsUsed: Record<string, string>; channel: string };

export function convertPurchaseOrders(
  tables: Table[],
  skuMaps: Table[],
  context: { channel: string; partyCode: string; itemCodes: Set<string> }
): PoConversion {
  const issues: Issue[] = [];
  const columnsUsed: Record<string, string> = {};
  const skuToItem = new Map<string, string>();
  for (const m of skuMaps) {
    const [c, s, i] = ["channel", "externalsku", "itemcode"].map((h) => m.header.map(normalise).indexOf(h));
    for (const r of m.rows) if ((r[c] ?? "").toLowerCase() === context.channel && r[s] && r[i]) skuToItem.set(r[s], r[i]);
  }

  type Line = { po: string; poDate: string | null; sku: string; ordered: Prisma.Decimal | null; received: Prisma.Decimal | null; price: Prisma.Decimal | null; grnDate: string | null; ref: string };
  const lines = new Map<string, Line>();
  for (const t of tables) {
    const col = Object.fromEntries(Object.entries(PO_COLUMNS).map(([k, a]) => [k, column(t.header, a)])) as Record<keyof typeof PO_COLUMNS, number>;
    for (const [k, i] of Object.entries(col)) if (i >= 0) columnsUsed[`${t.file}: ${k}`] = t.header[i];
    t.rows.forEach((r, n) => {
      const ref = `${t.file}:${n + 2}`;
      const po = r[col.po] ?? "";
      const sku = r[col.sku] ?? "";
      if (!po || !sku) return;
      const key = `${po}|${sku}`;
      const line = lines.get(key) ?? { po, poDate: null, sku, ordered: null, received: null, price: null, grnDate: null, ref };
      const qty = (i: number) => {
        if (i < 0 || !r[i]) return null;
        const v = looseMoney(r[i]);
        if (v === null || v.lt(0)) issues.push({ severity: "error", code: "PO_BAD_QTY", entity: "customer_order", rowRef: ref, message: `${t.header[i]} "${r[i]}" is not a quantity` });
        return v;
      };
      const ordered = qty(col.ordered);
      const received = qty(col.received);
      // Several GRNs against one PO line add up; the PO quantity is stated once per line.
      if (ordered !== null) {
        if (line.ordered === null) line.ordered = ordered;
        else if (!line.ordered.eq(ordered)) {
          issues.push({ severity: "warning", code: "PO_QTY_CONFLICT", entity: "customer_order", rowRef: ref, message: `PO ${po} / ${sku}: ordered quantity ${ordered} differs from ${line.ordered} on an earlier row; the first is kept` });
        }
      }
      if (received !== null) line.received = (line.received ?? new D(0)).add(received);
      line.poDate ??= col.poDate >= 0 ? looseDate(r[col.poDate]) : null;
      line.grnDate = (col.grnDate >= 0 ? looseDate(r[col.grnDate]) : null) ?? line.grnDate;
      if (col.price >= 0 && r[col.price]) line.price ??= looseMoney(r[col.price]);
      lines.set(key, line);
    });
  }

  const rows: CustomerOrderRow[] = [];
  const unmapped = new Set<string>();
  let noGrn = 0;
  for (const l of lines.values()) {
    const item = context.itemCodes.has(l.sku) ? l.sku : skuToItem.get(l.sku);
    if (!item) {
      unmapped.add(l.sku);
      continue;
    }
    if (l.ordered === null || l.ordered.lte(0)) {
      issues.push({ severity: "warning", code: "PO_NO_ORDERED_QTY", entity: "customer_order", rowRef: l.ref, message: `PO ${l.po} / ${l.sku}: received but no PO quantity; skipped` });
      continue;
    }
    if (!l.poDate) {
      issues.push({ severity: "error", code: "PO_NO_DATE", entity: "customer_order", rowRef: l.ref, message: `PO ${l.po}: no PO date found` });
      continue;
    }
    if (l.received === null) noGrn += 1;
    rows.push({
      channel: context.channel,
      po_number: l.po,
      po_date: l.poDate,
      party_code: context.partyCode,
      item_code: item,
      qty_ordered: l.ordered.toFixed(),
      qty_supplied: (l.received ?? new D(0)).toFixed(),
      unit_price: l.price ? l.price.toDecimalPlaces(4).toFixed() : "",
      grn_date: l.grnDate ?? ""
    });
  }
  if (unmapped.size > 0) {
    issues.push({
      severity: "error",
      code: "PO_UNMAPPED_SKU",
      entity: "customer_order",
      message: `${unmapped.size} platform SKU(s) are not your item codes (e.g. ${[...unmapped].slice(0, 5).join(", ")}). Upload a sku_map.csv with columns channel, external_sku, item_code.`
    });
  }
  if (noGrn > 0) {
    issues.push({ severity: "warning", code: "PO_NO_GRN", entity: "customer_order", message: `${noGrn} PO line(s) have no received quantity yet and count as not supplied` });
  }
  return { rows, issues, columnsUsed, channel: context.channel };
}
