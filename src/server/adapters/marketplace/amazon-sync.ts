import { ChannelFileError, convertChannelFiles } from "@/server/adapters/marketplace";
import { AmazonApiError, eventsToSettlementFile, SpApiClient } from "@/server/adapters/marketplace/sp-api";
import type { TenantDb } from "@/server/db/tenant";
import { stageImport } from "@/server/ingest/pipeline";

/**
 * Reads closed Amazon.in payouts for a period through the Selling Partner API and stages them
 * for review, into the same "Amazon settlements" source a downloaded report goes to (so a
 * payout read both ways is one record, not two).
 */
export type AmazonSyncResult = { status: string; batchId: string | null; groups: number; closed: number; errors: number; warnings: number };

export async function syncAmazon(
  db: TenantDb,
  tenantId: string,
  options: { from: string; to: string; userId?: string; onStep?: (step: string) => void; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; minIntervalMs?: number }
): Promise<AmazonSyncResult> {
  const client = new SpApiClient(options.env, { fetchImpl: options.fetchImpl, minIntervalMs: options.minIntervalMs });
  options.onStep?.("amazon_groups");
  const groups = await client.eventGroups(options.from, options.to);
  const closed = groups.filter((g) => g.ProcessingStatus === "Closed" && g.FundTransferDate);
  if (closed.length === 0) return { status: "nothing_to_import", batchId: null, groups: groups.length, closed: 0, errors: 0, warnings: 0 };

  const withEvents = [];
  for (const [i, group] of closed.entries()) {
    options.onStep?.(`amazon_events:${i + 1}/${closed.length}`);
    withEvents.push({ group, events: await client.groupEvents(group.FinancialEventGroupId) });
  }
  const { file, unhandled } = eventsToSettlementFile(withEvents);
  const [items, parties] = await Promise.all([db.item.findMany({ select: { sourceKey: true } }), db.party.findMany({ select: { sourceKey: true, name: true, kind: true } })]);
  let conversion;
  try {
    conversion = convertChannelFiles([file], { itemCodes: new Set(items.map((i) => i.sourceKey)), parties: parties.map((p) => ({ code: p.sourceKey, name: p.name, kind: p.kind })) });
  } catch (error) {
    if (error instanceof ChannelFileError) throw new AmazonApiError(`Amazon's payouts could not be converted: ${error.message}`);
    throw error;
  }
  const issues = [
    ...conversion.issues,
    ...unhandled.map((list) => ({ severity: "warning" as const, code: "AMAZON_UNHANDLED_EVENTS", entity: "channel_charge", message: `Amazon returned ${list}, which this connector does not read yet; if it carries money, the payout totals will not match` }))
  ];
  const source =
    (await db.dataSource.findFirst({ where: { kind: "marketplace_file", name: conversion.sourceName } })) ??
    (await db.dataSource.create({ data: { tenantId, kind: "marketplace_file", name: conversion.sourceName } }));
  options.onStep?.("stage");
  const staged = await stageImport(db, {
    tenantId,
    dataSourceId: source.id,
    files: conversion.files,
    userId: options.userId,
    adapter: {
      issues,
      summary: {
        name: "Amazon Selling Partner API",
        verified: false,
        note: "Read from Amazon's Finances API and checked like a settlement report. The connector is tested against a simulated API only, not yet a real seller account: compare the first payouts with Seller Central.",
        details: { ...(conversion.summary.details as object), payoutGroups: groups.length, closedPayouts: closed.length, period: { from: options.from, to: options.to } }
      }
    }
  });
  return { status: staged.status, batchId: staged.batchId, groups: groups.length, closed: closed.length, errors: staged.summary.issues.errors, warnings: staged.summary.issues.warnings };
}
