# Serenity BI — Platform Docs

Planning set for transforming the Serenity storefront into an operations-intelligence platform for Indian trading SMEs (TallyPrime / BUSY users).

| Doc | Contents |
|---|---|
| [00-portfolio-assessment](00-portfolio-assessment.md) | Why Serenity was chosen, technical debt, migration strategy |
| [01-product-spec](01-product-spec.md) | User, problem, workflows, MVP, non-goals |
| [02-architecture](02-architecture.md) | Components, data flow, tech choices, security, LLM profiles, external data flows |
| [03-data-model](03-data-model.md) | Canonical tenant-scoped ledger, lineage, invariants |
| [04-kpi-dictionary](04-kpi-dictionary.md) | Every metric: formula, unit, period, required data, assumptions |
| [05-roadmap](05-roadmap.md) | Milestones M0–M12, dependencies, acceptance criteria, first vertical slice |
| [06-risks](06-risks.md) | Data, integration, ML, LLM, security, deployment risks |
| [07-integration-research](07-integration-research.md) | What TallyPrime / BUSY / WhatsApp / Ollama actually expose, with confidence levels |
| [08-domain-packs](08-domain-packs.md) | Core vs per-trade packs; stationery → pharmacy plan; where automation, determinism and AI live |
| [09-operations](09-operations.md) | Install with Docker, HTTPS, data protection, rate limits, backups and restore drills, upgrades, monitoring |
| [progress](progress.md) | Milestone log: what shipped, files, tests run, limitations |

Status: **M0–M9, M10a, M11 and M12 complete** (plan, foundation, demo data, import pipeline, Tally XML file adapter, profit & stock analytics, customers & cash, findings engine with home screen and background jobs, marketplace and quick-commerce file adapters (all file adapters verified on fixtures only), ML worker with honest baselines, assistant with numeric guard (tested with a scripted model only) and owner-approved campaigns, hardening with row-level security, rate limits, Docker Compose, backups and browser tests, and the pharmacy domain pack with batch/expiry and MRP billing; its legal notes still need a professional review). Remaining: M10b (live Tally / BUSY / Amazon API), which needs the owner's accounts.
