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
 * Planned second domain (roadmap M12). Defined now so the core is built against
 * batch/expiry and tax-inclusive pricing from the start. Regulatory notes in
 * docs/platform/08-domain-packs.md need legal review before launch.
 */
export const pharmacyPack: DomainPack = {
  id: "pharmacy",
  label: "Retail pharmacy / chemist",
  status: "planned",
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
    }
  },
  glossary: {
    "batch no": "Batch",
    "exp dt": "Expiry date",
    mrp: "Maximum retail price (tax-inclusive)",
    salt: "Composition"
  }
};
