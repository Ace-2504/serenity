# 06 — Risk Assessment

Likelihood/impact: H/M/L.

## Data quality

| Risk | L | I | Mitigation |
|---|---|---|---|
| Opening stock or historical purchase costs missing → COGS unknowable | H | H | `costBasis = unknown`, `partial` status with coverage %; ask for an opening Stock Summary with values; never assume zero cost |
| Stock items named inconsistently, or the same item under two names | H | M | Group/name normalisation suggestions; manual merge map; never auto-merge |
| Cash sales booked to a single "Cash" party → customer analytics meaningless for that share | H | M | Exclude walk-in/cash parties from customer metrics; show the excluded share explicitly |
| Back-dated corrections in source after import | M | H | Content-hash versioning; per-period re-sync; ledger rebuild for affected items |
| Invoices without item lines (accounting-invoice mode) | M | H | Detected at import → voucher counts toward revenue but is excluded from SKU metrics with an issue raised |
| Mixed units (box vs piece) | M | M | Use Tally base unit; flag compound units; never sum across UoMs |

## Accounting integration

| Risk | L | I | Mitigation |
|---|---|---|---|
| Tally/BUSY format or version differences | H | H | Adapter per source/version; fixture tests; capability flags; "unverified" label until tested on a real instance |
| Live Tally sync needs Tally running on the LAN with the company open | H | M | File-export path is the primary MVP route; live sync is optional |
| No real Tally/BUSY instance available to the developer | H | H | Ask the owner for an anonymised export from a real business, or use the Tally Education mode (free; date-restricted); until then claim fixture-level verification only |
| Valuation method differs (Tally FIFO vs our WAC) | M | M | Use the source snapshot value as authoritative closing value; show derived-vs-source variance |

## ML validity

| Risk | L | I | Mitigation |
|---|---|---|---|
| Temporal leakage | M | H | Features computed by a function that takes `cutoff` and asserts `max(date) ≤ cutoff`; rolling-origin evaluation |
| Too little data (few hundred customers, intermittent demand) | H | M | Baselines first; ship ML only if it beats them on held-out windows; otherwise say so |
| Synthetic data makes models look good | H | M | Report metrics on synthetic data **as pipeline tests only**, never as performance claims |
| Prediction read as causation ("message caused purchase") | M | H | UI language, holdout groups for campaigns, uplift reported with intervals |

## Local LLM

| Risk | L | I | Mitigation |
|---|---|---|---|
| Owner hardware too weak | H | M | `off/small/standard/server` profiles; product fully usable with LLM off |
| Hallucinated numbers | M | H | Tools only; numeric guard; templated fallback; logged guard failures |
| Wrong tool or wrong period chosen | M | M | Answers echo tool + params ("Net sales, 1–30 Sep 2026"); eval set with tool-selection accuracy |
| Indic-language copy quality varies | M | L | Owner always edits; language marked "draft quality" |

## Security & privacy

| Risk | L | I | Mitigation |
|---|---|---|---|
| Cross-tenant leakage | L | H | Tenant-scoped repository, isolation tests, then Postgres RLS |
| Session token never expires (existing) | — | H | Fix in M1 |
| XXE / zip-bomb via uploaded XML/XLSX | M | H | Parser with entities disabled, size limits, decompression limits |
| Customer phone/email in logs or LLM prompts | M | H | Log redaction; LLM tools return aggregates or IDs by default; contact fields only reach the campaign renderer |
| Messaging without consent / policy violation | M | H | Consent checked at send; WhatsApp templates only; owner approval required; opt-out handling; DPDP Act 2023 notice and purpose limitation in docs |

## Deployment

| Risk | L | I | Mitigation |
|---|---|---|---|
| Serverless (Vercel) time limits for imports and jobs | H | M | Imports above a size threshold go to the worker; recommended deployment for real SMEs is a single box (Docker Compose) on-prem or a private VPS |
| Backups of financial data | M | H | Documented `pg_dump` schedule plus a restore drill |
| Scope creep | H | H | Vertical slices; non-goals list; each milestone must demo |
