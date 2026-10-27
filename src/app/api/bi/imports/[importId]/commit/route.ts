import { NextResponse, type NextRequest } from "next/server";
import { CAN_IMPORT } from "@/server/bi/context";
import { importErrorResponse, requireBi } from "@/server/bi/api";
import { commitImport } from "@/server/ingest/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: { importId: string } }) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  try {
    return NextResponse.json(await commitImport(bi.db, bi.tenant.id, params.importId, { userId: bi.userId }));
  } catch (error) {
    return importErrorResponse(error);
  }
}
