-- AlterEnum
ALTER TYPE "DataSourceKind" ADD VALUE 'marketplace_file';

-- CreateTable
CREATE TABLE "CustomerOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poDate" DATE NOT NULL,
    "partyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(18,3) NOT NULL,
    "qtySupplied" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,4),
    "grnDate" DATE,
    "status" "VoucherStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerOrderLine_tenantId_sourceRecordId_idx" ON "CustomerOrderLine"("tenantId", "sourceRecordId");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_tenantId_partyId_idx" ON "CustomerOrderLine"("tenantId", "partyId");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_tenantId_itemId_idx" ON "CustomerOrderLine"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_tenantId_channel_poDate_idx" ON "CustomerOrderLine"("tenantId", "channel", "poDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrderLine_id_tenantId_key" ON "CustomerOrderLine"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrderLine_tenantId_dataSourceId_sourceKey_key" ON "CustomerOrderLine"("tenantId", "dataSourceId", "sourceKey");

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_sourceRecordId_tenantId_fkey" FOREIGN KEY ("sourceRecordId", "tenantId") REFERENCES "SourceRecord"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_partyId_tenantId_fkey" FOREIGN KEY ("partyId", "tenantId") REFERENCES "Party"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "Item"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
