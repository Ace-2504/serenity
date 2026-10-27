import { NextResponse, type NextRequest } from "next/server";
import { TEMPLATE_EXAMPLES } from "@/server/ingest/template-docs";

export const dynamic = "force-static";

/** A template CSV with its header row and one example row. */
export function GET(_request: NextRequest, { params }: { params: { file: string } }) {
  const example = TEMPLATE_EXAMPLES[params.file];
  if (!example) return NextResponse.json({ code: "NOT_FOUND", message: "Unknown template file" }, { status: 404 });
  return new NextResponse(example, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${params.file}"` }
  });
}

export function generateStaticParams() {
  return Object.keys(TEMPLATE_EXAMPLES).map((file) => ({ file }));
}
