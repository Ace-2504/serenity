/*
  Warnings:

  - You are about to drop the column `isWalkIn` on the `Party` table. All the data in the column will be lost.
  - Added the required column `importBatchId` to the `OutstandingSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `importBatchId` to the `StockSnapshot` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ImportBatch_dataSourceId_fileSha256_key";

-- AlterTable
ALTER TABLE "OutstandingSnapshot" ADD COLUMN     "importBatchId" TEXT NOT NULL;

-- AlterTable (rename keeps any existing values; Prisma would otherwise drop and re-add)
ALTER TABLE "Party" RENAME COLUMN "isWalkIn" TO "anonymousBuyers";

-- AlterTable
ALTER TABLE "StockSnapshot" ADD COLUMN     "importBatchId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "orderRef" TEXT;

-- CreateTable
CREATE TABLE "ImportFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "settlementVoucherId" TEXT NOT NULL,
    "billVoucherId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BillAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelCharge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "settlementRef" TEXT NOT NULL,
    "settlementDate" DATE NOT NULL,
    "orderVoucherId" TEXT,
    "orderRef" TEXT,
    "eventType" TEXT,
    "chargeType" TEXT NOT NULL,
    "rawLabel" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "gstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isTaxWithheld" BOOLEAN NOT NULL DEFAULT false,
    "allocationBasis" TEXT,
    "status" "VoucherStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportFile_tenantId_idx" ON "ImportFile"("tenantId");

-- CreateIndex
CREATE INDEX "ImportFile_tenantId_importBatchId_idx" ON "ImportFile"("tenantId", "importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportFile_importBatchId_name_key" ON "ImportFile"("importBatchId", "name");

-- CreateIndex
CREATE INDEX "BillAllocation_tenantId_billVoucherId_idx" ON "BillAllocation"("tenantId", "billVoucherId");

-- CreateIndex
CREATE INDEX "BillAllocation_tenantId_settlementVoucherId_idx" ON "BillAllocation"("tenantId", "settlementVoucherId");

-- CreateIndex
CREATE INDEX "ChannelCharge_tenantId_channel_settlementDate_idx" ON "ChannelCharge"("tenantId", "channel", "settlementDate");

-- CreateIndex
CREATE INDEX "ChannelCharge_tenantId_orderVoucherId_idx" ON "ChannelCharge"("tenantId", "orderVoucherId");

-- CreateIndex
CREATE INDEX "ChannelCharge_tenantId_sourceRecordId_idx" ON "ChannelCharge"("tenantId", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelCharge_tenantId_dataSourceId_sourceKey_key" ON "ChannelCharge"("tenantId", "dataSourceId", "sourceKey");

-- CreateIndex
CREATE INDEX "ImportBatch_dataSourceId_fileSha256_idx" ON "ImportBatch"("dataSourceId", "fileSha256");

-- CreateIndex
CREATE INDEX "ImportBatch_tenantId_dataSourceId_idx" ON "ImportBatch"("tenantId", "dataSourceId");

-- CreateIndex
CREATE INDEX "Item_tenantId_sourceRecordId_idx" ON "Item"("tenantId", "sourceRecordId");

-- CreateIndex
CREATE INDEX "OutstandingSnapshot_tenantId_importBatchId_idx" ON "OutstandingSnapshot"("tenantId", "importBatchId");

-- CreateIndex
CREATE INDEX "OutstandingSnapshot_tenantId_partyId_idx" ON "OutstandingSnapshot"("tenantId", "partyId");

-- CreateIndex
CREATE INDEX "Party_tenantId_sourceRecordId_idx" ON "Party"("tenantId", "sourceRecordId");

-- CreateIndex
CREATE INDEX "SourceRecord_tenantId_importBatchId_idx" ON "SourceRecord"("tenantId", "importBatchId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_batchId_idx" ON "StockMovement"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_voucherLineId_idx" ON "StockMovement"("tenantId", "voucherLineId");

-- CreateIndex
CREATE INDEX "StockSnapshot_tenantId_batchId_idx" ON "StockSnapshot"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "StockSnapshot_tenantId_importBatchId_idx" ON "StockSnapshot"("tenantId", "importBatchId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_orderRef_idx" ON "Voucher"("tenantId", "orderRef");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_sourceRecordId_idx" ON "Voucher"("tenantId", "sourceRecordId");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_voucherId_idx" ON "VoucherLine"("tenantId", "voucherId");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_batchId_idx" ON "VoucherLine"("tenantId", "batchId");

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_importBatchId_tenantId_fkey" FOREIGN KEY ("importBatchId", "tenantId") REFERENCES "ImportBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingSnapshot" ADD CONSTRAINT "OutstandingSnapshot_importBatchId_tenantId_fkey" FOREIGN KEY ("importBatchId", "tenantId") REFERENCES "ImportBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFile" ADD CONSTRAINT "ImportFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFile" ADD CONSTRAINT "ImportFile_importBatchId_tenantId_fkey" FOREIGN KEY ("importBatchId", "tenantId") REFERENCES "ImportBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAllocation" ADD CONSTRAINT "BillAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAllocation" ADD CONSTRAINT "BillAllocation_settlementVoucherId_tenantId_fkey" FOREIGN KEY ("settlementVoucherId", "tenantId") REFERENCES "Voucher"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillAllocation" ADD CONSTRAINT "BillAllocation_billVoucherId_tenantId_fkey" FOREIGN KEY ("billVoucherId", "tenantId") REFERENCES "Voucher"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelCharge" ADD CONSTRAINT "ChannelCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelCharge" ADD CONSTRAINT "ChannelCharge_sourceRecordId_tenantId_fkey" FOREIGN KEY ("sourceRecordId", "tenantId") REFERENCES "SourceRecord"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelCharge" ADD CONSTRAINT "ChannelCharge_orderVoucherId_tenantId_fkey" FOREIGN KEY ("orderVoucherId", "tenantId") REFERENCES "Voucher"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
