import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { METRICS } from "@/server/metrics/registry";

describe("metric registry", () => {
  it("has a KPI-dictionary entry for every metric the product shows", () => {
    const dictionary = readFileSync(path.join(process.cwd(), "docs/platform/04-kpi-dictionary.md"), "utf8");
    const missing = METRICS.filter((m) => !dictionary.includes(`\`${m.id}\``)).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it("uses unique ids", () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
  });
});
