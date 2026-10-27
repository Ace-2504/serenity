import { Prisma } from "@prisma/client";
import { convertAmazonSettlements, isAmazonSettlement } from "@/server/adapters/marketplace/amazon";
import { convertMeeshoPayments, isMeeshoPayments } from "@/server/adapters/marketplace/meesho";
import { convertPurchaseOrders, isPurchaseOrderFile, isSkuMap, QUICK_COMMERCE_CHANNELS } from "@/server/adapters/marketplace/purchase-orders";
import { readTable, TableError, type Table } from "@/server/adapters/marketplace/table";
import { XlsxError } from "@/server/adapters/xlsx";
import { toCsv } from "@/server/demo/csv";
import type { Issue } from "@/server/ingest/issues";
import type { UploadedFile } from "@/server/ingest/parse";
import type { AdapterSummary } from "@/server/ingest/pipeline";
import { CHANNEL_CHARGE_COLUMNS, CONTROL_TOTAL_COLUMNS, CONTROL_TOTAL_METRICS, CUSTOMER_ORDER_COLUMNS, TEMPLATE_FILES, type ChannelChargeRow } from "@/server/ingest/template";

/**
 * Marketplace and quick-commerce files -> channel-only template bundle (channel_charges.csv or
 * customer_orders.csv, plus control totals). The bundle then goes through normal staging; its
 * charges are linked to the books' orders at commit, whichever was imported first.
 */

export class ChannelFileError extends Error {}

export type ChannelContext = { channel?: string; partyCode?: string; itemCodes: Set<string>; parties: { code: string; name: string; kind: string }[] };
export type ChannelConversion = { platform: "amazon" | "meesho" | "purchase_orders"; sourceName: string; files: UploadedFile[]; issues: Issue[]; summary: AdapterSummary };

const UNVERIFIED = {
  amazon: "Converted from Amazon's Settlement Report V2 layout. Fee and tax line names for Amazon.in come from public samples and are not yet verified against a real file; unrecognised lines are listed.",
  meesho: "Converted from a Meesho payments export. Meesho publishes no file specification: column names come from public samples and may differ in your file. Fees shown incl. GST are split at an assumed 18% GST.",
  purchase_orders: "Converted from purchase order / GRN files using common column names; the platforms publish no file specification. Check the columns used below."
};

function controlTotals(period: { from: string; to: string }, channelCharges = "0.00"): string {
  return toCsv(
    CONTROL_TOTAL_COLUMNS,
    CONTROL_TOTAL_METRICS.map((metric) => ({ metric, period_from: period.from, period_to: period.to, value: metric === "channel_charges" ? channelCharges : "0.00" }))
  );
}

const span = (dates: string[]) => (dates.length ? { from: dates.reduce((a, b) => (a < b ? a : b)), to: dates.reduce((a, b) => (a > b ? a : b)) } : null);

export function convertChannelFiles(uploads: UploadedFile[], ctx: ChannelContext): ChannelConversion {
  let tables: Table[];
  try {
    tables = uploads.map(readTable);
  } catch (error) {
    if (error instanceof TableError || error instanceof XlsxError) throw new ChannelFileError(error.message);
    throw error;
  }
  const kinds = tables.map((t) => (isAmazonSettlement(t) ? "amazon" : isMeeshoPayments(t) ? "meesho" : isSkuMap(t) ? "sku_map" : isPurchaseOrderFile(t) ? "purchase_orders" : "unknown"));
  const unknown = tables.filter((_, i) => kinds[i] === "unknown").map((t) => t.file);
  if (unknown.length) {
    throw new ChannelFileError(`Not recognised: ${unknown.join(", ")}. Expected an Amazon Settlement V2 report, a Meesho payments export, purchase order / GRN files, or the import template.`);
  }
  const platforms = new Set(kinds.filter((k) => k !== "sku_map"));
  if (platforms.size !== 1) throw new ChannelFileError("Upload one platform's files at a time (Amazon settlements, Meesho payments, or purchase orders with GRNs)");
  const platform = [...platforms][0] as ChannelConversion["platform"];
  const of = (k: string) => tables.filter((_, i) => kinds[i] === k);

  if (platform === "amazon" || platform === "meesho") {
    const result = platform === "amazon" ? convertAmazonSettlements(of("amazon")) : convertMeeshoPayments(of("meesho"));
    const period = span(result.rows.map((r) => r.settlement_date));
    if (!period) throw new ChannelFileError("No paid settlements found in the file");
    const total = result.rows.reduce((s, r: ChannelChargeRow) => s.add(r.amount), new Prisma.Decimal(0)).toFixed(2);
    return {
      platform,
      sourceName: platform === "amazon" ? "Amazon settlements" : "Meesho payments",
      files: [
        { name: TEMPLATE_FILES.channelCharges, content: Buffer.from(toCsv(CHANNEL_CHARGE_COLUMNS, result.rows)) },
        { name: TEMPLATE_FILES.controlTotals, content: Buffer.from(controlTotals(period, total)) }
      ],
      issues: result.issues,
      summary: {
        name: platform === "amazon" ? "Amazon settlement report" : "Meesho payments export",
        verified: false,
        note: UNVERIFIED[platform],
        details: { ...result, rows: undefined, charges: result.rows.length }
      }
    };
  }

  // Purchase orders: channel from the form or the file name; customer from the books.
  const channel = ctx.channel ?? Object.entries(QUICK_COMMERCE_CHANNELS).find(([, re]) => uploads.some((u) => re.test(u.name)))?.[0];
  if (!channel) throw new ChannelFileError("Choose which platform these purchase orders are from (Blinkit, Zepto or Instamart)");
  let partyCode = ctx.partyCode;
  if (!partyCode) {
    const re = QUICK_COMMERCE_CHANNELS[channel] ?? new RegExp(channel, "i");
    const matches = ctx.parties.filter((p) => p.kind !== "supplier" && re.test(p.name));
    if (matches.length !== 1) {
      throw new ChannelFileError(
        matches.length === 0
          ? `No customer in your books looks like ${channel}; choose the customer these POs belong to`
          : `Several customers look like ${channel} (${matches.map((m) => m.name).join(", ")}); choose one`
      );
    }
    partyCode = matches[0].code;
  }
  const result = convertPurchaseOrders(of("purchase_orders"), of("sku_map"), { channel, partyCode, itemCodes: ctx.itemCodes });
  const period = span(result.rows.map((r) => r.po_date));
  if (!period) throw new ChannelFileError(result.issues.find((i) => i.severity === "error")?.message ?? "No purchase order lines found");
  return {
    platform,
    sourceName: `${channel[0].toUpperCase()}${channel.slice(1)} purchase orders`,
    files: [
      { name: TEMPLATE_FILES.customerOrders, content: Buffer.from(toCsv(CUSTOMER_ORDER_COLUMNS, result.rows)) },
      { name: TEMPLATE_FILES.controlTotals, content: Buffer.from(controlTotals(period)) }
    ],
    issues: result.issues,
    summary: { name: "Purchase orders and GRNs", verified: false, note: UNVERIFIED.purchase_orders, details: { channel, partyCode, lines: result.rows.length, columnsUsed: result.columnsUsed } }
  };
}
