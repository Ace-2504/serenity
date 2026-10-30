import { describe, expect, it } from "vitest";
import { bucketFor, expectedSales } from "@/server/analytics/expiry";

describe("expiry projection", () => {
  it("sells earlier-expiring batches first and leaves the rest at risk", () => {
    // 2 units a day. Batch A (40 units, 15 days left) sells 30; batch B (100, 60 days) gets 120 - 30 = 90.
    expect(expectedSales([{ qty: 40, days: 15 }, { qty: 100, days: 60 }], 2)).toEqual([30, 90]);
  });

  it("sells nothing from an expired batch, and everything from a batch without a date", () => {
    expect(expectedSales([{ qty: 10, days: -1 }, { qty: 5, days: null }], 1)).toEqual([0, 5]);
  });

  it("treats an item that no longer sells as fully at risk", () => {
    expect(expectedSales([{ qty: 25, days: 200 }], 0)).toEqual([0]);
  });

  it("buckets by days to expiry", () => {
    expect([-5, 0, 30, 31, 90, 91, 181, null].map(bucketFor)).toEqual(["expired", "d30", "d30", "d60", "d90", "d180", "later", "no_expiry"]);
  });
});
