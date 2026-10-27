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
| [progress](progress.md) | Milestone log: what shipped, files, tests run, limitations |

Status: **M0–M7 and M10a complete** (plan, foundation, demo data, import pipeline, Tally XML file adapter, profit & stock analytics, customers & cash, findings engine with home screen and background jobs, marketplace and quick-commerce file adapters; all file adapters verified on fixtures only). Next: M8 ML, M9 assistant & campaigns, M11 hardening, M12 pharmacy. M10b (live Tally / Amazon API) needs the owner's accounts. Order: stationery first, pharmacy as the second domain pack (M12).
