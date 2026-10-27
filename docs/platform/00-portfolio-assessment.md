# 00 — Portfolio Assessment

Audit date: 2026-10-27. Scope: every repository under `github.com/Ace-2504` (44 repos). Each candidate below was cloned and inspected; line counts exclude `node_modules`, images and lockfiles.

## 1. Screening

Most repositories are not web-product candidates and were excluded on sight:

| Group | Repos | Why excluded |
|---|---|---|
| Forks / upstream OSS contributions | `Travel-Plans-`, `nyay-setu-working`, `agamemnon`, `Q`, `Easy.js_v.3.0.0`, `claude-cookbooks`, `minbpe` | Not owned; transforming them would misrepresent authorship. |
| ML research / model training | `125M-model-base`, `pre-training-*`, `slm-*`, `yugioh-dpo-rlaif`, `bpe-tokenizer`, `easy-to-flag-hard-to-rescue`, `short-answers-broken-rag`, `v1-extended-qa-sft` | Research artefacts, not business products. Useful evidence of ML depth, which this project should complement rather than duplicate. |
| Static showcase sites | `harman-*-site`, `api-design-blog`, `Ace-2504` | Content sites with no domain model. |
| Systems | `PROXY_SERVER` (C++, ~1.1k LOC) | Strong systems project; wrong domain for SME operations. Keep as-is. |
| Market data | `nifty-market-data`, `nifty-straddle-dashboard` | Trading tooling, not SME operations. |

## 2. Shortlist

| Criterion | **Serenity** | A-360 | Ace Rentals | AeroGuard |
|---|---|---|---|---|
| Stack | Next.js 14 App Router, TypeScript, Prisma, **PostgreSQL** | Express 5, EJS, MongoDB | Express 5, EJS, MongoDB | Express + Python ML engine + Expo mobile |
| Size (src LOC) | ~7.8k | ~3.9k | ~1.6k | ~51k |
| Domain fit for SME ops | **Direct**: stationery seller with SKUs, variants, HSN codes, GST %, stock on hand, orders with tax snapshots, payments reconciliation, B2B bulk requests | Relocation marketplace | Rental listings | Pollution token economy |
| Relational data / accounting fit | **Postgres + typed ORM + migrations** already in place | Document store; joins and ledgers would be awkward | Same | Mongo |
| Auth / RBAC to reuse | HMAC-signed session cookie, scrypt hashing, 4 roles (`owner_admin`, `catalog_manager`, `order_operations`, `customer`) | Passport + 2FA | Passport | JWT |
| Tests / CI | Vitest + GitHub Actions (lint, tsc, test) | Jest (1 health test) | Jest (1 health test) | Jest + pytest |
| Design docs | 25 product/UX/architecture docs (PRD, data model, role matrix, business rules) | README | README | Extensive |
| Risk of transforming | Low: storefront keeps working as one data source | Would erase a hackathon-finalist artefact | Low value | Different, already-ambitious thesis |

## 3. Decision: transform **Serenity**

Reasons, in priority order:

1. **The domain is already right.** Serenity sells stationery to retail customers and takes bulk (school/office) requests. Your brief's motivating example is a stationery supplier running a back-to-school campaign. The catalogue already carries `hsnCode`, `gstPercent` and `sku`, which are the keys that join to Tally/BUSY stock items.
2. **The data layer is already right.** Accounting analytics is relational work: ledgers, period aggregates and reconciliations. The other three web candidates are on MongoDB and would need a database migration before any real work could start. Serenity already has PostgreSQL, Prisma migrations and transactional order placement.
3. **It has real engineering to preserve.** Razorpay signature verification, idempotent payment capture (unique `providerPaymentId`), a payment reconciliation screen, Cloudinary media and role-gated admin APIs. None of this needs rewriting.
4. **It turns into a strong portfolio story.** A storefront I built becomes one sales channel feeding the same canonical ledger as Tally and BUSY imports. That shows adapter architecture with a real second source, not a hypothetical one.
5. **It doesn't cannibalise other projects.** A-360 keeps its hackathon provenance, and the ML research repos remain separate evidence of model-building depth.

