import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRequestRole } from "@/lib/auth";
import { queueWebsiteSync } from "@/server/adapters/website/queue";
import { moveOrder, OrderStatusError } from "@/server/orders/status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ status: z.enum(["packed", "shipped", "delivered", "cancelled", "returned"]) });

/** Moves an order along (packed, shipped, delivered) or cancels it or takes it back. */
export async function POST(request: NextRequest, { params }: { params: { orderId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "order_operations"]);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Unknown status" }, { status: 400 });
  try {
    const result = await moveOrder(params.orderId, parsed.data.status);
    await queueWebsiteSync(`order ${result.to}`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OrderStatusError) return NextResponse.json({ message: error.message }, { status: 409 });
    throw error;
  }
}
