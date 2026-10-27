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

## Channels and LLM runtime

| Item | Finding | Conf. |
|---|---|---|
| WhatsApp Business Platform (Cloud API) | Requires opt-in naming the business and purpose. Business-initiated messages outside the 24-hour customer-service window need approved templates. Per-message pricing by category/country since 1 Jul 2025. A pricing change effective 1 Oct 2026 was reported; **re-check the live pricing page before any cost estimate** | M |
| Ollama | `/v1/chat/completions` (OpenAI-compatible) supports `tools` and `response_format`, **not `tool_choice`**. Native `/api/chat` accepts a JSON-schema `format` | H |

Design consequence: because forced tool choice is unavailable, the assistant cannot force a tool call. It validates the model's reply: no tool call for a numeric question → retry once with a stricter system prompt → fall back to "I couldn't map that to an approved report" plus a list of supported questions.
