/**
 * Minimal RFC 4180 CSV writer. Text cells beginning with = + - @ (that are not plain
 * numbers) are prefixed with an apostrophe so spreadsheet apps don't execute them as
 * formulas (CSV injection).
 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

function cell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text) && !NUMERIC.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T extends Record<string, string>>(columns: readonly (keyof T & string)[], rows: T[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => cell(row[column] ?? "")).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
