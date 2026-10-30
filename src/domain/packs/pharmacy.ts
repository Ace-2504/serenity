import { z } from "zod";
import type { DomainPack } from "@/domain/types";

const SCHEDULES = ["otc", "G", "H", "H1", "X"] as const;

const pharmacyAttributes = z
  .object({
    productClass: z.enum(["medicine", "device", "wellness", "personal_care"]),
    /** Drugs and Cosmetics Rules schedule; "otc" for non-prescription medicines. */
    schedule: z.enum(SCHEDULES).optional(),
    composition: z.string().min(1).optional(),
    packSize: z.string().min(1).optional()
  })
  .strict()
  .refine((value) => value.productClass !== "medicine" || value.schedule !== undefined, {
    message: "Medicines must declare a schedule (use \"otc\" for non-prescription)",
    path: ["schedule"]
  });

/**
 * Second domain (roadmap M12): batch/expiry stock, MRP-inclusive retail billing and stricter
 * campaign rules. The regulatory notes in docs/platform/08-domain-packs.md have NOT been
 * reviewed by a lawyer; they need that review before a real pharmacy relies on them.
 */
export const pharmacyPack: DomainPack = {
  id: "pharmacy",
  label: "Retail pharmacy / chemist",
  status: "active",
  itemAttributes: pharmacyAttributes,
  batchTracking: "required",
  pricesIncludeTax: true,
  thresholds: {
    slowMovingDays: 60,
    deadStockDays: 120,
    nearExpiryDays: 90
  },
  seasonality: [
    { name: "Monsoon infections", months: [7, 8, 9] },
    { name: "Winter cold & flu", months: [11, 12, 1] }
  ],
  campaignPolicy: {
    isPromotable(attributes) {
      const parsed = pharmacyAttributes.safeParse(attributes);
      if (!parsed.success) {
        return { allowed: false, reason: "Item attributes are incomplete, so promotion is blocked" };
      }

      const { productClass, schedule } = parsed.data;
      if (productClass === "medicine" && schedule !== "otc") {
        return { allowed: false, reason: `Schedule ${schedule} medicines cannot be promoted` };
      }

      return { allowed: true };
    },
    // A discount on "your next order" would also apply to Schedule H medicines.
    generalOffersAllowed: false
  },
  sensitiveCustomerData: true,
  glossary: {
    "batch no": "Batch",
    "exp dt": "Expiry date",
    mrp: "Maximum retail price (tax-inclusive)",
    salt: "Composition"
  }
};
