# 02 — System Architecture

## 1. Shape: a modular monolith plus one Python worker

```
                         ┌──────────────────────────── Next.js app (existing repo) ────────────────────────────┐
 Browser ──HTTPS──▶      │  UI (App Router)    API route handlers (Zod-validated)    Auth/RBAC + tenant scope │
                         │        │                       │                                                     │
                         │        ▼                       ▼                                                     │
                         │  ┌─────────────┐   ┌──────────────────┐   ┌───────────────┐   ┌──────────────────┐   │
                         │  │ Storefront  │   │ Ingestion        │   │ Metrics layer │   │ Assistant (LLM)  │   │
                         │  │ (unchanged) │   │ adapters→staging │   │ deterministic │   │ tool registry →  │   │
                         │  │             │   │ →validate→commit │   │ SQL + TS      │   │ metrics/ML tools │   │
                         │  └─────┬───────┘   └────────┬─────────┘   └──────┬────────┘   └───────┬──────────┘   │
                         │        │ storefront adapter │                    │ findings engine    │              │
                         └────────┼────────────────────┼────────────────────┼────────────────────┼──────────────┘
                                  ▼                    ▼                    ▼                    │ OpenAI-compatible HTTP
                         ┌──────────────────────────── PostgreSQL 16 ─────────────────────┐      ▼
                         │ storefront tables │ canonical ledger │ staging │ derived/ML │ jobs │   Ollama / llama.cpp server
                         └──────────────────────────────▲─────────────────────────────────┘   (local, configurable)
                                                        │ reads features / writes predictions
                                              ┌─────────┴──────────┐
                                              │ Python ML worker   │  scikit-learn, statsmodels
                                              │ (batch, CLI/cron)  │  versioned model artefacts on disk
                                              └────────────────────┘
 External (opt-in, owner-enabled only): Tally/BUSY on owner's LAN · Email (SMTP) · WhatsApp Business Platform · Cloudinary · Razorpay
```

### Why this shape

| Decision | Choice | Rejected alternative and why |
|---|---|---|
| Services | **One Next.js app + one Python batch worker** | Microservices: no team-scaling need, and they add network failure modes, deployment and auth between services. |
| Language split | TS for product, ingestion and deterministic metrics; **Python only for ML** | All-TS ML: no mature equivalent of scikit-learn calibration, statsmodels ETS or time-series CV. All-Python backend: would discard the working app. |
| Database | **PostgreSQL only** (already in use) | Separate warehouse (ClickHouse/DuckDB): SME volumes (≤ 10⁶ voucher lines/year) fit Postgres comfortably with proper indexes and materialised views. |
| Analytical layer | **Plain SQL views + materialised views** refreshed after each import | dbt: good, but another toolchain. Revisit if the view count exceeds ~30. |
| Jobs / queue | **Postgres job table with `FOR UPDATE SKIP LOCKED`** | Redis/BullMQ: extra infrastructure for a few jobs per day. Revisit when campaign sends need rate-limited fan-out. |
| Vector DB | **None** | Questions are about structured numbers, which a tool registry answers better than retrieval. A KPI-dictionary lookup is a few kilobytes of text and fits in the prompt. |
| Money | `Decimal(18,2)` INR; quantity `Decimal(18,3)` | Floats: rounding errors. `Int` rupees (current storefront): loses paise, and aggregates can overflow. |
| LLM transport | **OpenAI-compatible chat-completions API** with a configurable `LLM_BASE_URL` | A hard Ollama SDK dependency: llama.cpp server, vLLM and LM Studio all speak the same protocol. |

## 2. Components

### 2.1 Ingestion (`src/server/ingest/`)

