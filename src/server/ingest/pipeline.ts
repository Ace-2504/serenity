import { createHash, randomUUID } from "node:crypto";
import { Prisma, type VoucherType } from "@prisma/client";
import { getDomainPack } from "@/domain/packs";
import { bulkInsert } from "@/server/db/bulk";
import type { TenantDb } from "@/server/db/tenant";
import { IssueLog, type Issue } from "@/server/ingest/issues";
import { rebuildStockLedger, type LedgerSummary } from "@/server/ledger/stock";
import { contentHash, parseBundle, type ParsedBundle, type UploadedFile } from "@/server/ingest/parse";
import { validateBundle, type ControlReconciliation, type KnownRecords } from "@/server/ingest/validate";

/**
 * Import pipeline: stage (validate + preview + store the exact bytes) and commit (write in
 * one transaction, reconcile inside it, roll back on any mismatch).
 *
 * Idempotency:
 *   - re-uploading the bytes of the latest committed import for a data source is a no-op;
 *   - every record is keyed by (data source, entity, source key) and compared by content hash, so
 *     unchanged records are skipped and corrections become a new SourceRecord version.
 * Full-period semantics: a template bundle is the complete set of vouchers for its control-total
 * period, so earlier vouchers in that period that are missing now are marked deleted_at_source.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

const MAX_STORED_ISSUES = 5000;
const CHUNK = 2000;
const TX_OPTIONS = { timeout: 10 * 60_000, maxWait: 30_000 };
const TEMPLATE_VOUCHER_TYPES: VoucherType[] = ["sales_invoice", "sales_return", "purchase_invoice", "purchase_return", "receipt", "payment"];

export type EntityCounts = { new: number; changed: number; unchanged: number; deletedAtSource: number };

export type ImportSummary = {
  files: ParsedBundle["files"];
  period: { from: string; to: string } | null;
  entities: Record<string, EntityCounts>;
  issues: { errors: number; warnings: number; byCode: ReturnType<IssueLog["countsByCode"]> };
  controlTotals: ControlReconciliation;
  /** Set on commit: the rebuilt stock ledger and how it compares with the source's closing stock. */
  ledger?: LedgerSummary & { stockCheck: StockCheck };
  /** Set on commit: channel charges linked to an order in the books, business-wide. */
  chargeLinks?: { linked: number; unlinked: number; ambiguous: number };
  /** Set when a file adapter (e.g. Tally XML) produced the template files. */
  adapter?: AdapterSummary;
};

export type AdapterSummary = { name: string; verified: false; note: string; details: unknown };

export type StockCheck = { items: number; qtyMismatches: number; valueMismatches: number; valueUnknownInLedger: number; examples: string[] };

export type StageResult = { batchId: string; status: "validated" | "rejected" | "duplicate"; summary: ImportSummary };

export type DbReconciliation = { metric: string; expected: string; inDatabase: string; ok: boolean }[];

export type CommitResult = { batchId: string; status: "committed"; summary: ImportSummary; reconciliation: DbReconciliation; durationMs: number };

export class ImportError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NOT_COMMITTABLE" | "FILES_CHANGED" | "VALIDATION_FAILED" | "RECONCILIATION_FAILED",
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

// ── Staging ─────────────────────────────────────────────────────────────────

export async function stageImport(
  db: TenantDb,
  input: { tenantId: string; dataSourceId: string; files: UploadedFile[]; userId?: string; adapter?: { summary: AdapterSummary; issues: Issue[] } }
): Promise<StageResult> {
  const log = new IssueLog();
  for (const issue of input.adapter?.issues ?? []) log.add(issue);
  const bundle = parseBundle(input.files, log);

  return db.$transaction(async (tx) => {
    await lockDataSource(tx, input.dataSourceId);
    // The same bytes as the latest committed import change nothing. An older file re-uploaded
    // after later imports is a real change (it may restore records) and is staged normally.
    const latest = await tx.importBatch.findFirst({ where: { dataSourceId: input.dataSourceId, status: "committed" }, orderBy: { committedAt: "desc" } });
    if (latest?.fileSha256 === bundle.bundleSha256) {
      return { batchId: latest.id, status: "duplicate" as const, summary: latest.counts as unknown as ImportSummary };
    }
    const previous = await tx.importBatch.findFirst({ where: { dataSourceId: input.dataSourceId, fileSha256: bundle.bundleSha256, status: { not: "committed" } } });

    const { summary } = await analyse(tx, input.tenantId, input.dataSourceId, bundle, log);
    if (input.adapter) summary.adapter = input.adapter.summary;
    const status = log.errorCount > 0 ? ("rejected" as const) : ("validated" as const);

    // Re-staging the same bytes replaces the earlier, uncommitted attempt.
    if (previous) await tx.importBatch.delete({ where: { id: previous.id } });
    const batch = await tx.importBatch.create({
      data: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        status,
        fileName: bundle.files.map((f) => f.name).join(", "),
        fileSha256: bundle.bundleSha256,
        periodFrom: summary.period ? new Date(summary.period.from) : null,
        periodTo: summary.period ? new Date(summary.period.to) : null,
        counts: summary as unknown as Prisma.InputJsonValue,
        controlTotals: summary.controlTotals as unknown as Prisma.InputJsonValue,
        createdById: input.userId ?? null
      }
    });
    for (const upload of input.files) {
      const name = upload.name.split(/[\\/]/).pop()!.toLowerCase();
      const meta = bundle.files.find((f) => f.name === name);
      if (!meta) continue; // unknown files are reported, not stored
      await tx.importFile.create({
        data: { tenantId: input.tenantId, importBatchId: batch.id, name, sha256: meta.sha256, sizeBytes: meta.sizeBytes, content: upload.content }
      });
    }
    await storeIssues(tx, input.tenantId, batch.id, log.issues);
    return { batchId: batch.id, status, summary };
  }, TX_OPTIONS);
}

// ── Commit ──────────────────────────────────────────────────────────────────

export type CommitOptions = {
  userId?: string;
  /** Test hook: called before each write step; throwing simulates an interrupted import. */
  onStep?: (step: string) => void;
};

