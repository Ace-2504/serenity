# 07 — Accounting & Channel Integration Research

Researched 2026-10-27. **Method and its limits:** the official sites (help.tallysolutions.com, busy.in, developers.facebook.com) were unreachable from the research sandbox, so their content was seen only as search-result excerpts. Two open-source TallyPrime connectors were read in full: `dhananjay1405/tally-database-loader` and `tally-mcp-server`. Their code shows **working practice, not official specification**. The Ollama docs were read in full from the `ollama/ollama` repo.

Confidence: **H** = read in full / confirmed in working code · **M** = official page seen as an excerpt · **L** = third-party only · **U** = unverified. Nothing here has been tested against a live Tally or BUSY instance yet.

## TallyPrime

| Mechanism | What it gives | Limitations | Conf. |
|---|---|---|---|
| **XML over HTTP** (TallyPrime as server, default port 9000) | `TALLYREQUEST` Export/Import; `TYPE` Data/Collection/Object; custom TDL collection definitions inline in the request; `SVFROMDATE`/`SVTODATE`/`SVCURRENTCOMPANY` static variables | Tally GUI must be running with the company loaded; connectivity must be enabled in settings (menu path differs by release) | M (docs) / H (code) |
| Entities over XML | `Voucher` (filter `VoucherTypeName`: Sales, Purchase, Credit/Debit Note, Receipt, Payment, Stock Journal), `Ledger`, `StockItem` (ClosingBalance/Rate/Value, CostingMethod), `StockGroup`, `Godown`; bills via `AllLedgerEntries.BillAllocations` and ledger opening bill allocations | Bill-wise data only exists for ledgers with bill-by-bill tracking on. Cancelled and optional vouchers must be filtered out | H |
| **Incremental sync** | Company `$AltMstId` / `$AltVchId`; per-object `$AlterID` and `GUID`; filter `$AlterID > cursor` | **Deletions are not signalled.** They need a periodic full GUID comparison. The reference implementation calls incremental mode riskier than full sync and limits it to one financial year. AlterID semantics are not officially documented | H (code) / U (official) |
| Native JSON | JSON request/response alongside XML | **TallyPrime 7.0+ only**; exact schema not seen; general-availability date unverified | M |
| ODBC | Collections as tables; 64-bit DSN since 4.5 | Tally must be open; bitness of Tally, OS and Office must match; read-only status unverified | M |
| Manual export | Alt+E → Excel / XML / JSON / PDF etc. on any report | Needs a human; no CSV option in the UI | M |
| Cost data | **Sales voucher lines carry no COGS.** Cost comes from stock valuation (Sales Register with profit, StockItem closing value). Valuation method is **set per item** (Avg Cost default, FIFO, LIFO, Standard, Last Purchase, Monthly Avg, …) | Per-item method must be captured; our derived WAC is reconciled against Tally's closing value, not presumed equal | H / M |
| Licensing | Silver single-user, Gold multi-user LAN; Educational (unlicensed) mode is date-restricted | Exact Educational-mode date rule for TallyPrime is U | M |

**Pitfalls to design for (H, from connector code):**
* Responses contain invalid character references such as `&#4;`, which must be stripped before parsing.
* UTF-16 request/response encoding.
* With several companies open, always send the exact XML-escaped company name.
* Tally sometimes returns stale data after long uptime.
* No documented export-size limits. Chunking by month is our own choice.

## BUSY

| Mechanism | What it gives | Limitations | Conf. |
|---|---|---|---|
| Official API | "BUSY API Services" plugin, sold through channel partners | No public documentation; FAQs contradict each other | M |
| Database | MS Access backend by default; SQL Server mode for large/client-server setups | No official schema or ODBC documentation. Reading it directly would be reverse-engineering, so **we will not** | M / L |
| XML export | Masters and vouchers by type and date range (Standard/Enterprise) | Manual; schema unpublished | M |
| Excel export/import | Reports export to Excel; masters/vouchers import with column mapping | Manual | M |

**Conclusion:** there is no automatable, documented BUSY interface. BUSY support is **file upload of Excel/XML exports** through a column-mapping adapter.

## Decision for this project

