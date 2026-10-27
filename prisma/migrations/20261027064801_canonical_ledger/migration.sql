-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner_admin', 'accountant', 'analyst');

-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('demo', 'csv_template', 'storefront', 'tally_xml', 'tally_http', 'busy_excel');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('staged', 'validated', 'committed', 'failed', 'rejected');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('error', 'warning', 'info');

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('customer', 'supplier', 'both');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('sales_invoice', 'sales_return', 'purchase_invoice', 'purchase_return', 'receipt', 'payment', 'stock_adjustment', 'opening_stock');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('active', 'cancelled', 'superseded', 'deleted_at_source');

-- CreateEnum
CREATE TYPE "CostBasis" AS ENUM ('source_provided', 'derived_wac', 'unknown');

-- CreateEnum
CREATE TYPE "OutstandingSide" AS ENUM ('receivable', 'payable');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domainPack" TEXT NOT NULL,
    "gstin" TEXT,
    "stateCode" TEXT,
    "fyStartMonth" INTEGER NOT NULL DEFAULT 4,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "cursor" JSONB,
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'staged',
    "fileName" TEXT,
    "fileSha256" TEXT,
    "periodFrom" DATE,
    "periodTo" DATE,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "controlTotals" JSONB,
    "reconciliation" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "rowRef" TEXT,
    "field" TEXT,
    "message" TEXT NOT NULL,

    CONSTRAINT "ImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "isWalkIn" BOOLEAN NOT NULL DEFAULT false,
    "gstin" TEXT,
    "stateCode" TEXT,
    "city" TEXT,
    "segmentTag" TEXT,
    "creditDays" INTEGER,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "itemGroupId" TEXT,
    "uom" TEXT NOT NULL,
    "hsnCode" TEXT,
    "gstRate" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tracksBatches" BOOLEAN NOT NULL DEFAULT false,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "mfgDate" DATE,
    "expiryDate" DATE,
    "mrp" DECIMAL(18,2),

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceRecordId" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "partyId" TEXT,
    "dueDate" DATE,
    "channel" TEXT,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalInclTax" DECIMAL(18,2) NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'active',
    "originalVoucherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costAmount" DECIMAL(18,2),
    "costBasis" "CostBasis" NOT NULL DEFAULT 'unknown',

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT,
    "voucherLineId" TEXT,
    "date" DATE NOT NULL,
    "seq" INTEGER NOT NULL,
    "qtyIn" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "qtyOut" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4),
    "valueIn" DECIMAL(18,2),
    "valueOut" DECIMAL(18,2),
    "runningQty" DECIMAL(18,3) NOT NULL,
    "runningValue" DECIMAL(18,2),
    "reason" TEXT NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT,
    "dataSourceId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "value" DECIMAL(18,2),
    "valuationMethod" TEXT,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutstandingSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "side" "OutstandingSide" NOT NULL,
    "billRef" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE,
    "amountInclTax" DECIMAL(18,2) NOT NULL,
    "pendingInclTax" DECIMAL(18,2) NOT NULL,
    "asOf" DATE NOT NULL,

    CONSTRAINT "OutstandingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "DataSource_tenantId_idx" ON "DataSource"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_id_tenantId_key" ON "DataSource"("id", "tenantId");

-- CreateIndex
CREATE INDEX "ImportBatch_tenantId_createdAt_idx" ON "ImportBatch"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_id_tenantId_key" ON "ImportBatch"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_dataSourceId_fileSha256_key" ON "ImportBatch"("dataSourceId", "fileSha256");

-- CreateIndex
CREATE INDEX "ImportIssue_tenantId_importBatchId_idx" ON "ImportIssue"("tenantId", "importBatchId");

