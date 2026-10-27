import type { Prisma } from "@prisma/client";
import { getSelectableDomainPack } from "@/domain/packs";

/** A real (non-demo) business with `userId` as its owner and a template-upload data source. */
export function createBusiness(tx: Prisma.TransactionClient, userId: string, name: string, domainPack: string) {
  getSelectableDomainPack(domainPack); // throws for an unknown or inactive trade
  return tx.tenant.create({
    data: {
      name,
      domainPack,
      memberships: { create: { userId, role: "owner_admin" } },
      dataSources: { create: { kind: "csv_template", name: "Template upload" } }
    }
  });
}
