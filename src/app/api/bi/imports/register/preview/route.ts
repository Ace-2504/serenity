import { NextResponse, type NextRequest } from "next/server";
import { TableError } from "@/server/adapters/marketplace/table";
import { XlsxError } from "@/server/adapters/xlsx";
import { headerSignature, previewRegisters, type RegisterMapping } from "@/server/adapters/register";
import { REGISTER_SOURCE_NAME, registerFiles } from "@/server/adapters/register/files";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";

export const dynamic = "force-dynamic";

/** Headers, sample rows and a suggested (or previously saved) column mapping for each register. Saves nothing. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, "INVALID_INPUT", "Expected a multipart form upload");
  const files = await registerFiles(form);
  if (typeof files === "string") return jsonError(400, "INVALID_INPUT", files);
  const source = await bi.db.dataSource.findFirst({ where: { kind: "busy_excel", name: REGISTER_SOURCE_NAME } });
  const saved = ((source?.settings as { savedMappings?: Record<string, Omit<RegisterMapping, "file">> } | null)?.savedMappings ?? {}) as Record<string, Omit<RegisterMapping, "file">>;
  try {
    const previews = previewRegisters(files).map((p) => {
      const remembered = saved[headerSignature(p.header)];
      return { ...p, mapping: remembered ? { ...remembered, file: p.file } : p.suggested, remembered: Boolean(remembered) };
    });
    return NextResponse.json({ files: previews });
  } catch (error) {
    if (error instanceof TableError || error instanceof XlsxError) return jsonError(400, "INVALID_INPUT", error.message);
    throw error;
  }
}