```
Source ─▶ Adapter.extract() ─▶ RawRecord[] ─▶ Adapter.map() ─▶ CanonicalDraft[] ─▶ validate() ─▶ staging tables
                                                                                                    │ owner reviews preview + issues
                                                                                                    ▼
                                                                        commit() in ONE DB transaction (idempotent upsert)
                                                                                                    ▼
                                                                    reconcile() vs source control totals ─▶ ImportBatch report
                                                                                                    ▼
                                                                         refresh materialised views ─▶ run findings rules
```

* **Adapter interface.** `{ kind, capabilities, extract(input), map(raw), controlTotals(raw) }`. The `capabilities` flags (`hasCost`, `hasBillwiseOutstanding`, `hasStockSnapshot`, `incremental`) feed both the UI and the metrics layer, so unavailable metrics show "not available from this source".
* **Adapters, in build order:**
  1. `demo` (synthetic generator)
  2. `csv_template`
  3. `storefront` (Serenity's own orders)
  4. `tally_xml` (file exports first, then live HTTP)
  5. `busy_excel`
* **Idempotency.** Every canonical row has `(tenantId, dataSourceId, sourceKey)` as a unique key. `sourceKey` is the source's own identifier, such as the Tally GUID or a template's `invoice_no + date`. A `contentHash` detects corrections: same key with a different hash → new version, old version `superseded`, and a diff is recorded.
* **File-level idempotency.** The SHA-256 of the uploaded file is stored. Re-uploading an identical file is a no-op and reports "already imported in batch #N".
* **Atomicity.** Commit runs in one transaction per batch. An interrupted import leaves the batch `failed` with staging intact; retrying is safe.
* **Deletions.** For full-period sources, vouchers present in the previous sync of the same period but absent now are marked `deleted_at_source`, never hard-deleted.

### 2.2 Metrics layer (`src/server/metrics/`)

* Pure functions in TS for formulas (unit-tested against hand-computed fixtures) plus SQL for aggregation.
* Every public metric is registered in `metricRegistry` with `{ id, formula, unit, periodSemantics, requiredCapabilities, sourceFields }`. That entry is the single source for the KPI dictionary page, the API, the LLM tool descriptions and the tests.
* Each metric returns `{ value | null, status: 'ok' | 'partial' | 'unavailable', reasons[], inputs }`. It never returns a bare number.

### 2.3 Findings engine (`src/server/findings/`)

Deterministic rules run after each import. Each produces a `Finding` with evidence (query + rows), ₹ impact (with formula), assumptions, suggested action and a measurement plan (metric, baseline, check date). Initial rules:

1. `SLOW_MOVER_CAPITAL`: no sale in ≥ 90 days, stock value ≥ ₹X
2. `MARGIN_EROSION`: GP% fell ≥ 5 pp vs prior period on material sales
3. `DISCOUNT_LEAKAGE`: discount % rising while GP% falls
4. `RECEIVABLES_OUTPACING_SALES`: AR growth > sales growth over 2 periods
5. `CUSTOMER_CONCENTRATION`: top 5 customers ≥ 50 % of net sales
6. `LAPSING_KEY_CUSTOMER`: purchase gap ≥ 2× their usual inter-purchase interval
7. `STOCKOUT_REPEAT`: stock hit zero ≥ N times in 90 days with positive demand

### 2.4 ML worker (`ml/`, Python)

* CLI entry points: `features`, `train`, `evaluate`, `predict`, run by cron or a job row.
* It reads canonical tables through a read-only DB role and writes only to `ml_*` tables (`ModelVersion`, `Prediction`, `ForecastPoint`).
* Model artefacts are versioned on disk (`ml/artifacts/<model>/<version>/`) with a `metadata.json` holding the training cutoff, feature list, metrics and data hash.

### 2.5 Assistant (`src/server/assistant/`)

```
question ─▶ LLM (tools = registry subset, JSON schema args) ─▶ tool call(s) ─▶ server validates args (Zod) ─▶ executes metric/ML tool
        ◀── LLM writes explanation from tool results ◀──────────────────────────────────────────────┘
        ─▶ numeric guard: every number in the answer must match a tool-result value (tolerant to rounding/format)
             fail → show tool tables + templated explanation, log the guard failure
```

* There is **no SQL generation.** The tools are parameterised functions over the metrics layer.
* Every answer stores `(question, tool calls, arguments, result hashes, model id, latency)` in `AssistantLog`.
* The model and hardware are configurable; see §4.

### 2.6 Campaigns (`src/server/campaigns/`)

States: `draft → audience_frozen → content_approved → test_sent → approved_to_send → sending → sent → measured`.

* Only `owner_admin` can move a campaign to `approved_to_send`.
* Channel adapters: `outbox` (local, default, writes to a table/file and is labelled "not sent"), `smtp_email` and `whatsapp_cloud`. WhatsApp business-initiated messages require an approved template and recorded opt-in.
* Consent is checked at send time, not only at audience build time.
* A random **holdout** (default 15 %) is drawn when the audience is frozen and receives nothing; the outcome compares the conversion of the treated group against the holdout.

## 3. Security and tenancy

* **Tenancy.** Every new table carries `tenantId`. All access goes through `forTenant(session)` repository helpers. Raw `prisma.*` on tenant tables is lint-banned outside `src/server/db/`. Postgres row-level security (RLS) is added in hardening (Phase 7) as defence in depth, via `SET LOCAL app.tenant_id` inside transactions.
* **Roles** extend the existing enum, per tenant via `Membership`:
  * `owner_admin`: everything, including campaign send approval
  * `accountant`: imports, data quality
  * `analyst`: read-only analytics
  * the existing storefront roles
* **Sessions.** Fix debt items 1–3 (expiry, no default secret, constant-time compare). The token carries `sessionVersion` so logout-everywhere is possible.
* **Secrets** live only in env vars and are never in logs. The pino logger redacts `authorization`, `cookie`, `*secret*`, `*token*`, `phone` and `email`.
* **Uploads.** Size limit, MIME + magic-byte sniffing, XML parsed with external entities disabled (XXE), formula-injection-safe CSV export (prefix `=+-@` with `'`).
* **Audit log.** Imports, commits, finding status changes, campaign approvals and sends, role changes, LLM tool calls.

## 4. Local LLM deployment profiles

| Profile | Hardware | Suggested model class | Expected use |
|---|---|---|---|
| `off` | any | none | All analytics work without the LLM; the assistant is hidden. |
| `small` | 8 GB RAM, CPU only | ~3–4B instruct, 4-bit quantised | Short explanations; slow (seconds per sentence); tool calling less reliable |
| `standard` | 16 GB RAM or 8 GB GPU | ~7–9B instruct with tool calling, 4-bit | Recommended default |
| `server` | Private server with a 24 GB+ GPU | 14–32B | Multi-lingual campaign copy, better tool selection |

Model names are configuration (`LLM_MODEL`), not code. The candidate list is re-evaluated on a fixed question set (`ml/eval/assistant_questions.yaml`) measuring tool-selection accuracy, argument validity and numeric-guard pass rate. Results are published in the repo rather than assumed.

## 5. Data that leaves the machine

| Component | Default | What is sent | How to disable |
|---|---|---|---|
| Local LLM | on-box | nothing external | `LLM_PROFILE=off` |
| Remote LLM endpoint | **disabled** | the question + tool results | requires `LLM_ALLOW_REMOTE=true` + explicit owner toggle |
| Email (SMTP) | disabled | recipient, message body | channel not configured |
| WhatsApp Cloud API | disabled | phone, template params | channel not configured |
| Cloudinary | storefront only | product images | existing env |
| Razorpay | disabled | payment data | existing flag |

## 6. Observability

* pino structured logs with a request ID and tenant ID.
* `ImportBatch` timing/counts and `JobRun` rows act as operational metrics. A `/admin/system` page shows import success rate, last successful sync per source, job failures and assistant guard-failure rate.
* Health endpoint extended with DB and LLM reachability.
