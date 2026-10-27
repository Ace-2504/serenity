import { describe, expect, it } from "vitest";
import { daysIn, resolvePeriod } from "@/server/analytics/period";

const span = { from: "2024-10-01", to: "2026-09-30" };

describe("resolvePeriod", () => {
  it("defaults to the last 12 months of data", () => {
    expect(resolvePeriod({}, span)).toMatchObject({ preset: "last12", period: { from: "2025-10-01", to: "2026-09-30" } });
  });

  it("uses April-March financial years, clipped to the data", () => {
    expect(resolvePeriod({ period: "fy" }, span)).toMatchObject({ period: { from: "2026-04-01", to: "2026-09-30" }, label: "FY 2026-27" });
    expect(resolvePeriod({ period: "prevfy" }, span)).toMatchObject({ period: { from: "2025-04-01", to: "2026-03-31" }, label: "FY 2025-26" });
  });

  it("accepts a valid custom range and ignores an invalid one", () => {
    expect(resolvePeriod({ period: "custom", from: "2025-01-01", to: "2025-03-31" }, span).period).toEqual({ from: "2025-01-01", to: "2025-03-31" });
    expect(resolvePeriod({ period: "custom", from: "2025-03-31", to: "2025-01-01" }, span).preset).toBe("last12");
    expect(resolvePeriod({ period: "custom", from: "x", to: "2025-01-01" }, span).preset).toBe("last12");
  });

  it("counts days inclusively", () => {
    expect(daysIn({ from: "2025-04-01", to: "2026-03-31" })).toBe(365);
  });
});