1. **MVP route: file-based imports.** Our CSV/XLSX template for any source, plus Tally XML exports. This is testable without a licence and works with every Tally version.
2. **Live Tally adapter (M10):** XML over HTTP with inline TDL collections; monthly chunks; upsert by GUID; AlterID cursor as an optimisation; full re-sync as the safe default; periodic GUID comparison to catch deletions. JSON (7.0+) is a later option behind the same adapter interface.
3. **Fixtures:** synthetic UTF-16 XML built from field lists documented in the open-source connector config, with deliberate `&#4;` junk and truncation cases. Real recorded responses (Educational mode or a pilot business) replace them when available. Until then the adapter is labelled **"verified on fixtures only"** in the UI and README.
4. **BUSY:** Excel/XML upload adapter with saved column mappings; API plugin out of scope.

### Status of the Tally XML file adapter (M4, built 2026-10-27)

`src/server/adapters/tally/` converts a TallyPrime "Data Interchange" XML export (masters plus the Day Book) into the import template. The result then goes through the normal validation, staging, reconciliation and commit.

**Verified on fixtures only.** The fixtures are hand-written from the export structure described above. They have never been compared with a file exported by a real TallyPrime, and the UI says so on every Tally import.

| Handled | How |
|---|---|
| UTF-8 / UTF-16 LE / UTF-16 BE, with or without BOM | byte-order detection |
| `&#4;` and other control-character references | stripped before parsing (count reported) |
| DTD / ENTITY declarations | refused (entity-expansion guard; Tally never writes them) |
| Truncated or malformed XML | upload refused with the file name; nothing staged |
| Custom voucher types | resolved through `VOUCHERTYPE` masters to Sales, Purchase, Credit Note, Debit Note, Receipt or Payment |
| Invoice view and accounting view | items read from `ALLINVENTORYENTRIES.LIST`/`INVENTORYENTRIES.LIST` and from `INVENTORYALLOCATIONS.LIST` under ledger entries |
| Debit-negative amounts | sign per voucher type. Each voucher must balance (items + GST + other ledgers = party amount) or it is rejected |
| GST | line rate from the item's `GSTDETAILS` valid on the voucher date (else the voucher's effective rate if it is a standard slab). Line GST allocated to equal the GST ledgers |
| Round-off, freight, cess, non-item sales lines | kept in the bill total (`adjustment_incl_tax`), not in product sales; reported |
| Bill references | the "New Ref" name identifies the bill. Receipts, payments and credit notes link through "Agst Ref". On-account and advance amounts are reported, not imported |
| Free quantity (billed < actual) | stock moves the actual quantity; the price is spread over it |
| Opening and closing stock | from `STOCKITEM` masters; closing stock feeds the stock check against our rebuilt ledger |

**Not handled yet:**
* Stock journals, delivery and receipt notes, rejections: skipped with a warning that stock will differ.
* Journals and contras.
* Opening bill-wise balances.
* Multi-currency details.
* Batch/godown allocations.
* Bills Outstanding reports.

**Keys.** Records are keyed like the template (voucher type + number, ledger and item names), not by Tally GUID. Renumbering a voucher in Tally therefore creates a new record and marks the old one deleted at source. GUID-based keys come with the live sync (M10b).

**Control totals.** These are computed from the ledger side of each voucher. Because every voucher must balance, they confirm the conversion end to end, but they cannot prove the export is complete. Compare with Tally's Sales and Purchase Register for the same period.

## Channels and LLM runtime

| Item | Finding | Conf. |
|---|---|---|
| WhatsApp Business Platform (Cloud API) | Requires opt-in naming the business and purpose. Business-initiated messages outside the 24-hour customer-service window need approved templates. Per-message pricing by category/country since 1 Jul 2025. A pricing change effective 1 Oct 2026 was reported; **re-check the live pricing page before any cost estimate** | M |
| Ollama | `/v1/chat/completions` (OpenAI-compatible) supports `tools` and `response_format`, **not `tool_choice`**. Native `/api/chat` accepts a JSON-schema `format` | H |

