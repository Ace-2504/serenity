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

### 2.3 Findings engine (`src/server/findings/`) — built in M7

Deterministic rules (`rules.ts`) are pure functions over a context computed once per refresh (`context.ts`). The same data always gives the same findings, and text is templated, never generated. Each finding carries:
* what happened;
* evidence (facts, plus an optional table);
* why it matters;
* a suggested action;
* a ₹ impact with its formula (or `null` for unquantified risks);
* assumptions;
* a measurement plan: metric, baseline, target, direction and check-after days.

| Rule | Fires when | Impact estimate |
|---|---|---|
| `SLOW_MOVER_CAPITAL` | in stock, no sale for ≥ pack `slowMovingDays`, value ≥ ₹10K (top 10) | stock value at cost |
| `MARGIN_EROSION` | group GP% over the last 90 days ≥ 5 pts below the same window last year, ≥ ₹50K sales | pts lost × sales × 365/90 |
| `DISCOUNT_LEAKAGE` | group discount rate ≥ 2 pts above the same window last year | pts added × gross × 365/90 |
| `COLLECTIONS_SLOWING` | business DSO up ≥ 7 days, or customers paying ≥ 15 days later than a year ago (≥ 3 paid invoices in each window) | DSO-based, or Σ credit sales/day × extra days |
| `CUSTOMER_CONCENTRATION` | top 5 ≥ 50 % of net sales, or one buyer ≥ 25 % | none (risk) |
| `LAPSING_KEY_CUSTOMER` | RFM segment "lapsing" (season-aware; see M6), top 10 by value | yearly purchases × business GP% |
| `STOCKOUT_REPEAT` | ≥ 45 stockout days in the last year while still selling | units/day × stockout days × GP/unit |
| `CHANNEL_LOSS_MAKER` | marketplace contribution < 0 over 12 months, ≥ 5 orders (top 10) | the loss |

**Lifecycle** (`engine.ts`). `refreshFindings` upserts by `(tenant, dedupeKey)`:
* open and snoozed findings are updated, and an expired snooze reopens;
* resolved findings reopen;
* accepted findings keep their frozen measurement plan;
* dismissed findings stay dismissed;
* open findings no longer produced are resolved by `system`.

Only the owner (`CAN_DECIDE`) accepts, snoozes, dismisses or reopens a finding; every decision is audit-logged.

**Measurement.** Accepting records `startedOn` (the data date) and `checkOn`. When imported data reaches `checkOn`, `measureOutcomes` measures the metric over `(startedOn, checkOn]` from the ledger and stores a `FindingOutcome`:
* a verdict against the target;
* a realised ₹ figure where it is directly measurable;
* a caveat that the outcome does not prove causation.

Estimates and measured results are never summed together. All dates are data dates, not wall-clock dates.

### 2.3a Background jobs (`src/server/jobs/`) — built in M7

* **Storage.** A `Job` table in Postgres; workers claim with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`.
* **Retries.** Retries with backoff (30 s, 2 min) up to 3 attempts. Data errors (validation, reconciliation) are not retried.
* **Recovery.** Stale locks (> 15 min without a progress heartbeat) are requeued.
* **Job types.** `import.commit`, `demo.load` and `findings.refresh`. Each data load is followed by a findings refresh and outcome measurement.
* **Running jobs.** By default the web process drains the queue after enqueueing. With `JOBS_MODE=worker`, the web process only enqueues and `npm run worker` processes. Polling a queued job also nudges the queue, so a frozen serverless function is recovered.
* **API.** It returns `202 { jobId }`, and the UI polls `/api/bi/jobs/{id}` for progress.

### 2.4 ML worker (`ml/`, Python) — built in M8

* **Running it.** `python -m serenity_ml run --tenant <id> [--as-of DATE]` trains, backtests against baselines, and writes `ModelVersion` plus its outputs (`Prediction`, `ForecastPoint`, `BasketPair`) in one transaction. Earlier versions become `superseded`; their metrics stay, their outputs are removed. The app runs it as the `ml.run` job, from the Predictions page or after imports when `ML_AUTORUN=1`.
* **Isolation.** The child process gets only `DATABASE_URL` and a minimal `PATH`. Every query filters by tenant. Its single JSON summary line carries metrics, never data values.
* **No artefacts on disk.** Models are cheap to refit (about 10 s on the full demo), so each run refits from the ledger; the metrics, feature list, cutoff and data hash are stored on `ModelVersion`.
* **Models:**
  * **Repeat purchase (60 days).** Logistic regression on log-scaled RFM-style features, against three baselines (recency, RFM score, bought in the same season last year) over 3 held-out windows. Leakage is prevented by construction: features use only data up to the cutoff, and training label windows close before each test window. Tests cover both.
  * **Weekly demand.** Six methods (naive, seasonal naive, 8-week average, SES, Croston, SBA) scored by MASE on 3 rolling origins with a 4-week horizon.
  * **Basket pairs.** Support, confidence and lift; a statistic, not a model.
* **Ship rule.** A model ships only if it beats the best baseline: by ≥ 0.01 mean AUC while winning most windows (repeat purchase), or by ≥ 2% mean MASE (demand). Otherwise the baseline ships, and the Predictions page says so.

### 2.5 Assistant (`src/server/assistant/`) — built in M9

```
question ─▶ model (11 tools, JSON-schema args) ─▶ tool call(s) ─▶ server validates args (Zod) ─▶ runs a report function
        ◀── model writes the answer from the tool results ◀──────────────────────────────────────┘
        ─▶ numeric guard: every number in the answer must match a tool-result value (within its displayed rounding)
             fail → the report's own templated summary is shown instead, with a note; the failure is logged
