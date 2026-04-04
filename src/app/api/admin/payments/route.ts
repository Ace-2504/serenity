import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isMismatch(payment: {
  status: string;
  order: { paymentStatus: string };
}): boolean {
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
}

export async function GET(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "order_operations", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const mismatchOnly = url.searchParams.get("mismatch") === "1";

  const payments = await prisma.payment.findMany({
    where: statusFilter ? { status: statusFilter as never } : undefined,
    include: {
      order: {
        select: {
          orderNumber: true,
          paymentStatus: true,
          status: true,
          grandTotalInr: true,
          paymentMethod: true
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });

  const normalized = payments.map((payment) => ({
    id: payment.id,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    status: payment.status,
    amountInr: payment.amountInr,
    currency: payment.currency,
    failureCode: payment.failureCode,
    updatedAt: payment.updatedAt,
    order: payment.order,
    mismatch: isMismatch(payment)
  }));

  return NextResponse.json({
    items: mismatchOnly ? normalized.filter((item) => item.mismatch) : normalized
  });
}