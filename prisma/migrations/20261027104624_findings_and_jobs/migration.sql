-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'accepted', 'dismissed', 'snoozed', 'resolved');

-- CreateEnum
CREATE TYPE "FindingKind" AS ENUM ('measured', 'predicted', 'suggested');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "kind" "FindingKind" NOT NULL DEFAULT 'measured',
    "asOf" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "impactInr" DECIMAL(18,2),
    "impactFormula" TEXT,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "measurePlan" JSONB NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'open',
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "snoozedUntil" DATE,
    "ownerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingOutcome" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "measuredOn" DATE NOT NULL,
    "metricValue" DECIMAL(18,4),
    "realisedImpactInr" DECIMAL(18,2),
    "verdict" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "progress" TEXT,
    "result" JSONB,
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Finding_tenantId_status_idx" ON "Finding"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_id_tenantId_key" ON "Finding"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_tenantId_dedupeKey_key" ON "Finding"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "FindingOutcome_tenantId_findingId_idx" ON "FindingOutcome"("tenantId", "findingId");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_tenantId_createdAt_idx" ON "Job"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingOutcome" ADD CONSTRAINT "FindingOutcome_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingOutcome" ADD CONSTRAINT "FindingOutcome_findingId_tenantId_fkey" FOREIGN KEY ("findingId", "tenantId") REFERENCES "Finding"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
