import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Where an order may go next. Cancelling or taking a return puts the goods back in stock. */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: []
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned"
};

export class OrderStatusError extends Error {}

export async function moveOrder(orderId: string, to: OrderStatus) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new OrderStatusError("Order not found");
    if (!NEXT_STATUS[order.status].includes(to)) throw new OrderStatusError(`A ${STATUS_LABELS[order.status].toLowerCase()} order cannot become ${STATUS_LABELS[to].toLowerCase()}`);
    // Only move it if nobody else did in the meantime.
    const moved = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: to } });
    if (moved.count !== 1) throw new OrderStatusError("The order changed while you were looking at it; reload and try again");
    if (to === "cancelled" || to === "returned") {
      for (const item of order.items) {
        await tx.inventoryItem.upsert({ where: { variantId: item.variantId }, update: { stockOnHand: { increment: item.quantity } }, create: { variantId: item.variantId, stockOnHand: item.quantity, lowStockThreshold: 0 } });
      }
    }
    return { from: order.status, to };
  });
}
