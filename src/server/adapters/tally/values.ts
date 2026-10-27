import { Prisma } from "@prisma/client";

/** Parsers for Tally's text conventions. All return null on unparseable input; callers report it. */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** "20250401" -> "2025-04-01". */
export function tallyDate(value: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "-1,234.50" -> Decimal. Tally signs debits negative in XML. Empty -> 0. */
export function tallyAmount(value: string | undefined): Decimal | null {
  const text = (value ?? "").trim().replace(/,/g, "");
  if (text === "") return new D(0);
  // Foreign-currency amounts look like "$100.00 @ ₹83.00/$ = ₹8300.00"; the rupee value is last.
  const rupees = text.includes("=") ? text.slice(text.lastIndexOf("=") + 1) : text;
  const m = /^\s*(-)?\s*₹?\s*(-)?\s*(\d+(?:\.\d+)?)\s*$/.exec(rupees);
  if (!m) return null;
  const v = new D(m[3]);
  return m[1] || m[2] ? v.neg() : v;
}

/** " 10 Nos" or "10 Nos = 2 Box" -> { qty: 10, unit: "Nos" }. Quantities may be negative ("-5 Nos"). */
export function tallyQty(value: string | undefined): { qty: Decimal; unit: string } | null {
  const text = (value ?? "").trim();
  if (text === "") return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*([^=]*?)\s*(?:=.*)?$/.exec(text.replace(/,/g, ""));
  if (!m) return null;
  return { qty: new D(m[1]), unit: m[2].trim() };
}

/** "40.00/Nos" -> 40. */
export function tallyRate(value: string | undefined): Decimal | null {
  const text = (value ?? "").trim().replace(/,/g, "");
  if (text === "") return null;
  const m = /^(-?\d+(?:\.\d+)?)/.exec(text.includes("=") ? text.slice(text.lastIndexOf("=") + 1).replace(/[^\d.\-/]/g, "") : text);
  return m ? new D(m[1]) : null;
}

/** "30 Days" -> 30. A fixed due date ("1-May-2025") is not converted. */
export function tallyCreditDays(value: string | undefined): number | null {
  const m = /^\s*(\d+)\s*days?\s*$/i.exec(value ?? "");
  return m ? Number(m[1]) : null;
}

export const yes = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "yes";

/** GST state codes by the state names Tally uses. The GSTIN prefix, when present, wins. */
const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01",
  "jammu & kashmir": "01",
  "himachal pradesh": "02",
  punjab: "03",
  chandigarh: "04",
  uttarakhand: "05",
  haryana: "06",
  delhi: "07",
  rajasthan: "08",
  "uttar pradesh": "09",
  bihar: "10",
  sikkim: "11",
  "arunachal pradesh": "12",
  nagaland: "13",
  manipur: "14",
  mizoram: "15",
  tripura: "16",
  meghalaya: "17",
  assam: "18",
  "west bengal": "19",
  jharkhand: "20",
  odisha: "21",
  chhattisgarh: "22",
  "madhya pradesh": "23",
  gujarat: "24",
  "dadra and nagar haveli and daman and diu": "26",
  "dadra & nagar haveli and daman & diu": "26",
  maharashtra: "27",
  karnataka: "29",
  goa: "30",
  lakshadweep: "31",
  kerala: "32",
  "tamil nadu": "33",
  puducherry: "34",
  "andaman and nicobar islands": "35",
  "andaman & nicobar islands": "35",
  telangana: "36",
  "andhra pradesh": "37",
  ladakh: "38"
};

export function stateCode(gstin: string | undefined, stateName: string | undefined): string {
  const fromGstin = /^(\d{2})[A-Z0-9]{13}$/i.exec((gstin ?? "").trim());
  if (fromGstin) return fromGstin[1];
  return STATE_CODES[(stateName ?? "").trim().toLowerCase()] ?? "";
}