export async function commitImport(db: TenantDb, tenantId: string, batchId: string, options: CommitOptions = {}): Promise<CommitResult> {
  const started = Date.now();
  try {
    return await db.$transaction(async (tx) => {
      const found = await tx.importBatch.findUnique({ where: { id: batchId }, select: { dataSourceId: true } });
      if (!found) throw new ImportError("NOT_FOUND", "Import not found");
      await lockDataSource(tx, found.dataSourceId);
      // Read the status only after taking the lock: a concurrent commit of the same batch may
      // have finished while we waited, and a status read before the lock would be stale.
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (batch.status !== "validated" && batch.status !== "failed") {
        throw new ImportError("NOT_COMMITTABLE", `Import is ${batch.status} and cannot be committed`);
      }

      // Re-parse the stored bytes and prove they are the ones that were validated.
      const stored = await tx.importFile.findMany({ where: { importBatchId: batchId } });
      for (const file of stored) {
        if (createHash("sha256").update(file.content).digest("hex") !== file.sha256) {
          throw new ImportError("FILES_CHANGED", `${file.name} no longer matches the file that was validated`);
        }
      }
      const log = new IssueLog();
      const bundle = parseBundle(stored.map((f) => ({ name: f.name, content: Buffer.from(f.content) })), log);
      if (bundle.bundleSha256 !== batch.fileSha256) throw new ImportError("FILES_CHANGED", "Stored files do not match the staged bundle");

      // The database may have changed since staging; validate again against it.
      const { summary, plan } = await analyse(tx, tenantId, batch.dataSourceId, bundle, log);
      if (log.errorCount > 0) {
        throw new ImportError("VALIDATION_FAILED", "The import no longer validates against current data; stage it again", log.issues.slice(0, 20));
      }

      await writeBundle(tx, tenantId, batch.dataSourceId, batch.id, bundle, plan, options.onStep ?? (() => undefined));

      // Marketplace charges arrive in their own files; link them to the orders in the books by
      // voucher number or marketplace order id, whichever side was imported first.
      summary.chargeLinks = await linkChannelCharges(tx, tenantId);

      options.onStep?.("ledger");
      const ledger = await rebuildStockLedger(tx, tenantId);
      summary.ledger = { ...ledger, stockCheck: await checkStockAgainstSource(tx, tenantId, batch.id) };

      // Reconcile what is now in the database against the source's control totals, inside the
      // transaction: a mismatch rolls everything back, so "committed" always means "reconciled".
      options.onStep?.("reconcile");
      const reconciliation = await reconcileDatabase(tx, tenantId, batch.dataSourceId, bundle);
      if (reconciliation.some((r) => !r.ok)) {
        throw new ImportError("RECONCILIATION_FAILED", "Database totals do not match the control totals", reconciliation);
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: "committed",
          committedAt: new Date(),
          error: null,
          counts: summary as unknown as Prisma.InputJsonValue,
          reconciliation: reconciliation as unknown as Prisma.InputJsonValue
        }
      });
      await tx.dataSource.update({ where: { id: batch.dataSourceId }, data: { lastSuccessfulSyncAt: new Date() } });
      await tx.auditLog.create({
        data: { tenantId, actorUserId: options.userId ?? null, action: "import.commit", entity: "ImportBatch", entityId: batchId, after: { entities: summary.entities } as Prisma.InputJsonValue }
      });
      return { batchId, status: "committed" as const, summary, reconciliation, durationMs: Date.now() - started };
    }, TX_OPTIONS);
  } catch (error) {
    // The transaction rolled back; record the failure outside it so the owner can see why.
    await db.importBatch
      .updateMany({ where: { id: batchId, status: { in: ["validated", "failed"] } }, data: { status: "failed", error: String((error as Error).message).slice(0, 2000) } })
      .catch(() => undefined);
    throw error;
  }
}

// ── Analysis: known records, change plan, summary ───────────────────────────

type Entry = { entity: string; key: string; hash: string };
type Plan = {
  entries: (Entry & { draft: unknown })[];
  current: Map<string, { id: string; version: number; contentHash: string }>;
  status: Map<string, "new" | "changed" | "unchanged">;
  deletedVoucherKeys: string[];
  deletedChargeKeys: string[];
  deletedOrderKeys: string[];
};

async function analyse(tx: TenantTx, tenantId: string, dataSourceId: string, bundle: ParsedBundle, log: IssueLog) {
  const known = await loadKnown(tx, dataSourceId, bundle.kind);
  const controlTotals = validateBundle(bundle, known, log);
  if (bundle.kind === "channel") await previewOrderLinks(tx, bundle, log);
  await validateAttributes(tx, tenantId, bundle, log);
  const period = bundle.controlTotals.length > 0 ? { from: bundle.controlTotals[0].from, to: bundle.controlTotals[0].to } : null;

  const current = new Map<string, { id: string; version: number; contentHash: string }>();
  for (const record of await tx.sourceRecord.findMany({
    where: { dataSourceId, supersededAt: null },
    select: { id: true, entity: true, sourceKey: true, version: true, contentHash: true }
  })) {
    current.set(`${record.entity}|${record.sourceKey}`, record);
  }

  const status = new Map<string, "new" | "changed" | "unchanged">();
  const entities: Record<string, EntityCounts> = {};
  const all = entries(bundle);
  for (const entry of all) {
    const id = `${entry.entity}|${entry.key}`;
    const previous = current.get(id);
    const state = !previous ? "new" : previous.contentHash === entry.hash ? "unchanged" : "changed";
    status.set(id, state);
    entities[entry.entity] ??= { new: 0, changed: 0, unchanged: 0, deletedAtSource: 0 };
    entities[entry.entity][state] += 1;
  }

  let deletedVoucherKeys: string[] = [];
  let deletedChargeKeys: string[] = [];
  let deletedOrderKeys: string[] = [];
  if (period) {
    const range = { gte: new Date(period.from), lte: new Date(period.to) };
    const inBundle = new Set([...bundle.vouchers.map((v) => v.key), ...bundle.settlements.map((s) => s.key)]);
    deletedVoucherKeys = (
      await tx.voucher.findMany({ where: { dataSourceId, status: "active", type: { in: TEMPLATE_VOUCHER_TYPES }, date: range }, select: { sourceKey: true } })
    )
      .map((v) => v.sourceKey)
      .filter((key) => !inBundle.has(key));
    const chargeKeys = new Set(bundle.charges.map((c) => c.key));
    deletedChargeKeys = (await tx.channelCharge.findMany({ where: { dataSourceId, status: "active", settlementDate: range }, select: { sourceKey: true } }))
      .map((c) => c.sourceKey)
      .filter((key) => !chargeKeys.has(key));
    const orderKeys = new Set(bundle.customerOrders.map((o) => o.key));
    deletedOrderKeys = (await tx.customerOrderLine.findMany({ where: { dataSourceId, status: "active", poDate: range }, select: { sourceKey: true } }))
      .map((o) => o.sourceKey)
      .filter((key) => !orderKeys.has(key));
    if (deletedOrderKeys.length > 0) {
      entities.customer_order ??= { new: 0, changed: 0, unchanged: 0, deletedAtSource: 0 };
      entities.customer_order.deletedAtSource += deletedOrderKeys.length;
    }
    for (const key of deletedVoucherKeys) {
      const entity = key.startsWith("receipt|") || key.startsWith("payment|") ? "settlement" : "voucher";
      entities[entity] ??= { new: 0, changed: 0, unchanged: 0, deletedAtSource: 0 };
      entities[entity].deletedAtSource += 1;
    }
    if (deletedChargeKeys.length > 0) {
      entities.channel_charge ??= { new: 0, changed: 0, unchanged: 0, deletedAtSource: 0 };
      entities.channel_charge.deletedAtSource += deletedChargeKeys.length;
    }
    const deletedCount = deletedVoucherKeys.length + deletedChargeKeys.length + deletedOrderKeys.length;
    if (deletedCount > 0) {
      log.warning(
        "MISSING_FROM_SOURCE",
        "voucher",
        `${deletedCount} record(s) imported earlier for ${period.from} to ${period.to} are not in this file and will be marked deleted at source`
      );
    }
  }

  const summary: ImportSummary = {
    files: bundle.files,
    period,
    entities,
    issues: {
      errors: log.errorCount,
      warnings: log.issues.filter((i) => i.severity === "warning").length,
      byCode: log.countsByCode()
    },
    controlTotals
  };
  return { summary, plan: { entries: all, current, status, deletedVoucherKeys, deletedChargeKeys, deletedOrderKeys } satisfies Plan };
}

