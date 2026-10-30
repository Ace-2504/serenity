-- CreateTable
CREATE TABLE "AssistantLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "question" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "guardOk" BOOLEAN,
    "unmatched" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "audience" JSONB NOT NULL,
    "offer" JSONB,
    "subject" TEXT,
    "body" TEXT,
    "holdoutPct" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audienceApprovedAt" TIMESTAMP(3),
    "audienceApprovedBy" TEXT,
    "contentApprovedAt" TIMESTAMP(3),
    "contentApprovedBy" TEXT,
    "offerApprovedAt" TIMESTAMP(3),
    "offerApprovedBy" TEXT,
    "sendApprovedAt" TIMESTAMP(3),
    "sendApprovedBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "eligibility" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantLog_tenantId_createdAt_idx" ON "AssistantLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactConsent_tenantId_partyId_channel_recordedAt_idx" ON "ContactConsent"("tenantId", "partyId", "channel", "recordedAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_status_idx" ON "Campaign"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_tenantId_key" ON "Campaign"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_tenantId_campaignId_idx" ON "CampaignRecipient"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_tenantId_partyId_idx" ON "CampaignRecipient"("tenantId", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_id_tenantId_key" ON "CampaignRecipient"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_partyId_key" ON "CampaignRecipient"("campaignId", "partyId");

-- CreateIndex
CREATE INDEX "OutboxMessage_tenantId_campaignId_idx" ON "OutboxMessage"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "OutboxMessage_tenantId_recipientId_idx" ON "OutboxMessage"("tenantId", "recipientId");

-- AddForeignKey
ALTER TABLE "AssistantLog" ADD CONSTRAINT "AssistantLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_partyId_tenantId_fkey" FOREIGN KEY ("partyId", "tenantId") REFERENCES "Party"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_partyId_tenantId_fkey" FOREIGN KEY ("partyId", "tenantId") REFERENCES "Party"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_recipientId_tenantId_fkey" FOREIGN KEY ("recipientId", "tenantId") REFERENCES "CampaignRecipient"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
