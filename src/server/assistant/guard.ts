/**
 * Numeric guard: every number in an assistant answer must come from a tool result (or from the
 * question or the tool arguments). Numbers are compared as values, so "₹1.2 L", "1,20,000" and
 * "120000" all match 1,20,000, within the rounding the answer itself shows.
 */

export type NumberMention = { text: string; value: number; tolerance: number; percent: boolean };

const UNITS: Record<string, number> = { cr: 1e7, crore: 1e7, crores: 1e7, l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, k: 1e3, thousand: 1e3 };

// ₹ / Rs prefix, Indian or western digit grouping, optional decimals, optional unit or %.
const NUMBER = /(?:-|−)?(?:₹|rs\.?\s?|inr\s?)?(?:-|−)?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|(?:-|−)?(?:₹|rs\.?\s?|inr\s?)?(?:-|−)?\d+(?:\.\d+)?/gi;
const AFTER = /^\s*(%|cr\b|crores?\b|l\b|lakhs?\b|lacs?\b|k\b|thousand\b)/i;
const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b|\bfy\s?\d{2,4}(-\d{2,4})?\b/gi;

export function extractNumbers(text: string): NumberMention[] {
  // Dates and financial-year labels are not quantities.
  const cleaned = text.replace(DATE, (m) => " ".repeat(m.length));
  const out: NumberMention[] = [];
  for (const match of cleaned.matchAll(NUMBER)) {
    const raw = match[0];
    const negative = /[-−]/.test(raw);
    const digits = raw.replace(/[-−]/g, "").replace(/^(?:₹|rs\.?\s?|inr\s?)/i, "").replace(/,/g, "");
    if (!/\d/.test(digits)) continue;
    const after = cleaned.slice((match.index ?? 0) + raw.length);
    const unitMatch = AFTER.exec(after);
    const unit = unitMatch?.[1].toLowerCase();
    const percent = unit === "%";
    const scale = unit && !percent ? UNITS[unit] : 1;
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const value = Number(digits) * scale * (negative ? -1 : 1);
    // Half of the last shown digit, in the scaled unit: "₹1.2 L" covers 1,15,000-1,25,000.
    const tolerance = (0.5 * 10 ** -decimals) * scale;
    out.push({ text: raw + (unitMatch?.[0] ?? ""), value, tolerance, percent });
  }
  return out;
}

/**
 * All numbers inside tool results and arguments, at any depth. Digits inside text (names and
 * codes such as "Demo School 023" or "SO-1001") count too, so quoting a name is never flagged.
 */
export function collectNumbers(value: unknown, into: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) into.push(value);
  else if (typeof value === "string") for (const m of value.matchAll(/\d+(?:\.\d+)?/g)) into.push(Number(m[0]));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, into));
  return into;
}

export type GuardResult = { ok: boolean; checked: number; unmatched: string[] };

/**
 * Small counting words ("top 3", "2 customers") are allowed when the count appears in a result,
 * like any other number; nothing is exempt except dates and numbers the user typed. Magnitudes
 * are compared, because answers carry the sign in words ("lost ₹6.3K" for -6,300).
 */
export function checkAnswer(answer: string, allowed: number[], question = ""): GuardResult {
  const pool = [...allowed, ...extractNumbers(question).map((m) => m.value)];
  const mentions = extractNumbers(answer);
  const unmatched = mentions
    .filter((m) => {
      const candidates = m.percent ? pool.flatMap((v) => [v, v * 100]) : pool;
      return !candidates.some((v) => Math.abs(Math.abs(v) - Math.abs(m.value)) <= Math.max(m.tolerance, 1e-9) + 1e-9 * Math.abs(v));
    })
    .map((m) => m.text.trim());
  return { ok: unmatched.length === 0, checked: mentions.length, unmatched };
}