Design consequence: because forced tool choice is unavailable, the assistant cannot force a tool call. It validates the model's reply: no tool call for a numeric question → retry once with a stricter system prompt → fall back to "I couldn't map that to an approved report" plus a list of supported questions.

## Marketplaces and quick commerce (researched 2026-10-27)

Same method and limits as above. The official seller sites were unreachable from the research sandbox. Amazon's own SP-API model files on GitHub were read in full (H). Other claims come from official-page excerpts (M) or third parties (L).

| Platform | Data access | Key facts for the cost model | Conf. |
|---|---|---|---|
| **Amazon.in** | SP-API: Orders; Finances v0 `listFinancialEvents` (per-item principal, tax, **TCS lines**, fees, refunds; one event group per settlement); Settlement Report V2 flat file (Amazon-generated, 90-day availability). Private apps need self-authorisation; a product for many sellers needs public-developer registration. Buyer PII needs restricted roles + Restricted Data Tokens. **We need neither.** | Fee components: referral, closing, weight-handling/shipping, FBA, refund administration. Referral fee for stationery under ₹1,000 shown as 0% (zero-referral expansion from Mar 2026). Payout ~7 days after delivery on a 7/14-day cycle: read actual dates from data. **TDS reported per period** (TaxWithholdingEvent), TCS per item | H (API) / M (fees) |
| **Meesho** | No public supplier API found. Panel exports: payments download; GST ZIP (`tcs_sales.xlsx`, `tcs_sales_return.xlsx`) after the 5th of next month; deductions/penalties section | 0% commission; seller pays zone/weight shipping and customer-return shipping; RTO no fee; paid ~7 days after delivery (one official page says 15) | M / L |
| **Blinkit** | Seller Hub; no official export/API docs found | **Inventory-led since 1 Sep 2025:** Blinkit's entity buys stock against POs, so it is a **B2B sale**. Buy price, terms not public. Fill-rate debits for short supply | L / M |
| Zepto / Instamart | Zepto Atom is a paid dashboard (no API); Instamart wholesale-style | Zepto pays suppliers in 30–60 days | L |

**Tax withheld by e-commerce operators:** GST TCS **0.5%** of net taxable supplies (s.52 CGST; Notification 15/2024-CT from 10 Jul 2024). Income-tax TDS **0.1%** under s.194-O from 1 Oct 2024 (s.393(1) of the Income-tax Act 2025 from 1 Apr 2026, L). Both are tax credits, not costs. Several 2026 blogs still quote 1%; they are out of date.

**Decision:** file upload first (Amazon Settlement V2, Meesho payments + GST ZIP, Blinkit PO/GRN/debit notes) via adapters that map to canonical vouchers + `ChannelCharge`. Amazon SP-API comes second, using only Finance & Accounting and Inventory & Order Tracking roles (no PII). Quick commerce is modelled as a B2B customer with fill rate, not as a marketplace.

### Status of the marketplace and quick-commerce file adapters (M10a, built 2026-10-27)

All three adapters are **tested on hand-made fixtures only**. Each import is labelled unverified on the review screen.

| Adapter | Input | Output | Confidence in the format |
|---|---|---|---|
| Amazon | Settlement Report V2 flat file (tab-separated) | channel charges. Fee GST merged into its fee; TCS/TDS as tax credits; storage/ads/TDS at period level. **Each settlement's rows must add up to its deposit** or the import is rejected | Columns M (documented layout); India fee and tax line names L. Unknown lines are kept as `other_fee` and listed |
| Meesho | Payments export (Excel or CSV) | channel charges. Fees shown incl. GST split at an assumed 18%; compensation credited; unpaid sub-orders skipped. The sign convention is detected from the data | L (public samples). Unrecognised money columns are listed, not imported |
| Blinkit / Zepto / Instamart | PO and GRN files (Excel or CSV), joined on PO + SKU; optional `sku_map.csv` | customer purchase-order lines → fill rate | L (common header aliases). The columns used are shown on the review screen; unmapped SKUs block the import rather than being guessed |

**Not built yet:**
* Meesho GST/TCS ZIP reports.
* Quick-commerce debit notes (fill-rate penalties). They can be imported as channel charges through the template.
* Amazon SP-API (M10b; needs the seller's account).
