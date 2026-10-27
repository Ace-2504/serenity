import { parse as parseCsv } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { excelSerialToIso, isXlsx, readXlsx } from "@/server/adapters/xlsx";
import type { UploadedFile } from "@/server/ingest/parse";

/**
 * Platform exports arrive as CSV, tab-separated text or Excel, with headers that vary by
 * platform and over time. Columns are found by normalised aliases; values are parsed loosely
 * (Indian number formatting, several date styles) but never guessed: unparseable -> null.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type Table = { file: string; header: string[]; rows: string[][] };

export class TableError extends Error {}

export function readTable(file: UploadedFile): Table {
  if (isXlsx(file.content)) {
    const { rows } = readXlsx(file.content);
    const headerAt = rows.findIndex((r) => r.filter((c) => c !== "").length >= 3);
    if (headerAt < 0) throw new TableError(`${file.name}: no header row found`);
    return { file: file.name, header: rows[headerAt], rows: rows.slice(headerAt + 1).filter((r) => r.some((c) => c !== "")) };
  }
  const text = file.content.toString("utf8").replace(/^﻿/, "");
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0);
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  let records: string[][];
  try {
    records = parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as string[][];
  } catch (error) {
    throw new TableError(`${file.name}: ${(error as Error).message}`);
  }
  if (records.length === 0) throw new TableError(`${file.name} is empty`);
  return { file: file.name, header: records[0].map((h) => h.trim()), rows: records.slice(1).map((r) => r.map((c) => c.trim())) };
}

export const normalise = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Index of the first header matching any alias (compared normalised), or -1. */
export function column(header: string[], aliases: readonly string[]): number {
  const names = header.map(normalise);
  for (const alias of aliases) {
    const i = names.indexOf(normalise(alias));
    if (i >= 0) return i;
  }
  return -1;
}

export function hasColumns(header: string[], ...aliasSets: (readonly string[])[]): boolean {
  return aliasSets.every((aliases) => column(header, aliases) >= 0);
}

/** "₹1,23,456.50", "-12", "(12.00)" -> Decimal; "" -> 0; anything else -> null. */
export function looseMoney(value: string | undefined): Decimal | null {
  const text = (value ?? "").trim().replace(/[₹,\s]/g, "").replace(/^Rs\.?/i, "");
  if (text === "" || text === "-") return new D(0);
  const negative = /^\(.*\)$/.test(text);
  const core = negative ? text.slice(1, -1) : text;
  if (!/^-?\d+(\.\d+)?$/.test(core)) return null;
  const v = new D(core);
  return negative ? v.neg() : v;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * ISO ("2025-04-15", "2025-04-15T06:12:44+00:00"), day-first ("15-04-2025", "15/04/2025",
 * "15.04.2025 06:12:44 UTC"), "15 Apr 2025", "Apr 15, 2025", or an Excel serial number.
 * Day-first is assumed for numeric dates: Indian platforms write them that way.
 */
export function looseDate(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const valid = (y: number, m: number, d: number) => {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const t = Date.parse(`${iso}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(iso) ? iso : null;
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(text);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})/.exec(text);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (m && MONTHS[m[1].toLowerCase()]) return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(text)) return excelSerialToIso(Number(text));
  return null;
}

export const money = (d: Decimal) => d.toFixed(2);
