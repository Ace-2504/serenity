import { NextResponse, type NextRequest } from "next/server";
import { CAN_IMPORT } from "@/server/bi/context";
import { importErrorResponse, jsonError, requireBi } from "@/server/bi/api";
import { TallyXmlError } from "@/server/adapters/tally/collect";
import { tallyToTemplate } from "@/server/adapters/tally/convert";
import { stageImport } from "@/server/ingest/pipeline";
import type { UploadedFile } from "@/server/ingest/parse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 12;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

/**
 * Stage an upload: multipart form with files under "files". Either template CSV files, or
 * Tally XML exports (masters and/or Day Book), which are converted to the template first.
 */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  if (bi.tenant.isDemo) {
    return jsonError(409, "DEMO_BUSINESS", "This is a demo business. Create your own business to upload real data; demo and real data are never mixed.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "INVALID_INPUT", "Expected a multipart form upload");
  }
  const uploads = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (uploads.length === 0) return jsonError(400, "INVALID_INPUT", "Choose the template CSV files to upload");
  if (uploads.length > MAX_FILES) return jsonError(400, "INVALID_INPUT", `Upload at most ${MAX_FILES} files at once`);
  const total = uploads.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) return jsonError(413, "TOO_LARGE", "The upload is larger than 150 MB");
  const files: UploadedFile[] = await Promise.all(uploads.map(async (f) => ({ name: f.name, content: Buffer.from(await f.arrayBuffer()) })));

  const xml = files.filter((f) => f.name.toLowerCase().endsWith(".xml"));
  if (xml.length > 0 && xml.length !== files.length) return jsonError(400, "INVALID_INPUT", "Upload either Tally XML exports or template CSV files, not both");
  let adapter: Parameters<typeof stageImport>[1]["adapter"];
  let toStage = files;
  if (xml.length > 0) {
    try {
      const conversion = tallyToTemplate(xml);
      toStage = conversion.files;
      adapter = {
        issues: conversion.issues,
        summary: {
          name: "Tally XML",
          verified: false,
          note: "Converted by the Tally XML adapter, which is tested on sample files only and not yet against a real TallyPrime export. Check the totals against Tally's registers.",
          details: conversion.summary
        }
      };
    } catch (error) {
      if (error instanceof TallyXmlError) return jsonError(400, "INVALID_INPUT", error.message);
      throw error;
    }
  }
  const kind = xml.length > 0 ? ("tally_xml" as const) : ("csv_template" as const);
  const source =
    (await bi.db.dataSource.findFirst({ where: { kind } })) ??
    (await bi.db.dataSource.create({ data: { tenantId: bi.tenant.id, kind, name: kind === "tally_xml" ? "Tally XML export" : "Template upload" } }));
  try {
    const staged = await stageImport(bi.db, { tenantId: bi.tenant.id, dataSourceId: source.id, files: toStage, userId: bi.userId, adapter });
    return NextResponse.json(staged, { status: staged.status === "duplicate" ? 200 : 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const bi = await requireBi(request);
  if (bi instanceof NextResponse) return bi;
  const batches = await bi.db.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, status: true, fileName: true, periodFrom: true, periodTo: true, createdAt: true, committedAt: true, dataSource: { select: { name: true, kind: true } } }
  });
  return NextResponse.json({ batches });
}
