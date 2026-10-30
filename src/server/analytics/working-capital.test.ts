import { describe, expect, it } from "vitest";
import { ageBills, ageBucket, cashConversionCycle, cashFromFasterCollection, cashFromSlowStock, daysMetric, type OpenBill } from "@/server/analytics/working-capital";

const bill = (daysOverdue: number, pending = 100): OpenBill => ({ billId: "b", partyId: "p", number: "n", billDate: "2026-01-01", dueDate: "2026-02-01", pending, daysOverdue });

describe("working-capital formulas", () => {
  it("buckets bills by days past due", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, 400].map((d) => ageBucket(bill(d)))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const aged = ageBills([bill(0, 10), bill(45, 20), bill(45, 5), bill(200, 1)]);
    expect(aged.map((a) => [a.amount, a.bills])).toEqual([[10, 1], [0, 0], [25, 2], [0, 0], [1, 1]]);
  });

  it("computes days from average balance over volume, and refuses without volume", () => {
    expect(daysMetric(30_000, 365_000, 365, "credit sales")).toEqual({ value: 30, status: "ok" });
    expect(daysMetric(30_000, 0, 365, "credit sales").status).toBe("unavailable");
  });

  it("builds the cash conversion cycle only from available parts", () => {
    expect(cashConversionCycle({ value: 40, status: "ok" }, { value: 35, status: "ok" }, { value: 45, status: "ok" })).toEqual({ value: 30, status: "ok", note: undefined });
    expect(cashConversionCycle({ value: 40, status: "partial" }, { value: 35, status: "ok" }, { value: 45, status: "ok" }).status).toBe("partial");
    expect(cashConversionCycle({ value: null, status: "unavailable" }, { value: 35, status: "ok" }, { value: 45, status: "ok" }).value).toBeNull();
  });

  it("estimates cash released by faster collection, never negative", () => {
    expect(cashFromFasterCollection(1_000_000, 60, 45)).toBeCloseTo(250_000);
    expect(cashFromFasterCollection(1_000_000, 40, 45)).toBe(0);
  });

  it("estimates cash from clearing slow stock with the owner's recovery rate, clamped to 0-100%", () => {
    expect(cashFromSlowStock(100_000, 50, 70)).toBe(35_000);
    expect(cashFromSlowStock(100_000, 150, -10)).toBe(0);
  });
});
