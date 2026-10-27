import { z } from "zod";
import type { DomainPack } from "@/domain/types";

export const stationeryPack: DomainPack = {
  id: "stationery",
  label: "Stationery & school supplies",
  status: "active",
  itemAttributes: z
    .object({
      brand: z.string().min(1).optional(),
      /** e.g. "school", "office", "art" */
      segment: z.string().min(1).optional(),
      packSize: z.string().min(1).optional()
    })
    .strict(),
  batchTracking: "none",
  pricesIncludeTax: false,
  thresholds: {
    slowMovingDays: 90,
    deadStockDays: 180
  },
  seasonality: [
    { name: "Back to school", months: [3, 4, 5, 6] },
    { name: "Board exams", months: [1, 2] },
    { name: "Diwali gifting", months: [10, 11] }
  ],
  campaignPolicy: {
    isPromotable: () => ({ allowed: true })
  },
  glossary: {
    "stock item": "Item",
    party: "Customer or supplier",
    "credit note": "Sales return"
  }
};
