import { describe, expect, it } from "vitest";
import { checkAnswer, collectNumbers, extractNumbers } from "@/server/assistant/guard";

describe("number extraction", () => {
  it("reads Indian money formats, units and percentages as values", () => {
    const values = extractNumbers("Sales were ₹1.2 L (₹1,20,000), margin 24.5%, Rs 3.45 Cr total, 12.3K units, 2 lakh, -₹500").map((m) => [m.value, m.percent]);
    expect(values).toEqual([
      [120000, false],
      [120000, false],
      [24.5, true],
      [34500000, false],
      [12300, false],
      [200000, false],
      [-500, false]
    ]);
  });

  it("ignores dates and financial-year labels", () => {
    expect(extractNumbers("From 2025-04-01 to 31 Mar 2026 (FY 2025-26), 30 Sept 2026 and Apr 2026").length).toBe(0);
  });
});

describe("numeric guard", () => {
  const results = { netSales: 123456.78, margin: 24.53, rows: [{ name: "Pens", contribution: -6300 }], count: 3 };
  const allowed = collectNumbers(results);

  it("accepts numbers that match tool results within the rounding shown", () => {
    expect(checkAnswer("Net sales were ₹1.2 L with a 24.5% margin; Pens lost ₹6.3K. 3 groups.", allowed).ok).toBe(true);
    expect(checkAnswer("Net sales were ₹1,23,456.78.", allowed).ok).toBe(true);
  });

  it("rejects an answer with an altered number", () => {
    const result = checkAnswer("Net sales were ₹1.4 L with a 24.5% margin.", allowed);
    expect(result).toMatchObject({ ok: false, unmatched: ["₹1.4 L"] });
    expect(checkAnswer("Margin was 26.5%.", allowed).ok).toBe(false);
    expect(checkAnswer("Pens lost ₹9,300.", allowed).ok).toBe(false);
  });

  it("rejects numbers the model computed itself, even if plausible", () => {
    // 123456.78 x 2 is not in any result.
    expect(checkAnswer("Doubling sales would give ₹2.5 L.", allowed).ok).toBe(false);
  });

  it("allows digits that are part of names and codes in the results", () => {
    expect(checkAnswer("Demo School 023 has not ordered since order SO-1001_1.", collectNumbers({ name: "Demo School 023, Ghaziabad", order: "SO-1001_1" })).ok).toBe(true);
  });

  it("allows numbers from the question", () => {
    expect(checkAnswer("Here are the top 5 products.", allowed, "Show my top 5 products").ok).toBe(true);
  });

  it("matches a share given as a fraction against a percentage", () => {
    expect(checkAnswer("Top five buyers take 83.2% of sales.", collectNumbers({ top5Share: 0.832 })).ok).toBe(true);
  });
});