```

* **No SQL generation.** The 11 tools (`tools.ts`) are parameterised functions over the analytics layer: profit overview, top products, product detail, slow stock, customer segments, customer detail, receivables, cash cycle, open findings, channel performance, metric definition. An unknown tool name or invalid argument is returned to the model as an error, so it can correct itself.
* **Retries and fallback.** At most 4 tool rounds. If the model answers without calling a tool, it is asked once more; then a keyword router picks the matching report and its template answers. With no model configured or reachable, the router answers directly; questions it cannot route get "only questions about the approved reports".
* **Model client** (`llm.ts`): any OpenAI-compatible server (Ollama, llama.cpp server), `temperature 0`. A non-local `LLM_BASE_URL` is refused unless `LLM_ALLOW_REMOTE=1`.
* **Log.** `AssistantLog` stores the question, mode, tool names and arguments, guard result and unmatched numbers, model name and latency — not the tool results.
* **Verification status.** Tested with a scripted model standing in for the server (routing, argument errors, guard, retry, fallback). A real local model has not been run in CI or in the development environment, so tool-selection accuracy is not yet measured.

### 2.6 Campaigns (`src/server/campaigns/`) — built in M9

States: `draft → audience_approved → content_approved → ready → sending → sent`, or `cancelled` before sending.

* **Owner approval, in order:** audience, content, offer (only if there is one), send. Only `owner_admin` can approve or send. Editing an approved part withdraws every later approval. An offer is a promise in the message, capped at 50 % off; nothing is discounted automatically.
* **Audiences:** customers lapsing from their usual cycle, valuable customers with a low repeat probability (from M8), past buyers of an item, or a customer segment.
* **Consent** (`ContactConsent`) is append-only; the latest record per customer and channel decides. It is checked when the audience is built and again at send time. Every message carries an unsubscribe link (HMAC token, no login) that records a revocation.
* **Holdout.** A deterministic share (default 10 %) of eligible customers is held back and receives nothing. Results compare orders in the 30 days after sending, treatment vs holdout, by intent to treat (customers who opt out later stay in their group). Results appear only once imported invoices cover those 30 days.
* **Transports:** `outbox` (default; messages are stored, marked "held" and labelled as not sent) and SMTP email when `SMTP_URL` is set (with `List-Unsubscribe` headers). WhatsApp is not implemented.
* Sending runs as the `campaign.send` background job.

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
| Local LLM | on-box | nothing external | the assistant uses templates when no model server answers |
| Remote LLM endpoint | **disabled** | the question + tool results | refused unless `LLM_ALLOW_REMOTE=1` |
| Email (SMTP) | disabled | recipient, message body | channel not configured |
| WhatsApp Cloud API | disabled | phone, template params | channel not configured |
| Cloudinary | storefront only | product images | existing env |
| Razorpay | disabled | payment data | existing flag |

## 6. Observability

* pino structured logs with a request ID and tenant ID.
* `ImportBatch` timing/counts and `JobRun` rows act as operational metrics. A `/admin/system` page shows import success rate, last successful sync per source, job failures and assistant guard-failure rate.
* Health endpoint extended with DB and LLM reachability.