/** One entry per versioned record in the bundle. Snapshots are point-in-time and replaced instead. */
function entries(bundle: ParsedBundle): (Entry & { draft: unknown })[] {
  const out: (Entry & { draft: unknown })[] = [];
  const add = (entity: string, key: string, draft: unknown) => out.push({ entity, key, hash: contentHash(draft), draft });
  bundle.parties.forEach((p) => add("party", p.code, p));
  bundle.items.forEach((i) => add("item", i.code, i));
  const opening = openingStockDraft(bundle);
  if (opening) add("opening_stock", opening.key, opening);
  bundle.vouchers.forEach((v) => add("voucher", v.key, v));
  bundle.settlements.forEach((s) => add("settlement", s.key, s));
  bundle.charges.forEach((c) => add("channel_charge", c.key, c));
  bundle.customerOrders.forEach((o) => add("customer_order", o.key, o));
  return out;
}

function openingStockDraft(bundle: ParsedBundle) {
  const period = bundle.controlTotals[0];
  const batchesOf = new Map<string, ParsedBundle["batches"]>();
  for (const b of bundle.batches) if (b.openingQty.gt(0)) batchesOf.set(b.itemCode, [...(batchesOf.get(b.itemCode) ?? []), b]);
  const lines: { itemCode: string; qty: Prisma.Decimal; value: Prisma.Decimal | null; batchNo?: string }[] = [];
  for (const i of bundle.items.filter((it) => it.openingQty.gt(0))) {
    const batches = batchesOf.get(i.code);
    if (!batches) {
      lines.push({ itemCode: i.code, qty: i.openingQty, value: i.openingValue });
      continue;
    }
    // One line per batch. Batch values when all are given, else the item's value split by quantity.
    const allValued = batches.every((b) => b.openingValue !== null);
    let left = i.openingValue;
    batches.forEach((b, n) => {
      let value: Prisma.Decimal | null = null;
      if (allValued) value = b.openingValue;
      else if (i.openingValue !== null && left !== null) {
        value = n === batches.length - 1 ? left : i.openingValue.mul(b.openingQty).div(i.openingQty).toDecimalPlaces(2, D.ROUND_HALF_UP);
        left = left.sub(value);
      }
      lines.push({ itemCode: i.code, qty: b.openingQty, value, batchNo: b.batchNo });
    });
  }
  if (!period || lines.length === 0) return null;
  return { key: `opening_stock|${period.from}`, date: period.from, lines };
}

/** Every batch the bundle mentions, with the first expiry, manufacture date and MRP given for it. */
function batchSpecs(bundle: ParsedBundle) {
  const specs = new Map<string, { itemCode: string; batchNo: string; expiryDate: string | null; mfgDate: string | null; mrp: Prisma.Decimal | null }>();
  const note = (itemCode: string, batchNo: string, expiryDate: string | null | undefined, mfgDate: string | null | undefined, mrp: Prisma.Decimal | null | undefined) => {
    const key = `${itemCode}|${batchNo}`;
    const s = specs.get(key) ?? { itemCode, batchNo, expiryDate: null, mfgDate: null, mrp: null };
    s.expiryDate ??= expiryDate ?? null;
    s.mfgDate ??= mfgDate ?? null;
    s.mrp ??= mrp ?? null;
    specs.set(key, s);
  };
  for (const b of bundle.batches) note(b.itemCode, b.batchNo, b.expiryDate, b.mfgDate, b.mrp);
  for (const v of bundle.vouchers) for (const l of v.lines) if (l.batchNo) note(l.itemCode, l.batchNo, l.expiryDate, null, l.mrp);
  return [...specs.values()];
}

/** Creates missing batches and fills in expiry, manufacture date or MRP learned later. Returns ids by "itemId|batchNo". */
async function upsertBatches(tx: TenantTx, tenantId: string, bundle: ParsedBundle, itemIds: Map<string, string>) {
  const specs = batchSpecs(bundle).filter((s) => itemIds.has(s.itemCode));
  const ids = new Map<string, string>();
  if (specs.length === 0) return ids;
  const asData = (s: (typeof specs)[number]) => ({
    expiryDate: s.expiryDate ? new Date(s.expiryDate) : null,
    mfgDate: s.mfgDate ? new Date(s.mfgDate) : null,
    mrp: s.mrp
  });
  await createChunked(
    specs.map((s) => ({ tenantId, itemId: itemIds.get(s.itemCode)!, batchNo: s.batchNo, ...asData(s) })),
    (data) => tx.batch.createMany({ data, skipDuplicates: true })
  );
  const itemIdList = [...new Set(specs.map((s) => itemIds.get(s.itemCode)!))];
  for (let i = 0; i < itemIdList.length; i += CHUNK) {
    const rows = await tx.batch.findMany({ where: { itemId: { in: itemIdList.slice(i, i + CHUNK) } }, select: { id: true, itemId: true, batchNo: true, expiryDate: true, mfgDate: true, mrp: true } });
    for (const r of rows) ids.set(`${r.itemId}|${r.batchNo}`, r.id);
    const byKey = new Map(rows.map((r) => [`${r.itemId}|${r.batchNo}`, r]));
    for (const s of specs) {
      const row = byKey.get(`${itemIds.get(s.itemCode)}|${s.batchNo}`);
      if (!row) continue;
      const missing = { ...(row.expiryDate === null && s.expiryDate ? { expiryDate: new Date(s.expiryDate) } : {}), ...(row.mfgDate === null && s.mfgDate ? { mfgDate: new Date(s.mfgDate) } : {}), ...(row.mrp === null && s.mrp ? { mrp: s.mrp } : {}) };
      if (Object.keys(missing).length > 0) await tx.batch.update({ where: { id: row.id }, data: missing });
    }
  }
  await analyze(tx, "Batch");
  return ids;
}

/**
 * Records already imported that a bundle may reference. Books bundles see their own source's
 * masters; channel bundles (marketplace charges, customer POs) reference the books' items and
 * parties, so they see the whole business's.
 */
