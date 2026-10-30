import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readTable, TableError } from "@/server/adapters/marketplace/table";
import { XlsxError } from "@/server/adapters/xlsx";
import { convertRegisters, headerSignature, RegisterError, registerMappingSchema } from "@/server/adapters/register";
import { REGISTER_SOURCE_NAME, registerFiles } from "@/server/adapters/register/files";
import { importErrorResponse, jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { stageImport } from "@/server/ingest/pipeline";
import { LIMITS, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const mappingsSchema = z.array(registerMappingSchema).min(1).max(8);

/** Converts registers with the confirmed column mappings and stages them for review. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const limited = LIMITS.importsPerUser.take(bi.userId);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec, "Too many uploads in the last hour; try again later");
  if (bi.tenant.isDemo) return jsonError(409, "DEMO_BUSINESS", "This is a demo business. Create your own business to upload real data.");
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, "INVALID_INPUT", "Expected a multipart form upload");
  const files = await registerFiles(form);
  if (typeof files === "string") return jsonError(400, "INVALID_INPUT", files);
  let mappings: z.infer<typeof mappingsSchema>;
  try {
    mappings = mappingsSchema.parse(JSON.parse(String(form.get("mappings") ?? "[]")));
  } catch {
    return jsonError(400, "INVALID_INPUT", "Confirm the column mapping for each file");
  }
  let conversion;
  try {
    conversion = convertRegisters(files, mappings);
  } catch (error) {
    if (error instanceof RegisterError || error instanceof TableError || error instanceof XlsxError) return jsonError(400, "INVALID_INPUT", error.message);
    throw error;
  }
  const source =
    (await bi.db.dataSource.findFirst({ where: { kind: "busy_excel", name: REGISTER_SOURCE_NAME } })) ??
    (await bi.db.dataSource.create({ data: { tenantId: bi.tenant.id, kind: "busy_excel", name: REGISTER_SOURCE_NAME } }));
  // Remember each confirmed mapping by the file's headers, for next month's upload.
  const saved = { ...(((source.settings as { savedMappings?: Record<string, unknown> } | null)?.savedMappings ?? {}) as Record<string, unknown>) };
  for (const m of mappings) {
    const file = files.find((f) => f.name === m.file);
    if (file) saved[headerSignature(readTable(file).header)] = { voucherType: m.voucherType, columns: m.columns };
  }
  await bi.db.dataSource.update({ where: { id: source.id }, data: { settings: { savedMappings: saved } as object } });
  try {
    const staged = await stageImport(bi.db, {
      tenantId: bi.tenant.id,
      dataSourceId: source.id,
      files: conversion.files,
      userId: bi.userId,
      adapter: {
        issues: conversion.issues,
        summary: {
          name: "Spreadsheet registers",
          verified: false,
          note: "Read from register spreadsheets through the column mapping you confirmed. BUSY's exact export layout has not been checked against real files: compare the totals with BUSY's own register totals.",
          details: conversion.summary
        }
      }
    });
    return NextResponse.json(staged, { status: staged.status === "duplicate" ? 200 : 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}
