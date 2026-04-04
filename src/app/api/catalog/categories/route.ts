import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: { name: true, slug: true },
    orderBy: { name: "asc" }
  });

  return NextResponse.json({
    items: categories
  });
}