async function loadKnown(tx: TenantTx, dataSourceId: string, kind: ParsedBundle["kind"] = "books"): Promise<KnownRecords> {
  const masters = kind === "channel" ? {} : { dataSourceId };
  const [items, parties, vouchers] = await Promise.all([
    tx.item.findMany({ where: masters, select: { sourceKey: true } }),
    tx.party.findMany({ where: masters, select: { sourceKey: true, kind: true } }),
    tx.voucher.findMany({ where: { dataSourceId, status: "active" }, select: { sourceKey: true } })
  ]);
  return {
    itemCodes: new Set(items.map((i) => i.sourceKey)),
    parties: new Map(parties.map((p) => [p.sourceKey, p.kind])),
    voucherKeys: new Set(vouchers.map((v) => v.sourceKey))
  };
}

async function validateAttributes(tx: TenantTx, tenantId: string, bundle: ParsedBundle, log: IssueLog) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { domainPack: true } });
  const pack = getDomainPack(tenant.domainPack);
  const schema = pack.itemAttributes;
  if (pack.batchTracking === "required") {
    const lines = bundle.vouchers.filter((v) => v.type === "sales_invoice" || v.type === "purchase_invoice").flatMap((v) => v.lines);
    const missing = lines.filter((l) => !l.batchNo).length;
    if (missing > 0) {
      log.warning("MISSING_BATCH", "voucher", `${missing} of ${lines.length} purchase and sales lines have no batch_no. ${pack.label} stock is tracked by batch, so expiry reports will treat their stock as consumed earliest-expiry-first`, {
        field: "batch_no"
      });
    }
  }
  for (const item of bundle.items) {
    const result = schema.safeParse(item.attributes);
    if (!result.success) {
      log.error("INVALID_ATTRIBUTES", "item", `${item.code}: ${result.error.issues.map((i) => `${i.path.join(".") || "attributes"} ${i.message}`).join("; ")}`, {
        rowRef: item.rowRef,
        field: "attributes_json"
      });
    }
  }
}

/** For channel files: how many of the orders they mention are in the books already. */
async function previewOrderLinks(tx: TenantTx, bundle: ParsedBundle, log: IssueLog) {
  const refs = [...new Set(bundle.charges.map((c) => c.orderNumber).filter((r): r is string => r !== null))];
  if (refs.length === 0) return;
  const found = new Set<string>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const chunk = refs.slice(i, i + CHUNK);
    const rows = await tx.voucher.findMany({
      where: { type: "sales_invoice", status: "active", OR: [{ orderRef: { in: chunk } }, { number: { in: chunk } }] },
      select: { orderRef: true, number: true }
    });
    for (const r of rows) {
      if (r.orderRef) found.add(r.orderRef);
      found.add(r.number);
    }
  }
  const missing = refs.filter((r) => !found.has(r));
  const message = `${refs.length - missing.length} of ${refs.length} orders in this file were found in your books`;
  if (missing.length === 0) log.add({ severity: "info", code: "ORDERS_MATCHED", entity: "channel_charge", message });
  else
    log.warning(
      "ORDERS_NOT_IN_BOOKS",
      "channel_charge",
      `${message}; charges for the other ${missing.length} (e.g. ${missing.slice(0, 3).join(", ")}) are kept and linked automatically once those invoices are imported`
    );
}

/**
 * Item and party ids by code, across the business, for channel files that reference the books.
 * If two sources use the same code, the most recently created record wins.
 */
async function tenantMasters(tx: TenantTx, bundle: ParsedBundle) {
  const itemCodes = [...new Set(bundle.customerOrders.map((o) => o.itemCode))];
  const partyCodes = [...new Set(bundle.customerOrders.map((o) => o.partyCode))];
  const [items, parties] = await Promise.all([
    tx.item.findMany({ where: { sourceKey: { in: itemCodes } }, select: { id: true, sourceKey: true }, orderBy: { createdAt: "asc" } }),
    tx.party.findMany({ where: { sourceKey: { in: partyCodes } }, select: { id: true, sourceKey: true }, orderBy: { createdAt: "asc" } })
  ]);
  return { items: new Map(items.map((i) => [i.sourceKey, i.id])), parties: new Map(parties.map((p) => [p.sourceKey, p.id])) };
}

/**
 * Links unlinked order-level channel charges to the sales invoice they belong to, by the
 * invoice's number or its marketplace order reference. When several invoices match (an order
 * split across invoices), the earliest is used and the charge is counted as ambiguous.
 */
async function linkChannelCharges(tx: TenantTx, tenantId: string) {
  const [result] = await tx.$queryRaw<{ linked: bigint; ambiguous: bigint }[]>`
    WITH candidates AS (
      SELECT c."id" AS charge_id, v."id" AS voucher_id,
        ROW_NUMBER() OVER (PARTITION BY c."id" ORDER BY v."date", v."number") AS rn,
        COUNT(*) OVER (PARTITION BY c."id") AS matches
      FROM "ChannelCharge" c
      JOIN "Voucher" v ON v."tenantId" = c."tenantId" AND v."type" = 'sales_invoice' AND v."status" = 'active'
        AND (v."orderRef" = c."orderRef" OR v."number" = c."orderRef")
      WHERE c."tenantId" = ${tenantId} AND c."orderVoucherId" IS NULL AND c."orderRef" IS NOT NULL
    ),
    updated AS (
      UPDATE "ChannelCharge" c SET "orderVoucherId" = m.voucher_id, "allocationBasis" = NULL
      FROM candidates m WHERE m.rn = 1 AND c."id" = m.charge_id AND c."tenantId" = ${tenantId}
      RETURNING c."id", m.matches
    )
    SELECT COUNT(*) AS linked, COUNT(*) FILTER (WHERE matches > 1) AS ambiguous FROM updated`;
  const [{ unlinked }] = await tx.$queryRaw<{ unlinked: bigint }[]>`
    SELECT COUNT(*) AS unlinked FROM "ChannelCharge"
    WHERE "tenantId" = ${tenantId} AND "status" = 'active' AND "orderVoucherId" IS NULL AND "orderRef" IS NOT NULL`;
  return { linked: Number(result?.linked ?? 0), unlinked: Number(unlinked), ambiguous: Number(result?.ambiguous ?? 0) };
}

async function lockDataSource(tx: TenantTx, dataSourceId: string) {
  // Serialises imports per data source: two concurrent commits cannot interleave.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dataSourceId}))`;
}

