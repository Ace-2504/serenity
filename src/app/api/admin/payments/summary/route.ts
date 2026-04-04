import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "order_operations"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const [captured, failed, created, total] = await Promise.all([
    prisma.payment.count({ where: { status: "captured" } }),
    prisma.payment.count({ where: { status: "failed" } }),
    prisma.payment.count({ where: { status: { in: ["created", "authorized"] } } }),
    prisma.payment.count()
  ]);

  const mismatchCandidates = await prisma.payment.findMany({
    include: { order: { select: { paymentStatus: true, status: true } } },
    take: 200,
    orderBy: { updatedAt: "desc" }
  });

  const mismatches = mismatchCandidates.filter((payment) => {
    if (payment.status === "captured") {
      return payment.order.paymentStatus !== "paid";
    }

    if (payment.status === "failed") {
      return payment.order.paymentStatus !== "failed";
    }

    if (payment.status === "created" || payment.status === "authorized") {
      return payment.order.paymentStatus === "paid";
    }

    return false;
  }).length;

  return NextResponse.json({
    total,
    captured,
    failed,
    pending: created,
    mismatches
  });
}