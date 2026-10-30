-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataCutoff" DATE NOT NULL,
    "dataHash" TEXT NOT NULL,
    "featureList" JSONB NOT NULL DEFAULT '[]',
    "metrics" JSONB NOT NULL,
    "shipped" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastPoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,

    CONSTRAINT "ForecastPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasketPair" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "partnerItemId" TEXT NOT NULL,
    "together" INTEGER NOT NULL,
    "support" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "lift" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BasketPair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelVersion_tenantId_model_status_idx" ON "ModelVersion"("tenantId", "model", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_id_tenantId_key" ON "ModelVersion"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Prediction_tenantId_modelVersionId_idx" ON "Prediction"("tenantId", "modelVersionId");

-- CreateIndex
CREATE INDEX "Prediction_tenantId_entityType_entityId_idx" ON "Prediction"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ForecastPoint_tenantId_modelVersionId_idx" ON "ForecastPoint"("tenantId", "modelVersionId");

-- CreateIndex
CREATE INDEX "ForecastPoint_tenantId_itemId_idx" ON "ForecastPoint"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "BasketPair_tenantId_modelVersionId_idx" ON "BasketPair"("tenantId", "modelVersionId");

-- CreateIndex
CREATE INDEX "BasketPair_tenantId_itemId_idx" ON "BasketPair"("tenantId", "itemId");

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_modelVersionId_tenantId_fkey" FOREIGN KEY ("modelVersionId", "tenantId") REFERENCES "ModelVersion"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastPoint" ADD CONSTRAINT "ForecastPoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastPoint" ADD CONSTRAINT "ForecastPoint_modelVersionId_tenantId_fkey" FOREIGN KEY ("modelVersionId", "tenantId") REFERENCES "ModelVersion"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketPair" ADD CONSTRAINT "BasketPair_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketPair" ADD CONSTRAINT "BasketPair_modelVersionId_tenantId_fkey" FOREIGN KEY ("modelVersionId", "tenantId") REFERENCES "ModelVersion"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
