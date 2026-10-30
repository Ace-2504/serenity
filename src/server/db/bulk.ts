import { Prisma } from "@prisma/client";

/**
 * Fast bulk insert for large imports: each chunk is sent as ONE JSON parameter and expanded
 * by Postgres with jsonb_to_recordset, instead of one bind parameter per value.
 *
 * Raw SQL bypasses the forTenant() extension, so tenant safety is enforced here: every row
 * must carry the caller's tenantId. Composite (id, tenantId) foreign keys still reject any
 * cross-tenant link in the database. Table and column names come from code constants, never
 * from user input; row values travel only as the bound JSON parameter.
 *
 * Columns with DB defaults that are omitted from `columns` get their default; every listed
 * column must be present on every row (a missing key would insert NULL, not the default).
 */
type RawExecutor = { $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> };

const CHUNK = 10_000;

export async function bulkInsert(
  tx: RawExecutor,
  tenantId: string,
  table: string,
  columns: Record<string, string>,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const names = Object.keys(columns);
  if (!names.includes("tenantId")) throw new Error(`bulkInsert into ${table} must include tenantId`);
  const columnList = names.map((name) => `"${name}"`).join(", ");
  const typeList = names.map((name) => `"${name}" ${columns[name]}`).join(", ");
  const sql = `INSERT INTO "${table}" (${columnList}) SELECT ${columnList} FROM jsonb_to_recordset($1::jsonb) AS r(${typeList})`;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    for (const row of chunk) {
      if (row.tenantId !== tenantId) throw new Error(`Refusing to bulk-insert a ${table} row for another tenant`);
      for (const name of names) {
        if (row[name] === undefined) throw new Error(`bulkInsert into ${table}: row is missing "${name}"`);
      }
    }
    await tx.$executeRawUnsafe(sql, JSON.stringify(chunk, (_key, value) => (value instanceof Prisma.Decimal ? value.toFixed() : value)));
  }
}

/**
 * Bulk UPDATE ... FROM jsonb_to_recordset, matching rows by id within one tenant.
 * Same safety rules as bulkInsert: constant identifiers, values only via the JSON parameter.
 */
export async function bulkUpdate(
  tx: RawExecutor,
  tenantId: string,
  table: string,
  columns: Record<string, string>,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const names = Object.keys(columns);
  const typeList = ["id text", ...names.map((name) => `"${name}" ${columns[name]}`)].join(", ");
  const assignments = names.map((name) => `"${name}" = r."${name}"`).join(", ");
  const sql = `UPDATE "${table}" AS t SET ${assignments} FROM jsonb_to_recordset($1::jsonb) AS r(${typeList}) WHERE t."id" = r."id" AND t."tenantId" = $2`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    for (const row of chunk) {
      for (const name of ["id", ...names]) {
        if (row[name] === undefined) throw new Error(`bulkUpdate on ${table}: row is missing "${name}"`);
      }
    }
    await tx.$executeRawUnsafe(sql, JSON.stringify(chunk, (_key, value) => (value instanceof Prisma.Decimal ? value.toFixed() : value)), tenantId);
  }
}
