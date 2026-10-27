# 03 — Canonical Data Model

All canonical tables are **tenant-scoped** (`tenantId` on every row, first column of every composite index). Money is `Decimal(18,2)` INR; quantities are `Decimal(18,3)` in the item's base unit. All amounts exclude GST unless the column name says `…InclTax`. Storefront tables in `schema.prisma` are untouched.

## 1. Entity map

```
Tenant ─┬─ Membership ── User (existing)
        ├─ DataSource ─── ImportBatch ─┬─ ImportIssue
        │                              └─ SourceRecord (raw payload, hash)  ◀── lineage for every canonical row
        ├─ Party (customer | supplier | both)
        ├─ ItemGroup ── Item ─┬─ Batch (optional: batch no, expiry)
        │                    └─ (optional link) ProductVariant (storefront)
        ├─ Voucher ── VoucherLine ── StockMovement
        │     └─ BillAllocation (receipt/payment ↔ invoice)
        ├─ StockSnapshot        (source-reported closing qty/value as of date)
        ├─ OutstandingSnapshot  (source-reported bill-wise AR/AP as of date)
        ├─ Finding ── FindingOutcome
        ├─ ModelVersion ── Prediction / ForecastPoint
        ├─ Campaign ── CampaignAudienceMember ── CampaignMessage
        ├─ ConsentRecord
        └─ AuditLog, AssistantLog, Job
```

## 2. Core entities

### Tenant / Membership
| Field | Notes |
|---|---|
| `Tenant.id, name, gstin?, stateCode?, fyStartMonth (default 4)` | Indian FY starts in April; period helpers use this |
| `Tenant.isDemo` | Demo tenants are created only by the generator; the UI shows a persistent banner |
| `Tenant.settings (Json)` | Thresholds: slow-mover days, ageing buckets, holdout %, valuation method |
| `Membership(userId, tenantId, role)` | role ∈ `owner_admin, accountant, analyst` |

### DataSource / ImportBatch / ImportIssue / SourceRecord
| Field | Notes |
|---|---|
| `DataSource.kind` | `demo, csv_template, storefront, tally_xml, tally_http, busy_excel` |
| `DataSource.capabilities (Json)` | `hasCost, hasBillwise, hasStockSnapshot, incremental` |
| `DataSource.lastSuccessfulSyncAt, lastAlterId?` | Incremental cursor (Tally AlterID) when supported |
| `ImportBatch.status` | `staged → validated → committed` or `failed / rejected` |
| `ImportBatch.fileSha256, periodFrom, periodTo, counts (Json), controlTotals (Json), reconciliation (Json)` | `fileSha256` is unique per data source |
| `ImportIssue(batchId, severity: error|warning|info, code, entity, rowRef, field, message)` | Errors block commit; warnings need acknowledgement |
| `SourceRecord(tenantId, dataSourceId, entity, sourceKey, version, contentHash, payload Json, batchId, supersededAt?)` | Keeps the raw truth; canonical rows point to the current version |

### Party
`id, tenantId, sourceKey, dataSourceId, name, kind (customer|supplier|both), gstin?, stateCode?, city?, segmentTag?, creditDays?, phone?, email?, createdAtSource?`
* Unique: `(tenantId, dataSourceId, sourceKey)`.
* Cross-source identity (the same customer in Tally and the storefront) uses a `PartyLink` table. Matching on GSTIN, then phone, is suggested to the user and **never auto-merged**.

### ItemGroup / Item / Batch
`Item: id, tenantId, sourceKey, sku?, name, itemGroupId?, uom, hsnCode?, gstRate?, isActive, tracksBatches, attributes (Json), variantId?`
* `attributes` is validated by the tenant's domain pack (`08-domain-packs.md`). For example, pharmacy carries `composition` and `schedule`; stationery carries `brand`.
* `variantId` links to a storefront `ProductVariant` when the same SKU is sold online.

`Batch: id, tenantId, itemId, batchNo, mfgDate?, expiryDate?, mrp?`. Optional, used when `Item.tracksBatches`. Unique `(tenantId, itemId, batchNo)`. `VoucherLine`, `StockMovement` and `StockSnapshot` carry an optional `batchId`. Stationery leaves it null; pharmacy requires it.

### Voucher (document header)
| Field | Notes |
|---|---|
| `type` | `sales_invoice, sales_return, purchase_invoice, purchase_return, receipt, payment, stock_adjustment, opening_stock` |
| `number, date, partyId?, dueDate?, channel?` | `channel`: `offline`, `storefront`, `bulk` |
| `grossAmount, discountAmount, taxableAmount, taxAmount, roundOff, totalInclTax` | Header totals **as stated by the source**, kept for reconciliation |
| `status` | `active, cancelled, superseded, deleted_at_source` |
| `sourceKey, sourceVersion, dataSourceId, sourceRecordId` | Lineage |
| `originalVoucherId?` | Return → original invoice, when the source provides it |

### VoucherLine
`id, voucherId, lineNo, itemId?, qty, rate, grossAmount (=qty×rate), discountAmount, taxableAmount, taxRate, taxAmount, costAmount?, costBasis`
* `costBasis ∈ source_provided | derived_wac | unknown`.
* Invariant (validated at import): `taxableAmount = grossAmount − discountAmount` (±₹0.01), and Σ lines + header-level adjustments = header `taxableAmount` (±₹1 rounding, else an `ImportIssue`).
* Invoice-level discounts are allocated pro-rata to lines by `grossAmount`. The allocation is recorded, so line-level metrics stay additive.