-- CreateIndex
CREATE INDEX "SourceRecord_tenantId_dataSourceId_entity_sourceKey_idx" ON "SourceRecord"("tenantId", "dataSourceId", "entity", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRecord_id_tenantId_key" ON "SourceRecord"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRecord_tenantId_dataSourceId_entity_sourceKey_version_key" ON "SourceRecord"("tenantId", "dataSourceId", "entity", "sourceKey", "version");

-- CreateIndex
CREATE INDEX "Party_tenantId_kind_idx" ON "Party"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Party_id_tenantId_key" ON "Party"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Party_tenantId_dataSourceId_sourceKey_key" ON "Party"("tenantId", "dataSourceId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_id_tenantId_key" ON "ItemGroup"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_tenantId_name_key" ON "ItemGroup"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Item_tenantId_itemGroupId_idx" ON "Item"("tenantId", "itemGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_id_tenantId_key" ON "Item"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_tenantId_dataSourceId_sourceKey_key" ON "Item"("tenantId", "dataSourceId", "sourceKey");

-- CreateIndex
CREATE INDEX "Batch_tenantId_expiryDate_idx" ON "Batch"("tenantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_id_tenantId_key" ON "Batch"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_tenantId_itemId_batchNo_key" ON "Batch"("tenantId", "itemId", "batchNo");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_type_date_idx" ON "Voucher"("tenantId", "type", "date");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_partyId_date_idx" ON "Voucher"("tenantId", "partyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_id_tenantId_key" ON "Voucher"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_tenantId_dataSourceId_sourceKey_key" ON "Voucher"("tenantId", "dataSourceId", "sourceKey");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_itemId_idx" ON "VoucherLine"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherLine_id_tenantId_key" ON "VoucherLine"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherLine_voucherId_lineNo_key" ON "VoucherLine"("voucherId", "lineNo");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_itemId_date_idx" ON "StockMovement"("tenantId", "itemId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_tenantId_itemId_seq_key" ON "StockMovement"("tenantId", "itemId", "seq");

-- CreateIndex
CREATE INDEX "StockSnapshot_tenantId_asOf_idx" ON "StockSnapshot"("tenantId", "asOf");

-- CreateIndex
CREATE INDEX "StockSnapshot_tenantId_itemId_asOf_idx" ON "StockSnapshot"("tenantId", "itemId", "asOf");

-- CreateIndex
CREATE INDEX "OutstandingSnapshot_tenantId_side_asOf_idx" ON "OutstandingSnapshot"("tenantId", "side", "asOf");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_at_idx" ON "AuditLog"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_dataSourceId_tenantId_fkey" FOREIGN KEY ("dataSourceId", "tenantId") REFERENCES "DataSource"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportIssue" ADD CONSTRAINT "ImportIssue_importBatchId_tenantId_fkey" FOREIGN KEY ("importBatchId", "tenantId") REFERENCES "ImportBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_dataSourceId_tenantId_fkey" FOREIGN KEY ("dataSourceId", "tenantId") REFERENCES "DataSource"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_importBatchId_tenantId_fkey" FOREIGN KEY ("importBatchId", "tenantId") REFERENCES "ImportBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_sourceRecordId_tenantId_fkey" FOREIGN KEY ("sourceRecordId", "tenantId") REFERENCES "SourceRecord"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_sourceRecordId_tenantId_fkey" FOREIGN KEY ("sourceRecordId", "tenantId") REFERENCES "SourceRecord"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_itemGroupId_tenantId_fkey" FOREIGN KEY ("itemGroupId", "tenantId") REFERENCES "ItemGroup"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "Item"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_sourceRecordId_tenantId_fkey" FOREIGN KEY ("sourceRecordId", "tenantId") REFERENCES "SourceRecord"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_partyId_tenantId_fkey" FOREIGN KEY ("partyId", "tenantId") REFERENCES "Party"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_tenantId_fkey" FOREIGN KEY ("voucherId", "tenantId") REFERENCES "Voucher"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "Item"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_batchId_tenantId_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "Batch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "Item"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_tenantId_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "Batch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_voucherLineId_tenantId_fkey" FOREIGN KEY ("voucherLineId", "tenantId") REFERENCES "VoucherLine"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_itemId_tenantId_fkey" FOREIGN KEY ("itemId", "tenantId") REFERENCES "Item"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_batchId_tenantId_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "Batch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingSnapshot" ADD CONSTRAINT "OutstandingSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutstandingSnapshot" ADD CONSTRAINT "OutstandingSnapshot_partyId_tenantId_fkey" FOREIGN KEY ("partyId", "tenantId") REFERENCES "Party"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
