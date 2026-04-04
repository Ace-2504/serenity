import type { Cart, CartItem, Product, ProductVariant, InventoryItem } from "@prisma/client";

export const COD_MAX_INR = 5000;

type CartItemWithRelations = CartItem & {
  variant: ProductVariant & {
    product: Product;
    inventory: InventoryItem | null;
  };
};

export type CartWithRelations = Cart & {
  items: CartItemWithRelations[];
};

export function calculateCheckoutFromCart(cart: CartWithRelations) {
  const lineItems = cart.items.map((item) => {
    const unit = item.unitPriceSnapshotInr;
    const taxPercent = item.variant.product.gstPercent;
    const lineSubtotal = unit * item.quantity;
    const lineTax = Math.round((lineSubtotal * taxPercent) / 100);
    return {
      itemId: item.id,
      variantId: item.variantId,
      productTitle: item.variant.product.title,
      quantity: item.quantity,
      sku: item.variant.sku,
      unitPriceInr: unit,
      taxPercent,
      lineSubtotalInr: lineSubtotal,
      lineTaxInr: lineTax,
      inStock: (item.variant.inventory?.stockOnHand ?? 0) >= item.quantity
    };
  });

  const subtotalInr = lineItems.reduce((sum, item) => sum + item.lineSubtotalInr, 0);
  const taxTotalInr = lineItems.reduce((sum, item) => sum + item.lineTaxInr, 0);
  const grandTotalInr = subtotalInr + taxTotalInr;
  const stockIssues = lineItems.filter((item) => !item.inStock).map((item) => item.itemId);

  return {
    lineItems,
    stockIssues,
    totals: {
      subtotalInr,
      taxTotalInr,
      shippingInr: 0,
      discountInr: 0,
      grandTotalInr
    },
    codEligibility: {
      allowed: grandTotalInr <= COD_MAX_INR,
      maxInr: COD_MAX_INR
    }
  };
}

export function createPaymentIntentId(userId: string): string {
  return `pi_${userId.slice(0, 8)}_${Date.now()}`;
}