Verification performed on this repo before deciding (2026-10-27, this container):

```
npm install && npx prisma generate     → ok
npm test                               → 1 file, 4 tests passed
npx tsc --noEmit                       → no errors
npm run lint                           → 0 errors, 1 warning (<img> in admin/inventory)
npx prisma migrate deploy (Postgres 16) → 1 migration applied
```

## 4. What to keep, what to change

**Keep unchanged:** storefront pages, cart and checkout, Razorpay flow and webhook, Cloudinary media, admin inventory and payments screens, and scrypt password hashing.

**Technical debt found (fix as each area is touched, not in one big rewrite):**

| # | Issue | Where | Severity | Fix |
|---|---|---|---|---|
| 1 | Session tokens never expire: `iat` is stored but never checked | `src/lib/auth.ts` `parseSessionToken` | High | Enforce max age; add tenant + session version to the payload |
| 2 | Falls back to a hard-coded secret if `AUTH_SECRET` is unset | `src/lib/auth.ts` `getSecret` | High | Fail fast in production |
| 3 | Signature compared with `!==` (not constant-time) | `src/lib/auth.ts` | Medium | `timingSafeEqual` |
| 4 | Oversell race: stock is checked and then decremented in two steps under READ COMMITTED; concurrent orders can drive stock negative | `api/checkout/place-order` | Medium | Conditional `updateMany({ where: { stockOnHand: { gte: qty } } })` and check the affected row count |
| 5 | `orderNumber = ORD-${Date.now()}` collides under concurrency (unique violation → 500) | same | Low | Postgres sequence |
| 6 | Money stored as whole-rupee `Int`, so paise are lost; `Int` overflows above ₹21.4 crore in aggregates | `schema.prisma` | High for accounting | Canonical ledger uses `Decimal(18,2)`; storefront tables left as-is and converted at the adapter boundary |
| 7 | No cost price, suppliers, purchases or stock-movement history; `stockOnHand` is mutated in place | schema | Blocking for analytics | New canonical ledger (see `03-data-model.md`) |
| 8 | Docs promise Zod validation, but handlers hand-cast with `String(body.x ?? "")` | API routes | Medium | Zod at every new boundary; retrofit when touched |
| 9 | `paymentStatus` on `Order` is a free `String` beside a `PaymentStatus` enum | schema | Low | Leave; adapter maps it |
| 10 | No tenant concept; single business assumed | everywhere | Blocking for multi-business | `Tenant` + `Membership`; all new tables tenant-scoped |
| 11 | No audit log; only password hashing has tests | — | Medium | Audit table; formula tests are a first-class deliverable |
| 12 | 1,238-line client component | `admin/inventory/page.tsx` | Low | Split when touched |

## 5. Migration strategy

* **Additive, not replacement.** New canonical tables sit beside the storefront tables. The storefront is not rewritten. It becomes the `storefront` source adapter, which maps `Order`/`OrderItem` into canonical sales vouchers.
* **One deployable app plus one Python worker.** Next.js keeps UI, API, auth, ingestion and the deterministic metrics layer. A Python service is added only for ML, where scikit-learn and statsmodels justify a second runtime.
* **Product positioning shifts from "stationery store" to "operations intelligence for stationery and school-supplies distributors".** The demo tenant is a fictional distributor with a clearly labelled synthetic dataset.

## 6. Information I could not obtain from the repositories

* ~~Whether the Vercel deployment has real customers or orders.~~ **Confirmed by owner (2026-10-27): no customers; the product is in development.** Migrations stay additive anyway, and nothing merges to `main` until the first vertical slice works.
* Access to a TallyPrime or BUSY installation. Without one, adapters are built against documented formats and synthetic fixtures, and labelled **unverified against a live instance** until tested on a real install (see `07-integration-research.md`).
* Target hardware of real SME users for the local LLM. The design assumes a typical office PC (8–16 GB RAM, no discrete GPU) and treats larger models as optional.
