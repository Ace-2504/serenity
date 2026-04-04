import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const [categories, brands] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true }
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true }
    })
  ]);

  return NextResponse.json({ categories, brands });
}
