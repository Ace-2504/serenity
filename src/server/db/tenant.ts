import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Models that carry a tenantId column. Every read and write on them made through
 * forTenant() is scoped to one tenant. The database adds a second layer: links
 * between these tables are composite (id, tenantId) foreign keys, so nested
 * includes cannot reach another tenant's rows either.
 *
 * Raw SQL ($queryRaw) is NOT scoped by this extension; analytics queries must take
 * tenantId as an explicit parameter.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set<Prisma.ModelName>([
  "Membership",
  "DataSource",
  "ImportBatch",
  "ImportIssue",
  "SourceRecord",
  "Party",
  "ItemGroup",
  "Item",
  "Batch",
  "Voucher",
  "VoucherLine",
  "StockMovement",
  "StockSnapshot",
  "OutstandingSnapshot",
  "AuditLog",
  "ImportFile",
  "BillAllocation",
  "ChannelCharge",
  "CustomerOrderLine",
  "ModelVersion",
  "Prediction",
  "ForecastPoint",
  "BasketPair",
  "Finding",
  "FindingOutcome",
  "Job"
]);

export class TenantScopeError extends Error {}

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert"
]);

type Data = Record<string, unknown>;

function stampData(tenantId: string, data: Data | undefined, model: string): Data {
  const value = data ?? {};
  if (value.tenantId !== undefined && value.tenantId !== tenantId) {
    throw new TenantScopeError(`Refusing to write ${model} for another tenant`);
  }

  return { ...value, tenantId };
}

function guardUpdate(tenantId: string, data: Data | undefined, model: string): void {
  if (data && data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new TenantScopeError(`Refusing to move ${model} to another tenant`);
  }
}

/** Pure: returns operation args with the tenant predicate / tenantId stamped in. */
export function scopeArgs(tenantId: string, model: string, operation: string, args: Data | undefined): Data {
  const next: Data = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    next.where = { ...((next.where as Data | undefined) ?? {}), tenantId };
  }

  switch (operation) {
    case "create":
      next.data = stampData(tenantId, next.data as Data, model);
      break;
    case "createMany": {
      const rows = Array.isArray(next.data) ? next.data : [next.data];
      next.data = rows.map((row) => stampData(tenantId, row as Data, model));
      break;
    }
    case "upsert":
      next.create = stampData(tenantId, next.create as Data, model);
      guardUpdate(tenantId, next.update as Data, model);
      break;
    case "update":
    case "updateMany":
      guardUpdate(tenantId, next.data as Data, model);
      break;
  }

  return next;
}

/** A Prisma client whose tenant-model queries are confined to one tenant. */
export function forTenant(tenantId: string) {
  if (!tenantId) {
    throw new TenantScopeError("tenantId is required");
  }

  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }

          return query(scopeArgs(tenantId, model, operation, args as Data) as typeof args);
        }
      }
    }
  });
}

export type TenantDb = ReturnType<typeof forTenant>;
