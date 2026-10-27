import { XMLParser } from "fast-xml-parser";
import { decodeTallyXml } from "@/server/adapters/tally/decode";

/**
 * Reads Tally "Data Interchange" XML (Export of masters or of the Day Book) into plain objects.
 * Values stay strings; amounts are parsed later with exact decimals.
 */

export type TallyNode = { [key: string]: TallyValue };
export type TallyValue = string | TallyNode | TallyValue[];

const OBJECT_TAGS = ["VOUCHER", "LEDGER", "GROUP", "STOCKITEM", "STOCKGROUP", "VOUCHERTYPE", "UNIT", "COMPANY"] as const;
type ObjectTag = (typeof OBJECT_TAGS)[number];

export type TallyObjects = Record<ObjectTag, TallyNode[]> & { files: { name: string; encoding: string; removedControlRefs: number }[]; company: string | null };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => name.endsWith(".LIST") || (OBJECT_TAGS as readonly string[]).includes(name) || name === "TALLYMESSAGE"
});

export class TallyXmlError extends Error {}

export function collectTallyObjects(files: { name: string; content: Buffer }[]): TallyObjects {
  const out = Object.fromEntries(OBJECT_TAGS.map((t) => [t, [] as TallyNode[]])) as unknown as TallyObjects;
  out.files = [];
  out.company = null;
  for (const file of files) {
    const decoded = decodeTallyXml(file.content);
    // Tally never writes a DTD; refusing one rules out entity-expansion attacks.
    if (/<!(DOCTYPE|ENTITY)/i.test(decoded.text)) throw new TallyXmlError(`${file.name} declares a DOCTYPE or ENTITY, which Tally exports never contain`);
    let tree: TallyNode;
    try {
      tree = parser.parse(decoded.text, true) as TallyNode;
    } catch (error) {
      throw new TallyXmlError(`${file.name} is not readable XML: ${(error as Error).message}`);
    }
    if (!("ENVELOPE" in tree)) throw new TallyXmlError(`${file.name} is not a Tally XML export (no ENVELOPE element)`);
    walk(tree, out);
    out.files.push({ name: file.name, encoding: decoded.encoding, removedControlRefs: decoded.removedControlRefs });
  }
  return out;
}

function walk(node: TallyValue, out: TallyObjects) {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, out));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "SVCURRENTCOMPANY" && typeof value === "string" && value.trim()) {
      out.company ??= value.trim();
    } else if ((OBJECT_TAGS as readonly string[]).includes(key)) {
      for (const obj of value as TallyValue[]) if (typeof obj === "object" && !Array.isArray(obj)) out[key as ObjectTag].push(obj);
    } else if (!key.startsWith("@")) {
      walk(value, out);
    }
  }
}

/** Text of a child element ("" when absent). Elements with attributes keep their text in #text. */
export function text(node: TallyNode | undefined, key: string): string {
  const value = node?.[key];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return "";
  if (typeof first === "string") return first.trim();
  if (typeof first === "object" && !Array.isArray(first) && typeof first["#text"] === "string") return first["#text"].trim();
  return "";
}

/** Child list elements (e.g. "LEDGERENTRIES.LIST"), skipping Tally's empty placeholders. */
export function list(node: TallyNode | undefined, ...keys: string[]): TallyNode[] {
  return keys.flatMap((key) => {
    const value = node?.[key];
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is TallyNode => typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0);
  });
}

/** A master's name: the NAME attribute, else the first NAME in NAME.LIST. */
export function nameOf(node: TallyNode): string {
  const attr = node["@NAME"];
  if (typeof attr === "string" && attr.trim()) return attr.trim();
  const names = list(node, "NAME.LIST")[0];
  return names ? text(names, "NAME") : "";
}
