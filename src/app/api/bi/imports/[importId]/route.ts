import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireBi } from "@/server/bi/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { importId: string } }) {
  const bi = await requireBi(request);
  if (bi instanceof NextResponse) return bi;
  const batch = await bi.db.importBatch.findUnique({
    where: { id: params.importId },
    include: { dataSource: { select: { name: true, kind: true } }, issues: { take: 200, orderBy: [{ severity: "asc" }, { code: "asc" }] } }
  });
  if (!batch) return jsonError(404, "NOT_FOUND", "Import not found");
  return NextResponse.json({ batch });
}
