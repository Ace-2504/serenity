import { NextResponse, type NextRequest } from "next/server";
import { CAN_IMPORT } from "@/server/bi/context";
import { importErrorResponse, jsonError, requireBi } from "@/server/bi/api";
import { ChannelFileError, convertChannelFiles } from "@/server/adapters/marketplace";
import { TallyXmlError } from "@/server/adapters/tally/collect";
import { tallyToTemplate } from "@/server/adapters/tally/convert";
import { stageImport } from "@/server/ingest/pipeline";
import type { UploadedFile } from "@/server/ingest/parse";
import { TEMPLATE_FILES } from "@/server/ingest/template";
import { LIMITS, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 12;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

const TEMPLATE_NAMES = new Set<string>(Object.values(TEMPLATE_FILES));

/**
 * Stage an upload: multipart form with files under "files". Accepted: template CSV files;
 * Tally XML exports (masters and/or Day Book); or one platform's files (Amazon settlement
 * report, Meesho payments, quick-commerce PO/GRN files with an optional sku_map.csv), with
 * optional "channel" and "party_code" fields. Non-template files are converted first.
 */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const limited = LIMITS.importsPerUser.take(bi.userId);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec, "Too many uploads in the last hour; try again later");
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

  const lower = (f: UploadedFile) => f.name.split(/[\\/]/).pop()!.toLowerCase();
  const xml = files.filter((f) => lower(f).endsWith(".xml"));
  const template = files.filter((f) => TEMPLATE_NAMES.has(lower(f)));
  const route = xml.length > 0 ? "tally" : template.length === files.length ? "template" : "channel";
  if ((route === "tally" && xml.length !== files.length) || (route === "channel" && template.length > 0)) {
    return jsonError(400, "INVALID_INPUT", "Upload one kind of file at a time: template CSV files, Tally XML exports, or one platform's files");
  }
  let adapter: Parameters<typeof stageImport>[1]["adapter"];
  let toStage = files;
  let kind: "csv_template" | "tally_xml" | "marketplace_file" = "csv_template";
  let sourceName = "Template upload";
  try {
    if (route === "tally") {
      const conversion = tallyToTemplate(xml);
      toStage = conversion.files;
      kind = "tally_xml";
      sourceName = "Tally XML export";
      adapter = {
        issues: conversion.issues,
        summary: {
          name: "Tally XML",
          verified: false,
          note: "Converted by the Tally XML adapter, which is tested on sample files only and not yet against a real TallyPrime export. Check the totals against Tally's registers.",
          details: conversion.summary
        }
      };
    } else if (route === "channel") {
      const [items, parties] = await Promise.all([bi.db.item.findMany({ select: { sourceKey: true } }), bi.db.party.findMany({ select: { sourceKey: true, name: true, kind: true } })]);
      const field = (name: string) => {
        const v = form.get(name);
        return typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : undefined;
      };
      const conversion = convertChannelFiles(files, {
        channel: field("channel")?.toLowerCase(),
        partyCode: field("party_code"),
        itemCodes: new Set(items.map((i) => i.sourceKey)),
        parties: parties.map((p) => ({ code: p.sourceKey, name: p.name, kind: p.kind }))
      });
      toStage = conversion.files;
      kind = "marketplace_file";
      sourceName = conversion.sourceName;
      adapter = { issues: conversion.issues, summary: conversion.summary };
    }
  } catch (error) {
    if (error instanceof TallyXmlError || error instanceof ChannelFileError) return jsonError(400, "INVALID_INPUT", error.message);
    throw error;
  }
  // One data source per kind and platform, so each keeps its own period and deletions.
  const source =
    (await bi.db.dataSource.findFirst({ where: { kind, name: sourceName } })) ??
    (await bi.db.dataSource.create({ data: { tenantId: bi.tenant.id, kind, name: sourceName } }));
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
