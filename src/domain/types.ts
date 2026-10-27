import type { z } from "zod";

/**
 * A domain pack holds everything that differs between trades (stationery, pharmacy, ...).
 * The ledger, ingestion, metrics, findings engine, ML pipeline and assistant are shared core;
 * see docs/platform/08-domain-packs.md.
 */
export type DomainPack = {
  id: string;
  label: string;
  /** "planned" packs type-check and are tested, but cannot be selected for a tenant yet. */
  status: "active" | "planned";
  /** Schema for Item.attributes in this trade. */
  itemAttributes: z.ZodType<Record<string, unknown>>;
  batchTracking: "none" | "optional" | "required";
  /** Default for template imports: are unit rates quoted inclusive of GST? */
  pricesIncludeTax: boolean;
  thresholds: {
    slowMovingDays: number;
    deadStockDays: number;
    /** Only meaningful when batches carry expiry dates. */
    nearExpiryDays?: number;
  };
  /** Demand peaks used by the demo generator and as forecasting features. Assumptions, not facts. */
  seasonality: { name: string; months: number[] }[];
  campaignPolicy: {
    /** Decides whether an item may appear in promotional content. */
    isPromotable(attributes: Record<string, unknown>): { allowed: boolean; reason?: string };
    /**
     * Whether campaigns may carry a general offer (e.g. "10% off your next order"). Off when such an
     * offer would also discount items that may not be promoted (prescription medicines).
     */
    generalOffersAllowed: boolean;
  };
  /**
   * Customer purchase history reveals sensitive facts (health conditions for a pharmacy): such data
   * is never sent to a model server outside this machine or network, whatever LLM_ALLOW_REMOTE says.
   */
  sensitiveCustomerData: boolean;
  /** Trade vocabulary for import header matching and assistant prompts. */
  glossary: Record<string, string>;
};
