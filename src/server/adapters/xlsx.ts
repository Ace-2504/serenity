import { inflateRawSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

/**
 * Minimal, dependency-free XLSX reader: the first (or a named) worksheet as rows of strings.
 * Enough for platform exports (Meesho payments, quick-commerce PO/GRN files). Reads shared,
 * inline and plain cell values; numbers stay as written (dates arrive as Excel serial numbers,
 * see excelSerialToIso). Guards against zip bombs by capping each inflated part.
 */

const MAX_PART_BYTES = 200 * 1024 * 1024;

export class XlsxError extends Error {}

export function isXlsx(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
}

/** ZIP central directory -> { name: bytes } for the parts we ask for. */
function unzip(bytes: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("Not a valid .xlsx file (no ZIP directory)");
  const entries = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < entries; n += 1) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("Corrupt .xlsx file (bad directory entry)");
    const method = bytes.readUInt16LE(p + 10);
    const compressed = bytes.readUInt32LE(p + 20);
    const size = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const local = bytes.readUInt32LE(p + 42);
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (size > MAX_PART_BYTES) throw new XlsxError(`${name} is larger than ${MAX_PART_BYTES / 1024 / 1024} MB uncompressed`);
    if (bytes.readUInt32LE(local) !== 0x04034b50) throw new XlsxError("Corrupt .xlsx file (bad local header)");
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }));
    else throw new XlsxError(`Unsupported compression in ${name}`);
  }
  return out;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ["sheet", "Relationship", "si", "r", "row", "c"].includes(name)
});

type Node = Record<string, unknown>;
const textOf = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as Node)) return String((v as Node)["#text"]);
  return "";
};

/** Column letters -> zero-based index ("A" -> 0, "AB" -> 27). */
const columnIndex = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function readXlsx(bytes: Buffer, sheetName?: string): { sheet: string; rows: string[][] } {
  if (/<!(DOCTYPE|ENTITY)/i.test(bytes.toString("latin1", 0, Math.min(bytes.length, 4096)))) throw new XlsxError("Unexpected DTD in workbook");
  const parts = unzip(bytes, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || n.startsWith("xl/worksheets/"));
  const workbook = parts.get("xl/workbook.xml");
  if (!workbook) throw new XlsxError("Not an Excel workbook (no xl/workbook.xml)");
  for (const part of parts.values()) if (/<!(DOCTYPE|ENTITY)/i.test(part.toString("utf8", 0, Math.min(part.length, 2048)))) throw new XlsxError("Unexpected DTD in workbook");

  const sheets = ((parser.parse(workbook.toString("utf8")) as Node).workbook as Node)?.sheets as Node;
  const sheetList = (sheets?.sheet as Node[]) ?? [];
  const chosen = sheetName ? sheetList.find((s) => s["@name"] === sheetName) : sheetList[0];
  if (!chosen) throw new XlsxError(sheetName ? `No sheet named "${sheetName}"` : "The workbook has no sheets");
  const rels = ((parser.parse(parts.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "<Relationships/>") as Node).Relationships as Node)?.Relationship as Node[] | undefined;
  const target = rels?.find((r) => r["@Id"] === chosen["@r:id"])?.["@Target"] as string | undefined;
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "xl/worksheets/sheet1.xml";
  const sheetXml = parts.get(path);
  if (!sheetXml) throw new XlsxError(`Worksheet ${path} is missing`);

  const shared = (((parser.parse(parts.get("xl/sharedStrings.xml")?.toString("utf8") ?? "<sst/>") as Node).sst as Node)?.si as Node[] | undefined) ?? [];
  const strings = shared.map((si) => (si.t !== undefined ? textOf(si.t) : ((si.r as Node[]) ?? []).map((r) => textOf(r.t)).join("")));

  const data = ((parser.parse(sheetXml.toString("utf8")) as Node).worksheet as Node)?.sheetData as Node;
  const rows: string[][] = [];
  for (const row of (data?.row as Node[]) ?? []) {
    const cells: string[] = [];
    for (const c of (row.c as Node[]) ?? []) {
      const ref = String(c["@r"] ?? "");
      const index = ref ? columnIndex(ref) : cells.length;
      const type = c["@t"];
      let value: string;
      if (type === "s") value = strings[Number(textOf(c.v))] ?? "";
      else if (type === "inlineStr") value = textOf((c.is as Node)?.t);
      else if (type === "b") value = textOf(c.v) === "1" ? "TRUE" : "FALSE";
      else value = textOf(c.v);
      cells[index] = value.trim();
    }
    rows.push(Array.from(cells, (v) => v ?? ""));
  }
  return { sheet: String(chosen["@name"]), rows };
}

/** Excel serial date (1900 system) -> ISO date; passes ISO and dd-mm-yyyy text through parseLooseDate. */
export function excelSerialToIso(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}