async function storeIssues(tx: TenantTx, tenantId: string, batchId: string, issues: Issue[]) {
  const rows = issues.slice(0, MAX_STORED_ISSUES).map((issue) => ({
    tenantId,
    importBatchId: batchId,
    severity: issue.severity,
    code: issue.code,
    entity: issue.entity,
    rowRef: issue.rowRef ?? null,
    field: issue.field ?? null,
    message: issue.message
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.importIssue.createMany({ data: rows.slice(i, i + CHUNK) });
  }
}

// ── Writing ─────────────────────────────────────────────────────────────────

/**
 * Refreshes planner statistics for tables just bulk-loaded in this transaction (ANALYZE inside
 * a transaction counts its own uncommitted rows and samples at most 30k rows, so it is cheap).
 * Each referenced table is analysed before rows that reference it are inserted. Otherwise the
 * foreign-key checks, and later lookups, are planned on stale statistics: after a big delete,
 * autovacuum records the table as empty, and Postgres then checked each (id, tenantId) foreign
 * key through the (tenantId, type, date) index, scanning every voucher of the tenant per line.
 * Measured: 160-350 s instead of 5 s for 31k lines.
 */
async function analyze(tx: { $executeRawUnsafe(query: string): Promise<number> }, ...tables: string[]) {
  await tx.$executeRawUnsafe(`ANALYZE ${tables.map((t) => `"${t}"`).join(", ")}`);
}

async function writeBundle(tx: TenantTx, tenantId: string, dataSourceId: string, batchId: string, bundle: ParsedBundle, plan: Plan, step: (s: string) => void) {
  const now = new Date();
  const recordIds = new Map<string, string>();
  const newRecords: Prisma.SourceRecordCreateManyInput[] = [];
  const supersede: string[] = [];

  // A SourceRecord for every new or changed entry; changed entries supersede the previous version.
  for (const entry of plan.entries) {
    const id = `${entry.entity}|${entry.key}`;
    const state = plan.status.get(id)!;
    if (state === "unchanged") continue;
    const previous = plan.current.get(id);
    const recordId = randomUUID();
    recordIds.set(id, recordId);
    if (previous) supersede.push(previous.id);
    newRecords.push({
      id: recordId,
      tenantId,
      dataSourceId,
      importBatchId: batchId,
      entity: entry.entity,
      sourceKey: entry.key,
      version: (previous?.version ?? 0) + 1,
      contentHash: entry.hash,
      payload: toJson(entry.draft)
    });
  }
  step("source_records");
  for (let i = 0; i < supersede.length; i += CHUNK) {
    await tx.sourceRecord.updateMany({ where: { id: { in: supersede.slice(i, i + CHUNK) } }, data: { supersededAt: now } });
  }
  await bulkInsert(tx, tenantId, "SourceRecord", COLUMNS.SourceRecord, newRecords);
  if (newRecords.length > 0) await analyze(tx, "SourceRecord");

  const isWrite = (entity: string, key: string) => recordIds.get(`${entity}|${key}`);

  // Masters.
  step("masters");
  const groups = [...new Set(bundle.items.map((i) => i.group))];
  await tx.itemGroup.createMany({ data: groups.map((name) => ({ tenantId, name })), skipDuplicates: true });
  const groupIds = new Map((await tx.itemGroup.findMany({ where: { name: { in: groups } } })).map((g) => [g.name, g.id]));

  const partyIds = new Map((await tx.party.findMany({ where: { dataSourceId }, select: { id: true, sourceKey: true } })).map((p) => [p.sourceKey, p.id]));
  const newParties: Prisma.PartyCreateManyInput[] = [];
  for (const p of bundle.parties) {
    const recordId = isWrite("party", p.code);
    if (!recordId) continue;
    const data = {
      sourceRecordId: recordId,
      name: p.name,
      kind: p.kind,
      anonymousBuyers: p.anonymousBuyers,
      gstin: p.gstin,
      stateCode: p.stateCode,
      city: p.city,
      segmentTag: p.segment,
      creditDays: p.creditDays,
      phone: p.phone,
      email: p.email
    };
    const existing = partyIds.get(p.code);
    if (existing) {
      await tx.party.update({ where: { id: existing }, data });
    } else {
      const id = randomUUID();
      partyIds.set(p.code, id);
      newParties.push({ id, tenantId, dataSourceId, sourceKey: p.code, ...data });
    }
  }
  await createChunked(newParties, (data) => tx.party.createMany({ data }));

  const itemIds = new Map((await tx.item.findMany({ where: { dataSourceId }, select: { id: true, sourceKey: true } })).map((i) => [i.sourceKey, i.id]));
  const newItems: Prisma.ItemCreateManyInput[] = [];
  for (const it of bundle.items) {
    const recordId = isWrite("item", it.code);
    if (!recordId) continue;
    const data = {
      sourceRecordId: recordId,
      sku: it.code,
      name: it.name,
      itemGroupId: groupIds.get(it.group)!,
      uom: it.uom,
      hsnCode: it.hsnCode,
      gstRate: it.gstRate,
      attributes: toJson(it.attributes)
    };
    const existing = itemIds.get(it.code);
    if (existing) {
      await tx.item.update({ where: { id: existing }, data });
    } else {
      const id = randomUUID();
      itemIds.set(it.code, id);
      newItems.push({ id, tenantId, dataSourceId, sourceKey: it.code, ...data });
    }
  }
  await createChunked(newItems, (data) => tx.item.createMany({ data }));
  if (newRecords.length > 0) await analyze(tx, "Party", "Item", "ItemGroup");

  // Vouchers (including opening stock and settlements). Ids are allocated up front so lines,
  // returns and allocations can reference vouchers created in the same batch.
  step("vouchers");
  const voucherIds = new Map((await tx.voucher.findMany({ where: { dataSourceId }, select: { id: true, sourceKey: true } })).map((v) => [v.sourceKey, v.id]));
  const existingKeys = new Set(voucherIds.keys());
  const idFor = (key: string) => {
    let id = voucherIds.get(key);
    if (!id) {
      id = randomUUID();
      voucherIds.set(key, id);
    }
    return id;
  };
  // Allocate ids for everything in the bundle first, so returns, allocations and charges can
  // point at vouchers created in this same batch regardless of file order.
  bundle.vouchers.forEach((v) => idFor(v.key));
  bundle.settlements.forEach((st) => idFor(st.key));
  const headers: { id: string; isNew: boolean; data: Omit<Prisma.VoucherCreateManyInput, "id" | "tenantId" | "dataSourceId" | "sourceKey"> & { sourceKey: string } }[] = [];
  const lines: Prisma.VoucherLineCreateManyInput[] = [];
  const allocations: Prisma.BillAllocationCreateManyInput[] = [];
  const rewritten: string[] = [];
  const zero = new D(0);

  const batchIds = await upsertBatches(tx, tenantId, bundle, itemIds);
  const opening = openingStockDraft(bundle);
  if (opening && isWrite("opening_stock", opening.key)) {
    const isNew = !existingKeys.has(opening.key);
    const id = idFor(opening.key);
    const value = opening.lines.reduce((s, l) => s.add(l.value ?? zero), zero);
    headers.push({
      id,
      isNew,
      data: {
        sourceKey: opening.key,
        sourceRecordId: isWrite("opening_stock", opening.key)!,
        type: "opening_stock",
        number: "OPENING",
        date: new Date(opening.date),
        grossAmount: value,
        taxableAmount: value,
        totalInclTax: value
      }
    });
    if (!isNew) rewritten.push(id);
    opening.lines.forEach((l, n) =>
      lines.push({
        tenantId,
        voucherId: id,
        lineNo: n + 1,
        itemId: itemIds.get(l.itemCode)!,
        qty: l.qty,
        rate: l.value ? l.value.div(l.qty).toDecimalPlaces(4, D.ROUND_HALF_UP) : zero,
        grossAmount: l.value ?? zero,
        taxableAmount: l.value ?? zero,
        costAmount: l.value,
        costBasis: l.value ? "source_provided" : "unknown",
        batchId: l.batchNo ? (batchIds.get(`${itemIds.get(l.itemCode)}|${l.batchNo}`) ?? null) : null
      })
    );
  }

  for (const v of bundle.vouchers) {
    const recordId = isWrite("voucher", v.key);
    if (!recordId) continue;
    const isNew = !existingKeys.has(v.key);
    const id = idFor(v.key);
    if (!isNew) rewritten.push(id);
    const sum = (field: "grossAmount" | "discountAmount" | "taxableAmount" | "taxAmount") => v.lines.reduce((s, l) => s.add(l[field]), zero);
    const originalType = v.type === "sales_return" ? "sales_invoice" : v.type === "purchase_return" ? "purchase_invoice" : null;
    headers.push({
      id,
      isNew,
      data: {
        sourceKey: v.key,
        sourceRecordId: recordId,
        sourceVersion: (plan.current.get(`voucher|${v.key}`)?.version ?? 0) + 1,
        type: v.type,
        number: v.number,
        postingSeq: v.seq,
        date: new Date(v.date),
        partyId: partyIds.get(v.partyCode)!,
        dueDate: v.dueDate ? new Date(v.dueDate) : null,
        channel: v.channel,
        orderRef: v.orderRef,
        grossAmount: sum("grossAmount"),
        discountAmount: sum("discountAmount"),
        taxableAmount: sum("taxableAmount"),
        taxAmount: sum("taxAmount"),
        roundOff: v.adjustment ?? zero,
        totalInclTax: sum("taxableAmount").add(sum("taxAmount")).add(v.adjustment ?? zero),
        status: "active",
        originalVoucherId: originalType && v.originalNumber ? (voucherIds.get(`${originalType}|${v.originalNumber}`) ?? null) : null
      }
    });
    for (const l of v.lines) {
      lines.push({
        tenantId,
        voucherId: id,
        lineNo: l.lineNo,
        itemId: itemIds.get(l.itemCode)!,
        qty: l.qty,
        rate: l.rate,
        grossAmount: l.grossAmount,
        discountAmount: l.discountAmount,
        taxableAmount: l.taxableAmount,
        taxRate: l.taxRate,
        taxAmount: l.taxAmount,
        costBasis: "unknown",
        batchId: l.batchNo ? (batchIds.get(`${itemIds.get(l.itemCode)}|${l.batchNo}`) ?? null) : null
      });
    }
  }

  for (const s of bundle.settlements) {
    const recordId = isWrite("settlement", s.key);
    if (!recordId) continue;
    const isNew = !existingKeys.has(s.key);
    const id = idFor(s.key);
    if (!isNew) rewritten.push(id);
    const total = s.allocations.reduce((sum, a) => sum.add(a.amount), zero);
    headers.push({
      id,
      isNew,
      data: {
        sourceKey: s.key,
        sourceRecordId: recordId,
        sourceVersion: (plan.current.get(`settlement|${s.key}`)?.version ?? 0) + 1,
        type: s.type,
        number: s.number,
        date: new Date(s.date),
        partyId: partyIds.get(s.partyCode)!,
        grossAmount: zero,
        taxableAmount: zero,
        totalInclTax: total,
        status: "active"
      }
    });
    const billType = s.type === "receipt" ? "sales_invoice" : "purchase_invoice";
    for (const a of s.allocations) {
      const billId = voucherIds.get(`${billType}|${a.againstNumber}`);
      if (billId) allocations.push({ tenantId, settlementVoucherId: id, billVoucherId: billId, amount: a.amount });
    }
  }

  // Changed vouchers: rewrite in place (stable ids keep allocations and links valid).
  for (let i = 0; i < rewritten.length; i += CHUNK) {
    const ids = rewritten.slice(i, i + CHUNK);
    await tx.voucherLine.deleteMany({ where: { voucherId: { in: ids } } });
    await tx.billAllocation.deleteMany({ where: { settlementVoucherId: { in: ids } } });
  }
  for (const h of headers.filter((h) => !h.isNew)) {
    await tx.voucher.update({ where: { id: h.id }, data: h.data });
  }
  await bulkInsert(
    tx,
    tenantId,
    "Voucher",
    COLUMNS.Voucher,
    headers
      .filter((h) => h.isNew)
      .map((h) => ({
        dueDate: null,
        channel: null,
        orderRef: null,
        partyId: null,
        originalVoucherId: null,
        postingSeq: null,
        sourceVersion: 1,
        discountAmount: zero,
        taxAmount: zero,
        roundOff: zero,
        status: "active",
        ...h.data,
        id: h.id,
        tenantId,
        dataSourceId,
        updatedAt: now
      }))
  );
  if (headers.some((h) => h.isNew)) await analyze(tx, "Voucher");
  step("lines");
  await bulkInsert(
    tx,
    tenantId,
    "VoucherLine",
    COLUMNS.VoucherLine,
    lines.map((l) => ({ discountAmount: zero, taxRate: zero, taxAmount: zero, costAmount: null, ...l, id: randomUUID() }))
  );
  await bulkInsert(tx, tenantId, "BillAllocation", COLUMNS.BillAllocation, allocations.map((a) => ({ ...a, id: randomUUID() })));
  if (newRecords.length > 0) await analyze(tx, "VoucherLine", "BillAllocation");

  // Channel charges.
  step("charges");
  const chargeIds = new Map((await tx.channelCharge.findMany({ where: { dataSourceId }, select: { id: true, sourceKey: true } })).map((c) => [c.sourceKey, c.id]));
  const newCharges: Prisma.ChannelChargeCreateManyInput[] = [];
  for (const c of bundle.charges) {
    const recordId = isWrite("channel_charge", c.key);
    if (!recordId) continue;
    const data = {
      sourceRecordId: recordId,
      channel: c.channel,
      settlementRef: c.settlementRef,
      settlementDate: new Date(c.settlementDate),
      orderVoucherId: c.orderNumber ? (voucherIds.get(`sales_invoice|${c.orderNumber}`) ?? null) : null,
      orderRef: c.orderNumber,
      chargeType: c.chargeType,
      amount: c.amount,
      gstAmount: c.gstAmount,
      isTaxWithheld: c.isTaxWithheld,
      allocationBasis: c.orderNumber ? null : "period",
      status: "active" as const
    };
    const existing = chargeIds.get(c.key);
    if (existing) await tx.channelCharge.update({ where: { id: existing }, data });
    else newCharges.push({ id: randomUUID(), tenantId, dataSourceId, sourceKey: c.key, ...data });
  }
  await bulkInsert(tx, tenantId, "ChannelCharge", COLUMNS.ChannelCharge, newCharges.map((c) => ({ ...c, updatedAt: now })));
  if (newCharges.length > 0) await analyze(tx, "ChannelCharge");

  // Customer purchase orders. Their items and parties live in the books, possibly another source.
  step("customer_orders");
  if (bundle.customerOrders.length > 0) {
    const masters = await tenantMasters(tx, bundle);
    const orderIds = new Map((await tx.customerOrderLine.findMany({ where: { dataSourceId }, select: { id: true, sourceKey: true } })).map((o) => [o.sourceKey, o.id]));
    const newOrders: Prisma.CustomerOrderLineCreateManyInput[] = [];
    for (const o of bundle.customerOrders) {
      const recordId = isWrite("customer_order", o.key);
      if (!recordId) continue;
      const data = {
        sourceRecordId: recordId,
        channel: o.channel,
        poNumber: o.poNumber,
        poDate: new Date(o.poDate),
        partyId: masters.parties.get(o.partyCode)!,
        itemId: masters.items.get(o.itemCode)!,
        qtyOrdered: o.qtyOrdered,
        qtySupplied: o.qtySupplied,
        unitPrice: o.unitPrice,
        grnDate: o.grnDate ? new Date(o.grnDate) : null,
        status: "active" as const
      };
      const existing = orderIds.get(o.key);
      if (existing) await tx.customerOrderLine.update({ where: { id: existing }, data });
      else newOrders.push({ id: randomUUID(), tenantId, dataSourceId, sourceKey: o.key, ...data });
    }
    await createChunked(newOrders, (data) => tx.customerOrderLine.createMany({ data }));
    if (newOrders.length > 0) await analyze(tx, "CustomerOrderLine");
  }

  // Records the source has again after an earlier file dropped them: unchanged content, so no
  // new version was written above, but they must become active again.
  step("deletions");
  const present = new Set([...bundle.vouchers.map((v) => v.key), ...bundle.settlements.map((st) => st.key), ...bundle.charges.map((c) => c.key), ...bundle.customerOrders.map((o) => o.key)]);
  const restoreVouchers = (await tx.voucher.findMany({ where: { dataSourceId, status: "deleted_at_source" }, select: { sourceKey: true } }))
    .map((v) => v.sourceKey)
    .filter((key) => present.has(key));
  if (restoreVouchers.length > 0) {
    await tx.voucher.updateMany({ where: { dataSourceId, sourceKey: { in: restoreVouchers } }, data: { status: "active" } });
  }
  const restoreCharges = (await tx.channelCharge.findMany({ where: { dataSourceId, status: "deleted_at_source" }, select: { sourceKey: true } }))
    .map((c) => c.sourceKey)
    .filter((key) => present.has(key));
  if (restoreCharges.length > 0) {
    await tx.channelCharge.updateMany({ where: { dataSourceId, sourceKey: { in: restoreCharges } }, data: { status: "active" } });
  }
  // Records the source no longer has for this period.
  for (let i = 0; i < plan.deletedVoucherKeys.length; i += CHUNK) {
    await tx.voucher.updateMany({ where: { dataSourceId, sourceKey: { in: plan.deletedVoucherKeys.slice(i, i + CHUNK) } }, data: { status: "deleted_at_source" } });
  }
  const restoreOrders = (await tx.customerOrderLine.findMany({ where: { dataSourceId, status: "deleted_at_source" }, select: { sourceKey: true } }))
    .map((o) => o.sourceKey)
    .filter((key) => present.has(key));
  if (restoreOrders.length > 0) {
    await tx.customerOrderLine.updateMany({ where: { dataSourceId, sourceKey: { in: restoreOrders } }, data: { status: "active" } });
  }
  for (let i = 0; i < plan.deletedOrderKeys.length; i += CHUNK) {
    await tx.customerOrderLine.updateMany({ where: { dataSourceId, sourceKey: { in: plan.deletedOrderKeys.slice(i, i + CHUNK) } }, data: { status: "deleted_at_source" } });
  }
  for (let i = 0; i < plan.deletedChargeKeys.length; i += CHUNK) {
    await tx.channelCharge.updateMany({ where: { dataSourceId, sourceKey: { in: plan.deletedChargeKeys.slice(i, i + CHUNK) } }, data: { status: "deleted_at_source" } });
  }

  // Point-in-time snapshots: replace those for the same dates.
  step("snapshots");
  const stockDates = [...new Set(bundle.stockSnapshots.map((s) => s.asOf))].map((d) => new Date(d));
  if (stockDates.length > 0) await tx.stockSnapshot.deleteMany({ where: { dataSourceId, asOf: { in: stockDates } } });
  await createChunked(
    bundle.stockSnapshots.map((s) => ({
      tenantId,
      dataSourceId,
      importBatchId: batchId,
      itemId: itemIds.get(s.itemCode)!,
      asOf: new Date(s.asOf),
      qty: s.qty,
      value: s.value,
      valuationMethod: s.valuationMethod
    })),
    (data) => tx.stockSnapshot.createMany({ data })
  );
  const billDates = [...new Set(bundle.outstanding.map((o) => o.asOf))].map((d) => new Date(d));
  if (billDates.length > 0) await tx.outstandingSnapshot.deleteMany({ where: { dataSourceId, asOf: { in: billDates } } });
  await createChunked(
    bundle.outstanding.map((o) => ({
      tenantId,
      dataSourceId,
      importBatchId: batchId,
      partyId: partyIds.get(o.partyCode)!,
      side: o.side,
      billRef: o.billRef,
      billDate: new Date(o.billDate),
      dueDate: o.dueDate ? new Date(o.dueDate) : null,
      amountInclTax: o.amountInclTax,
      pendingInclTax: o.pendingInclTax,
      asOf: new Date(o.asOf)
    })),
    (data) => tx.outstandingSnapshot.createMany({ data })
  );
}

/** Column types for bulk inserts; must match the migration (prisma/migrations). */
const COLUMNS = {
  SourceRecord: {
    id: "text",
    tenantId: "text",
    dataSourceId: "text",
    importBatchId: "text",
    entity: "text",
    sourceKey: "text",
    version: "int",
    contentHash: "text",
    payload: "jsonb"
  },
  Voucher: {
    id: "text",
    tenantId: "text",
    dataSourceId: "text",
    sourceKey: "text",
    sourceVersion: "int",
    sourceRecordId: "text",
    type: '"VoucherType"',
    number: "text",
    postingSeq: "int",
    date: "date",
    partyId: "text",
    dueDate: "date",
    channel: "text",
    orderRef: "text",
    grossAmount: "numeric",
    discountAmount: "numeric",
    taxableAmount: "numeric",
    taxAmount: "numeric",
    roundOff: "numeric",
    totalInclTax: "numeric",
    status: '"VoucherStatus"',
    originalVoucherId: "text",
    updatedAt: "timestamp(3)"
  },
  VoucherLine: {
    id: "text",
    tenantId: "text",
    voucherId: "text",
    lineNo: "int",
    itemId: "text",
    qty: "numeric",
    rate: "numeric",
    grossAmount: "numeric",
    discountAmount: "numeric",
    taxableAmount: "numeric",
    taxRate: "numeric",
    taxAmount: "numeric",
    costAmount: "numeric",
    costBasis: '"CostBasis"',
    batchId: "text"
  },
  BillAllocation: { id: "text", tenantId: "text", settlementVoucherId: "text", billVoucherId: "text", amount: "numeric" },
  ChannelCharge: {
    id: "text",
    tenantId: "text",
    dataSourceId: "text",
    sourceKey: "text",
    sourceRecordId: "text",
    channel: "text",
    settlementRef: "text",
    settlementDate: "date",
    orderVoucherId: "text",
    orderRef: "text",
    chargeType: "text",
    amount: "numeric",
    gstAmount: "numeric",
    isTaxWithheld: "boolean",
    allocationBasis: "text",
    status: '"VoucherStatus"',
    updatedAt: "timestamp(3)"
  }
} as const;

async function reconcileDatabase(tx: TenantTx, tenantId: string, dataSourceId: string, bundle: ParsedBundle): Promise<DbReconciliation> {
  const out: DbReconciliation = [];
  if (bundle.controlTotals.length === 0) return out;
  const { from, to } = bundle.controlTotals[0];
  // Explicit joins (raw SQL, so tenantId is passed explicitly): a plan that walks the
  // (tenantId, voucherId) index regardless of how fresh the planner statistics are.
  const lines = await tx.$queryRaw<{ type: string; taxable: Decimal | null; tax: Decimal | null }[]>`
    SELECT v."type"::text AS type, SUM(l."taxableAmount") AS taxable, SUM(l."taxAmount") AS tax
    FROM "Voucher" v
    JOIN "VoucherLine" l ON l."tenantId" = v."tenantId" AND l."voucherId" = v."id"
    WHERE v."tenantId" = ${tenantId} AND v."dataSourceId" = ${dataSourceId} AND v."status" = 'active'
      AND v."date" BETWEEN ${from}::date AND ${to}::date
    GROUP BY v."type"`;
  const headers = await tx.$queryRaw<{ type: string; total: Decimal | null }[]>`
    SELECT "type"::text AS type, SUM("totalInclTax") AS total
    FROM "Voucher"
    WHERE "tenantId" = ${tenantId} AND "dataSourceId" = ${dataSourceId} AND "status" = 'active'
      AND "date" BETWEEN ${from}::date AND ${to}::date AND "type" IN ('receipt', 'payment')
    GROUP BY "type"`;
  const [charges] = await tx.$queryRaw<{ total: Decimal | null }[]>`
    SELECT SUM("amount") AS total FROM "ChannelCharge"
    WHERE "tenantId" = ${tenantId} AND "dataSourceId" = ${dataSourceId} AND "status" = 'active'
      AND "settlementDate" BETWEEN ${from}::date AND ${to}::date`;
  const line = (type: string) => lines.find((r) => r.type === type);
  const header = (type: string) => headers.find((r) => r.type === type)?.total ?? null;
  const actual: Record<string, Decimal | null> = {
    sales_taxable: line("sales_invoice")?.taxable ?? null,
    sales_tax: line("sales_invoice")?.tax ?? null,
    sales_return_taxable: line("sales_return")?.taxable ?? null,
    purchase_taxable: line("purchase_invoice")?.taxable ?? null,
    purchase_return_taxable: line("purchase_return")?.taxable ?? null,
    receipts: header("receipt"),
    payments: header("payment"),
    channel_charges: charges?.total ?? null
  };
  for (const control of bundle.controlTotals) {
    const inDatabase = new D(actual[control.metric] ?? 0);
    out.push({ metric: control.metric, expected: control.value.toFixed(2), inDatabase: inDatabase.toFixed(2), ok: inDatabase.sub(control.value).abs().lte("0.01") });
  }
  return out;
}

/**
 * Compares the rebuilt ledger with the closing stock the source reported. Differences are
 * reported, not fatal: a source may value stock differently (e.g. Tally FIFO vs our WAC).
 */
async function checkStockAgainstSource(tx: TenantTx, tenantId: string, batchId: string): Promise<StockCheck> {
  const rows = await tx.$queryRaw<{ code: string; sourceQty: Decimal; sourceValue: Decimal | null; ledgerQty: Decimal | null; ledgerValue: Decimal | null }[]>`
    SELECT i."sourceKey" AS code, s."qty" AS "sourceQty", s."value" AS "sourceValue", m."runningQty" AS "ledgerQty", m."runningValue" AS "ledgerValue"
    FROM "StockSnapshot" s
    JOIN "Item" i ON i."tenantId" = s."tenantId" AND i."id" = s."itemId"
    LEFT JOIN LATERAL (
      SELECT "runningQty", "runningValue" FROM "StockMovement" m
      WHERE m."tenantId" = s."tenantId" AND m."itemId" = s."itemId" AND m."date" <= s."asOf"
      ORDER BY m."seq" DESC LIMIT 1
    ) m ON true
    WHERE s."tenantId" = ${tenantId} AND s."importBatchId" = ${batchId}`;
  const check: StockCheck = { items: rows.length, qtyMismatches: 0, valueMismatches: 0, valueUnknownInLedger: 0, examples: [] };
  for (const row of rows) {
    const ledgerQty = new D(row.ledgerQty ?? 0);
    if (!ledgerQty.eq(row.sourceQty)) {
      check.qtyMismatches += 1;
      if (check.examples.length < 5) check.examples.push(`${row.code}: qty ${ledgerQty.toFixed()} vs source ${new D(row.sourceQty).toFixed()}`);
      continue;
    }
    if (row.sourceValue === null) continue;
    if (row.ledgerValue === null) {
      check.valueUnknownInLedger += 1;
    } else if (new D(row.ledgerValue).sub(row.sourceValue).abs().gt(1)) {
      check.valueMismatches += 1;
      if (check.examples.length < 5) check.examples.push(`${row.code}: value ${new D(row.ledgerValue).toFixed(2)} vs source ${new D(row.sourceValue).toFixed(2)}`);
    }
  }
  return check;
}

async function createChunked<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await write(rows.slice(i, i + CHUNK));
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, v) => (v instanceof D ? v.toFixed() : v))) as Prisma.InputJsonValue;
}
