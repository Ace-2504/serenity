/**
 * A demo profile describes one fictional business for the generator: catalogue, customer
 * segments, sales channels, suppliers and the problems deliberately planted in its data.
 * Profiles are per domain pack (stationery now, pharmacy later); the engine is shared.
 *
 * Every number here is an illustrative assumption for synthetic data, not a statement of
 * any real platform's fees, any real business's margins, or any tax rate.
 */

export type ChargeRule = {
  chargeType: string;
  /** pct_of_order: % of order value incl. GST; per_unit / per_order: fixed paise. */
  basis: "pct_of_order" | "per_unit" | "per_order";
  value: number;
  /** GST charged on the fee, % of the fee. */
  gstPct: number;
};

export type ChannelSpec = {
  id: string;
  label: string;
  /** Charges deducted when an order is settled (marketplaces, payment gateways). */
  orderCharges: ChargeRule[];
  /** Extra charges when an order is returned. */
  returnCharges: ChargeRule[];
  /** Tax withheld by the operator, % (TCS on taxable value; TDS on order value incl. GST). */
  taxWithheld: { tcsPct: number; tdsPct: number } | null;
  /** For platform settlement: payout every N days, settling orders older than the return window. */
  payout?: { cycleDays: number; deliveryDays: number; returnWindowDays: number };
};

export type Billing = "credit" | "prepaid" | "cash" | "platform";
export type PriceTier = "wholesale" | "retail" | "platform";

export type SegmentSpec = {
  id: string;
  label: string;
  channel: string;
  count: number;
  codePrefix: string;
  name: (n: number, city: string) => string;
  billing: Billing;
  priceTier: PriceTier;
  /** True when buyers are not identifiable to the seller (counter cash, marketplaces). */
  anonymousBuyers: boolean;
  ordersPerWeek: [number, number];
  /** Multipliers by season name (from the domain pack); months in no listed season use offSeasonFactor. */
  seasonBoost: Record<string, number>;
  offSeasonFactor: number;
  groupWeights: Record<string, number>;
  linesPerOrder: [number, number];
  qty: [number, number];
  qtyStep: number;
  /** Spread of customer size: lognormal sigma applied to quantities. */
  sizeSigma: number;
  discountPct: [number, number];
  creditDays: number;
  /** Mean extra days beyond credit terms, drawn per customer from this range. */
  payDelayMean: [number, number];
  returnRate: number;
  hasContact: boolean;
};

export type GroupSpec = {
  name: string;
  /** Prefix for item codes in this group; must be unique across groups. */
  codePrefix: string;
  count: number;
  hsnCode: string;
  gstPct: number;
  costPaise: [number, number];
  markup: [number, number];
  nouns: string[];
  variants: string[];
  segmentTag: string;
};

export type DemoProfile = {
  packId: string;
  company: string;
  start: string;
  end: string;
  cities: { name: string; stateCode: string }[];
  brands: string[];
  groups: GroupSpec[];
  /** Retail (MRP-style) price as a multiple of the wholesale price. */
  retailFactor: number;
  /** Platform buy price as % off retail (quick commerce outright purchase). */
  platformDiscountPct: number;
  priceRevision: { month: number; pct: number };
  costInflationPctPerYear: number;
  channels: ChannelSpec[];
  segments: SegmentSpec[];
  suppliers: { count: number; leadDays: [number, number]; creditDays: number[]; tradeDiscountPct: [number, number] };
  inventory: { coverDays: number; reorderSafety: number; openingCoverDays: number; caseSize: number };
  plant: {
    slowMovers: { groups: string[]; count: number; bulkBuyOn: string; stopSellingFrom: string; bulkQty: [number, number] };
    lapsingKeyCustomers: { segment: string; count: number; stopFrom: string };
    schoolsNotReordering: { segment: string; count: number; orderedBetween: [string, string]; stopFrom: string };
    marginErosion: { group: string; costIncreasePct: number; from: string; extraDiscountPct: number; discountFrom: string; discountSegment: string };
    slowPayers: { segment: string; count: number; from: string; extraDelayDays: [number, number] };
    stockoutItems: { groups: string[]; count: number; reorderSafety: number; coverDays: number };
    missingOpeningValue: { count: number };
  };
};
