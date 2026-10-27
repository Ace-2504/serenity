export type Severity = "high" | "medium" | "low";

/** Everything the owner needs to judge a finding (the seven questions in the brief). */
export type FindingDraft = {
  ruleId: string;
  dedupeKey: string;
  entityType: "item" | "item_group" | "party" | "channel_item" | "business";
  entityId: string | null;
  entityLabel: string;
  severity: Severity;
  /** 1. What happened (headline). */
  title: string;
  whatHappened: string;
  /** 2. What data supports it. */
  evidence: { facts: { label: string; value: string }[]; table?: { columns: string[]; rows: string[][] } };
  /** 3. Why it matters financially or operationally. */
  whyItMatters: string;
  /** 4. What action to consider. */
  suggestedAction: string;
  /** 5. Estimated financial impact (null when it cannot be calculated honestly). */
  impactInr: number | null;
  impactFormula: string;
  /** 6. Assumptions and uncertainties. */
  assumptions: string[];
  /** 7. How the owner will know whether the action worked. */
  measurePlan: { metric: string; label: string; baseline: number; checkAfterDays: number; successWhen: string; target: number; direction: "decrease" | "increase"; subjects?: string[] };
};

export const severityFor = (impact: number | null, high = 100_000, medium = 20_000): Severity =>
  impact === null ? "medium" : impact >= high ? "high" : impact >= medium ? "medium" : "low";

/** Thresholds for the rules; documented in docs/platform/02-architecture.md and shown with each finding. */
export const RULE_CONFIG = {
  slowMoverMinValue: 10_000,
  slowMoverMaxFindings: 10,
  windowDays: 90,
  marginDropPp: 5,
  minGroupSales: 50_000,
  discountRisePp: 2,
  dsoRiseDays: 7,
  payerDelayRiseDays: 15,
  concentrationTop5: 0.5,
  concentrationSingle: 0.25,
  lapsingMaxFindings: 10,
  stockoutMinDays: 45,
  replenishmentDays: 21,
  channelLossMinInvoices: 5,
  channelLossMaxFindings: 10,
  fillRateTarget: 0.95,
  fillRateMinUnits: 100,
  expiredMinValue: 1_000,
  nearExpiryMinValue: 2_000,
  nearExpiryMaxFindings: 10,
  nearExpiryCheckDays: 45
} as const;
