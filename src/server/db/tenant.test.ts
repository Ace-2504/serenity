import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { scopeArgs, TENANT_MODELS, TenantScopeError } from "@/server/db/tenant";

const A = "tenant-a";

describe("scopeArgs", () => {
  it("adds the tenant predicate to reads, keeping caller filters", () => {
    expect(scopeArgs(A, "Voucher", "findMany", { where: { type: "sales_invoice" } })).toEqual({
      where: { type: "sales_invoice", tenantId: A }
    });
    expect(scopeArgs(A, "Voucher", "count", undefined)).toEqual({ where: { tenantId: A } });
  });

  it("overrides a caller-supplied tenantId in a where clause", () => {
    expect(scopeArgs(A, "Party", "findFirst", { where: { tenantId: "tenant-b" } })).toEqual({
      where: { tenantId: A }
    });
  });

  it("stamps tenantId on create and createMany", () => {
    expect(scopeArgs(A, "Party", "create", { data: { name: "x" } })).toEqual({ data: { name: "x", tenantId: A } });
    expect(scopeArgs(A, "Party", "createMany", { data: [{ name: "x" }, { name: "y" }] })).toEqual({
      data: [
        { name: "x", tenantId: A },
        { name: "y", tenantId: A }
      ]
    });
  });

  it("refuses writes addressed to another tenant", () => {
    expect(() => scopeArgs(A, "Party", "create", { data: { tenantId: "tenant-b" } })).toThrow(TenantScopeError);
    expect(() => scopeArgs(A, "Party", "createMany", { data: [{}, { tenantId: "tenant-b" }] })).toThrow(TenantScopeError);
    expect(() => scopeArgs(A, "Party", "updateMany", { where: {}, data: { tenantId: "tenant-b" } })).toThrow(
      TenantScopeError
    );
    expect(() => scopeArgs(A, "Party", "upsert", { where: {}, create: {}, update: { tenantId: "tenant-b" } })).toThrow(
      TenantScopeError
    );
  });

  it("covers every Prisma model that has a tenantId column", () => {
    const withTenant = Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === "tenantId"))
      .map((model) => model.name)
      .sort();
    expect([...TENANT_MODELS].sort()).toEqual(withTenant);
  });
});
