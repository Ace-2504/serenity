import { describe, expect, it } from "vitest";
import type { RuleContext } from "@/server/findings/context";
import { verdictFor, type MeasurePlan } from "@/server/findings/engine";
import { RULES } from "@/server/findings/rules";
import { severityFor } from "@/server/findings/types";

const concentrationRule = RULES.find((r) => r.id === "CUSTOMER_CONCENTRATION")!;

function ctxWith(top5Share: number, topShare: number, buyers = 40): RuleContext {
  return {
    parties: new Map([["p1", { id: "p1", name: "Big Buyer", segmentTag: null }]]),
    concentration: { buyers, top5Share, top10Share: top5Share, hhi: 900, top: [{ partyId: "p1", net: 1, share: topShare }] }
  } as unknown as RuleContext;
}

describe("customer concentration rule", () => {
  it("fires when five buyers take half of sales", () => {
    const [f] = concentrationRule.run(ctxWith(0.55, 0.2));
    expect(f).toMatchObject({ ruleId: "CUSTOMER_CONCENTRATION", impactInr: null, severity: "medium" });
    expect(f.title).toContain("55.0%");
  });

  it("fires when one buyer takes a quarter", () => {
    expect(concentrationRule.run(ctxWith(0.4, 0.3))).toHaveLength(1);
  });

  it("stays quiet for a spread-out buyer base", () => {
    expect(concentrationRule.run(ctxWith(0.3, 0.1))).toEqual([]);
  });

  it("stays quiet while there are too few buyers for 'the top five' to mean anything", () => {
    expect(concentrationRule.run(ctxWith(1, 1, 3))).toEqual([]);
  });
});

describe("severity and verdicts", () => {
  it("grades severity by estimated rupee impact", () => {
    expect(severityFor(150_000)).toBe("high");
    expect(severityFor(25_000)).toBe("medium");
    expect(severityFor(5_000)).toBe("low");
    // An unquantified risk is not dismissed as low.
    expect(severityFor(null)).toBe("medium");
  });

  const plan = (direction: "increase" | "decrease", target: number) => ({ direction, target }) as MeasurePlan;
  it("judges outcomes against the target in the stated direction", () => {
    expect(verdictFor(plan("decrease", 10), 8)).toBe("achieved");
    expect(verdictFor(plan("decrease", 10), 12)).toBe("not_achieved");
    expect(verdictFor(plan("increase", 20), 21)).toBe("achieved");
    expect(verdictFor(plan("increase", 20), null)).toBe("insufficient_data");
  });
});
