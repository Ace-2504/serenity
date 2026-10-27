-- Row-level security on every tenant table (defence in depth; see docs/platform/09-operations.md).
--
-- A session that declares a business with app.tenant_id sees and writes only that business's rows.
-- A session that sets app.tenant_required = 'on' (the ML worker) sees nothing until it declares one.
-- Sessions that declare neither (the web app, whose queries are scoped by forTenant(), and the job
-- queue, which claims jobs across businesses) are not narrowed. FORCE applies the policies to the
-- table owner too; superusers bypass row-level security, so production must not run as one.

CREATE OR REPLACE FUNCTION app_tenant_allows(row_tenant text) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL THEN row_tenant = current_setting('app.tenant_id', true)
    ELSE COALESCE(current_setting('app.tenant_required', true), '') <> 'on'
  END
$$;

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Membership" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Membership" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "DataSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "DataSource" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "DataSource" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ImportBatch" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ImportBatch" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ImportIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportIssue" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ImportIssue" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ImportIssue" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "SourceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "SourceRecord" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "SourceRecord" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Party" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Party" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Party" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Party" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ItemGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItemGroup" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ItemGroup" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ItemGroup" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Item" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Item" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Item" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Batch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Batch" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Batch" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Voucher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Voucher" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Voucher" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Voucher" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "VoucherLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VoucherLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "VoucherLine" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "VoucherLine" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "StockMovement" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "StockMovement" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "StockSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "StockSnapshot" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "StockSnapshot" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "OutstandingSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutstandingSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "OutstandingSnapshot" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "OutstandingSnapshot" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "AuditLog" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "AuditLog" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ImportFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportFile" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ImportFile" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ImportFile" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "BillAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "BillAllocation" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "BillAllocation" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ChannelCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChannelCharge" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ChannelCharge" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ChannelCharge" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "CustomerOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerOrderLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "CustomerOrderLine" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "CustomerOrderLine" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ModelVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModelVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ModelVersion" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ModelVersion" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Prediction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Prediction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Prediction" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Prediction" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ForecastPoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForecastPoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ForecastPoint" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ForecastPoint" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "BasketPair" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BasketPair" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "BasketPair" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "BasketPair" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "AssistantLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssistantLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "AssistantLog" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "AssistantLog" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "ContactConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactConsent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "ContactConsent" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "ContactConsent" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Campaign" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Campaign" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "CampaignRecipient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignRecipient" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "CampaignRecipient" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "CampaignRecipient" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "OutboxMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "OutboxMessage" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "OutboxMessage" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Finding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Finding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Finding" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Finding" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "FindingOutcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FindingOutcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "FindingOutcome" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "FindingOutcome" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));

ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Job" FORCE ROW LEVEL SECURITY;
CREATE POLICY "all_rows" ON "Job" AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tenant_scope" ON "Job" AS RESTRICTIVE FOR ALL
  USING (app_tenant_allows("tenantId")) WITH CHECK (app_tenant_allows("tenantId"));