### StockMovement (perpetual ledger, derived on commit)
`id, tenantId, itemId, date, voucherLineId?, qtyIn, qtyOut, unitCost?, valueIn?, valueOut?, runningQty, runningValue, reason`
* Built from vouchers in date order:
  * purchases → in at purchase taxable rate (landed cost excluding recoverable GST)
  * purchase returns → out at original cost
  * sales → out at weighted-average cost (WAC) at that moment
  * sales returns → in at the cost recorded on the original sale (or current WAC if the original is unknown, flagged)
  * stock adjustments → as stated
* `opening_stock` vouchers seed quantity and value. **If opening stock is missing for an item, its COGS before the first purchase is `unknown`, not zero.**
* Rebuilt for an item whenever a back-dated voucher arrives (SME volumes make full per-item rebuilds cheap).

### StockSnapshot / OutstandingSnapshot (source-reported)
* `StockSnapshot(itemId, asOf, qty, value?, valuationMethod?)` comes from Tally Stock Summary or the template. Used to **reconcile** our derived ledger (variance shown) and as the authoritative closing value when the source provides it.
* `OutstandingSnapshot(partyId, side: receivable|payable, billRef, billDate, dueDate?, amountInclTax, pendingInclTax, asOf)` comes from bill-wise outstanding reports. Used for AR/AP ageing.

### ChannelCharge (added with the M3 import migration)
Line-level deductions a channel makes from its payouts, from marketplace settlement reports or gateway statements. Fields follow `07-integration-research.md`:
`channel, settlementRef, periodFrom?, periodTo?, payoutDate, postedDate?, status (deferred|released), orderRef?, voucherId?, sku?, qty?, eventType (sale|refund|return|rto|cancel|reimbursement|ads|storage|adjustment), chargeType (normalised) + rawLabel, amount (signed), gstOnCharge, isTaxWithheld, allocationBasis?, sourceRecordId`.
* `isTaxWithheld` (GST TCS, income-tax TDS) marks claimable credits. They affect cash, never contribution.
* Period-level lines (e.g. Amazon TDS, storage, ads, penalties) have no order (`allocationBasis = "period"`). They are **not** spread over orders: the Channels page shows them separately as "fees not tied to an order", and contribution excludes them. Allocating them would need a stated basis the owner agrees to.
* `Voucher.channel` holds the channel id; `Voucher.orderRef` holds the platform order id that joins vouchers to charges.
* **Linking across sources (M10a).** Marketplace files are a separate data source from the books. After every commit, unlinked order-level charges are linked to the sales invoice whose `number` or `orderRef` equals the charge's `orderRef`, whichever side was imported first. When several invoices match (one order split across invoices), the earliest is used and the link is counted as ambiguous.

### CustomerOrderLine (added in M10a)
`channel, poNumber, poDate, partyId, itemId, qtyOrdered, qtySupplied, unitPrice?, grnDate?, status, sourceRecordId`, unique per `(tenant, dataSource, channel|po|item)`. These are purchase orders a business customer (Blinkit, Zepto, Instamart, a distributor) placed, and the GRN quantity supplied against each line: the basis of `fill_rate`.
* Items and parties are resolved across the business's books, because PO files come from a different source.
* Deleted-at-source semantics follow vouchers: lines missing from a newer file covering the same PO dates are marked `deleted_at_source`.

### BillAllocation
`(paymentVoucherId, invoiceVoucherId, amount)`: receipts and payments allocated against bills when the source has bill-wise detail. When absent, ageing uses FIFO allocation (oldest bill first), labelled as an assumption.

## 3. Derived / decision entities

| Entity | Key fields |
|---|---|
| `Finding` | `ruleId, entityType, entityId, period, severity, title, evidence (Json: query id, params, rows), impactInr?, impactFormula, assumptions[], suggestedAction, measurePlan (metricId, baseline, checkOn), status (open, accepted, dismissed, snoozed, resolved), kind = 'measured' | 'predicted' | 'suggested'` |
| `FindingOutcome` | `findingId, measuredOn, metricValue, realisedImpactInr?, notes` |
| `ModelVersion` | `model, version, trainedAt, dataCutoff, featureList, metrics (Json), dataHash, status` |
| `Prediction` | `modelVersionId, entityId, asOf, horizonDays, score, interval?, topFactors (Json)` |
| `ForecastPoint` | `modelVersionId, itemId, periodStart, yhat, lo80, hi80` |
| `Campaign` | `name, objective, segmentDef (Json), offer?, channel, status, approvedBy?, approvedAt?, holdoutPct` |
| `CampaignAudienceMember` | `campaignId, partyId, group (treatment|holdout), reason (Json evidence)` |
| `CampaignMessage` | `campaignId, partyId, channel, renderedBody, providerMessageId?, status, sentAt?, error?` |
| `ConsentRecord` | `partyId, channel, status (opted_in|opted_out), source, capturedAt, evidence` |
| `AuditLog` | `tenantId, actorUserId, action, entity, entityId, before?, after?, at, requestId` |

## 4. Key invariants (enforced by tests)

1. Net sales of a period = Σ sales-invoice taxable − Σ sales-return taxable, over **active** vouchers dated in the period.
2. For every item: final `runningQty` = opening + Σ in − Σ out, and it equals `StockSnapshot.qty` when one exists. Otherwise a reconciliation issue is raised.
3. Import is idempotent: importing the same batch twice yields identical canonical tables (row count and checksums).
4. No canonical row exists without a `SourceRecord`.
5. No query in `src/server/` touches a tenant table without a `tenantId` predicate (repository helper + test that seeds two tenants and asserts zero cross-reads).
