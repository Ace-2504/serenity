# 09 — Operations: install, secure, back up, upgrade

This guide is for whoever runs Serenity: on one office computer, a small server or a private cloud machine with Docker (§1–§7), or as a hosted website on Vercel with a hosted Postgres (§8). With Docker, business data does not leave the machine unless you turn on email sending (or a remote model server, which is refused by default).

## 1. Install with Docker Compose

**You need:** Docker with Compose v2, 4 GB RAM (16 GB if you also run the assistant's model server), and 10 GB of disk plus room for your data and backups.

```sh
git clone https://github.com/Ace-2504/serenity.git && cd serenity
cp .env.docker.example .env
# Replace every "change-me" in .env. For each secret: openssl rand -hex 32
docker compose up -d --build
```

What starts:

| Service | What it does |
|---|---|
| `db` | Postgres 16. Its data lives in the `pgdata` volume. On first start it creates the `serenity` database and a `serenity` login that is **not** a superuser, so row-level security applies to the app (§3). |
| `migrate` | Applies database migrations and creates the owner account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then exits. It runs again on every `up`, so upgrades migrate themselves. |
| `app` | The web app on port `APP_PORT` (default 3000). It only queues background work. |
| `worker` | Runs queued work: import commits, demo loads, findings, model training (Python, in the same image) and campaign sends. |
| `ollama` | Optional (`--profile llm`): a local model server for the assistant. |

Open `http://localhost:3000/admin/login` and sign in with `ADMIN_EMAIL`: you land on the owner console, which holds the shop's operations, the ERP and the CRM. To feed the ERP and CRM from the shop, create your business under **ERP → Data & connections** and press **Link this website to this business**. Demo businesses can be loaded on the same page to look around; demo data is labelled everywhere and never mixed with real data.

**Health:** `GET /api/health` answers `200` with the database round-trip time, or `503` when the database is unreachable. Docker uses it as the app's health check.

### The assistant's model server (optional)

```sh
docker compose --profile llm up -d
docker compose exec ollama ollama pull qwen2.5:7b-instruct   # about 4.7 GB; set LLM_MODEL in .env to use another
```

Without a model server, the assistant still answers the questions it supports from the report templates, and says so.

**Status: not yet verified with a real model.** The development environment's network blocks the model registries, so the assistant has only been tested with a scripted stand-in model (see progress.md, M9). Measure it on your own hardware before relying on it.

### Building behind a proxy, and Docker Hub limits

* **TLS-inspecting proxy.** The build needs npm and PyPI. If your network inspects TLS, pass the proxy's CA certificate as a build secret: `docker build --secret id=extra_ca,src=/path/to/ca.crt -t serenity:local .`, then `docker compose up -d`.
* **Docker Hub rate limits.** Anonymous pulls are limited. If a build fails with `429 Too Many Requests`, pull the base images from a mirror and tag them, e.g. `docker pull mirror.gcr.io/library/python:3.13-slim-bookworm && docker tag mirror.gcr.io/library/python:3.13-slim-bookworm python:3.13-slim-bookworm` (the same for `node:20-bookworm-slim`, `postgres:16-alpine`), or sign in with `docker login`.

## 2. Reaching the app from other computers

Sign-in cookies are marked *Secure*, so browsers send them only over HTTPS (or to `localhost`). Choose one:

1. **Recommended: HTTPS through a reverse proxy** on the same machine (Caddy, nginx, Traefik) forwarding to port 3000. Set `APP_URL` to the public address, and `TRUST_PROXY=1` so rate limits can tell clients apart. Caddy example: `serenity.example.in { reverse_proxy localhost:3000 }`.
2. **Plain HTTP inside the office network:** set `COOKIE_SECURE=0`. Anyone on that network who can watch traffic could take over a session. Use this only on a trusted network.

Do not expose port 3000 directly to the internet.

## 2a. Connecting Tally, BUSY and Amazon

None of these connectors has yet been tested against a real TallyPrime, real BUSY exports or a real seller account. They are tested against simulated servers and sample files. Check the first imports' totals against the source's own registers.

* **TallyPrime (live sync).** In TallyPrime, switch on its server (connectivity, usually port 9000) and keep the company open. In Serenity, go to **Imports → Live sync from TallyPrime**:
  * enter the address: `http://<tally-computer>:9000`, or `http://host.docker.internal:9000` when Tally runs on the same computer as Docker;
  * press **Test connection**, choose the company, save, then **Sync now**.
  * A sync re-reads masters and the Day Book month by month, from the date the books begin (or the date you set) to today, and waits for your review. You can choose to save syncs without errors automatically, and to sync once a day; the daily sync needs the `worker` service.
  * Only local and private addresses are accepted unless `TALLY_ALLOW_REMOTE=1`.
* **BUSY or any spreadsheet.** Export the sales, purchase and return registers **with item details** for one period as Excel (.xlsx) or CSV, and upload them together under **Imports → Registers from BUSY or a spreadsheet**. Confirm which column is which; the mapping is remembered for files with the same headers. Registers carry no opening stock or receipts and payments; add those through the template if you need stock and cash reports.
* **Amazon.in (Selling Partner API).** Register an SP-API application in Seller Central and authorise it for your seller account. Put its client id, client secret and refresh token in `.env` (`AMAZON_SP_CLIENT_ID`, `AMAZON_SP_CLIENT_SECRET`, `AMAZON_SP_REFRESH_TOKEN`), then restart. **Imports → Amazon.in payouts** then reads closed payouts for a period. Each payout must add up to its deposit, and the result waits for your review. The credentials stay in the environment: never in the database, the page or the logs.

## 3. What protects the data

| Layer | What it does | Where |
|---|---|---|
| Console access | Shop staff (owner, catalogue manager, order operations) and members of a business sign in at `/admin/login`. Only the shop's owner can create businesses and link the website. Shop customers cannot enter the console. | `src/app/admin/(console)/layout.tsx` |
| Roles | Owner (`owner_admin`): everything, including approving recommendations and campaigns and deleting the business. Accountant: imports, data quality, system page. Analyst: read-only. | `src/server/bi/context.ts` |
| Application scoping | Every query on a business's tables goes through `forTenant()`, which adds the business to every read and write and refuses writes for another business. | `src/server/db/tenant.ts` |
| Composite foreign keys | Rows can only point to rows of the same business, even through nested writes. | schema |
| **Row-level security (M11)** | Postgres policies on all 31 business tables. A session that declares a business (`app.tenant_id`) sees and writes only that business's rows, whatever its SQL says. The ML worker declares its business and also sets `app.tenant_required`, so a forgotten filter returns nothing rather than another business's data. Web requests do not yet declare a business per request; they rely on `forTenant()`. | migration `row_level_security`; `ml/serenity_ml/db.py` |
| Rate limits (M11) | See below. | `src/server/security/rate-limit.ts` |
| Secrets | Only in `.env` / environment variables; never in code or logs. The owner password is not printed by the setup step. | |
| Outbound data | Nothing leaves the machine unless `SMTP_URL` is set (campaign email) or `LLM_ALLOW_REMOTE=1` with a remote `LLM_BASE_URL`. | architecture §5 |

Row-level security does not apply to Postgres superusers. The Compose setup connects as the non-superuser `serenity`; if you run the app on your own Postgres, do the same (`docker/postgres/10-app-role.sh` shows how).

**Rate limits** (per app process, reset on restart):

| What | Limit | Keyed by |
|---|---|---|
| Sign-in (shop and console) | 10 per 15 min | email address |
| Sign-in | 50 per 15 min | client address (only with `TRUST_PROXY=1`) |
| Shop account sign-up | 10 per hour | client address (only with `TRUST_PROXY=1`) |
| Creating businesses | 10 per hour | user |
| Loading a demo | 6 per hour | user |
| Uploads | 30 per hour | user |
| Assistant questions | 20 per minute | user |
| Campaign wording suggestions | 20 per minute | user |
| Unsubscribe link | 60 per minute | client address (only with `TRUST_PROXY=1`) |

Without a trusted proxy the app cannot tell clients apart, so per-address limits are skipped. A single shared limit would let one person lock everyone out.

## 4. Backups

```sh
scripts/backup.sh                    # writes backups/serenity-YYYYMMDD-HHMMSS.dump and checks it can be read
KEEP_DAYS=30 scripts/backup.sh       # also removes local dumps older than 30 days
scripts/restore.sh backups/<file> check     # restore drill: restores into a scratch database, compares row counts, drops it
scripts/restore.sh backups/<file> replace   # replaces the live database (keeps the old one as serenity_previous)
```

* **Schedule it.** For example, a cron entry for 01:30 every night: `30 1 * * * cd /opt/serenity && KEEP_DAYS=30 scripts/backup.sh >> backups/backup.log 2>&1`.
* **Copy dumps off the machine** (another drive, another office, encrypted cloud storage). A backup on the same disk is lost with the disk.
* **Run a restore drill monthly** with `check`. A backup that has never been restored is a hope, not a backup.
* What a backup does not contain: `.env` (keep a copy of it somewhere safe and separate) and the model server's downloaded models (re-pull them).
* Your books stay the source of truth: every import keeps its source records, so data can also be rebuilt by re-importing the original exports.

## 5. Upgrades

```sh
scripts/backup.sh
git pull
docker compose up -d --build     # migrate runs first; app and worker start only if it succeeds
```

If a migration fails, the app and worker do not start and the old database is unchanged: read `docker compose logs migrate`. To roll back, check out the previous version, rebuild, and restore the backup with `replace`.

## 6. Monitoring

* **System page** (`/admin/erp/system`, for the owner and the accountant). For each business it shows:
  * the database round trip;
  * imports in the last 30 days and the last import per source;
  * background work in the last 7 days: done, failed, waiting, and median and slowest-10% times; the oldest waiting job; recent failures with their errors;
  * how many assistant answers the number check withheld;
  * the model each prediction uses and when it was trained;
  * messages kept in the outbox, sent or failed;
  * the active settings: where jobs run, email transport, model server.
* **Logs:** `docker compose logs -f app worker`. Passwords and secrets are not logged.
* **Uptime:** point any monitor at `/api/health`.

## 7. Known limits

* One app server. Rate limits are held in that process's memory; several app servers behind a load balancer would each apply their own.
* No built-in TLS: use a reverse proxy (§2).
* Backups are scripts you schedule; there is no built-in off-site copy.
* Row-level security narrows the ML worker's sessions; web requests are scoped by the application (`forTenant()`), not yet by a per-request database setting.

## 7a. The website feeds the ERP and CRM

Once the owner links the website to their business (**ERP → Data & connections**), every order, stock change, product change and purchase bill queues a sync. A sync re-reads the shop's tables, converts them to the import template and runs them through the same checks as any import; with no errors it is saved without review. The import history shows each sync.

| Shop record | In the books |
|---|---|
| Order (confirmed, packed, shipped, delivered, returned) | Sales invoice on the "Own website" channel; cancelled orders are left out, and drop out of the books if cancelled later |
| Returned order (order page: "Take back as returned") | Sales return for the whole order, dated when it was marked; the goods go back into stock |
| Online payment marked paid | Receipt against the invoice, on the order date |
| Cash on delivery marked collected (order page) | Receipt on the day it was marked; until then the order is owed |
| Razorpay fee, when the gateway reported it | Payment gateway charge on that order |
| Customer account, or anyone who has ordered | Customer in the CRM, with phone and city from their default address |
| "Email me offers" ticked at sign-up | Email consent recorded once; an unsubscribe in the CRM is never overwritten |
| Product variant | Item (by SKU), linked back to the variant |
| Purchase bill (ERP → Purchases) | Purchase invoice and the supplier; a payment when marked paid |
| Stock on hand today | Closing stock the books are checked against |

**Opening stock is worked out, not recorded.** The shop never kept an opening count, so the books take today's stock, add back what sold since the first day and take off what was bought. Stock changed by hand on Products & stock in that time makes it wrong; each sync says so. **Costs** come from purchase bills (each bill sets the product's cost); products never bought on a bill have no cost and are left out of profit.

If website orders are also entered in Tally or BUSY, linking the website would count them twice. Link it only where the website is where these sales are recorded.

## 8. Hosting on Vercel with a hosted Postgres

The same code runs as a hosted website: the shop at `/` and the owner console at `/admin`.

**Status: the Vercel build is checked by Vercel on every push, but a deployment with a database has not been tried from the development environment** (its network cannot reach `vercel.app`). Walk through the checks at the end before inviting anyone.

### Steps

1. **Add a database.** The quickest way: in the Vercel project, **Storage → Create Database → Neon (Postgres)**, connect it to the project for Production and Preview, and pick a Mumbai region if your customers are in India. Vercel then sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` itself. With any other provider (Supabase, AWS RDS, …), set `DATABASE_URL` (pooled; with PgBouncer add `?pgbouncer=true&connection_limit=1`) and `DIRECT_URL` (direct) yourself.
   * Connect as a role that is **not** a superuser and has no `BYPASSRLS`, so row-level security applies (§3). The provider's default owner role usually qualifies; the policies are forced on the table owner.
2. **In the Vercel project → Settings → Environment Variables** (Production and Preview), set:

   | Variable | Value |
   |---|---|
   | `AUTH_SECRET` | `openssl rand -hex 32`; the app refuses to start in production without it |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the owner's sign-in for `/admin/login`; use a strong password |
   | `TRUST_PROXY` | `1` (Vercel sets the client address header) |
   | `APP_URL` | the site's address, e.g. `https://serenity.example.in`; used in unsubscribe links |
   | `SMTP_URL`, `SMTP_FROM` | optional: only if approved campaign emails should really be sent |
   | `AMAZON_SP_*` | optional: see §2a |

   Do not set `LLM_BASE_URL` to an outside AI service unless your customers have agreed to it; without a model server the assistant answers from report templates.
3. **Redeploy.** The `vercel-build` script applies the migrations, creates the owner account from `ADMIN_EMAIL` and `ADMIN_PASSWORD` with three starter products (no sample order), then builds. Every deploy re-runs it safely; changing `ADMIN_PASSWORD` and redeploying resets the owner's password. Without a database it skips these steps, so preview builds still succeed.
4. **Set the function region** (Project → Settings → Functions) to the database's region, e.g. Mumbai (`bom1`); every page makes several database round trips.
5. **Open the site.** The shop is at `/`. Sign in at `/admin/login`, create your business on **ERP → Data & connections** and press **Link this website to this business**. Previews of a branch are behind Vercel's own sign-in by default; the production domain is public.

### What is different when hosted

| Feature | On Vercel | Why |
|---|---|---|
| Background work (import commits, quick demos, findings, campaign sends) | Runs after the response, inside the request's 60-second limit (`maxDuration`). A job that runs out of time is retried after 15 minutes. | Serverless functions are frozen after their time limit. |
| Two-year demo | Not offered | It takes minutes. It returns when a separate worker runs jobs (`JOBS_MODE=worker`, e.g. the Docker `worker` on another machine against the same database). |
| Live Tally sync and the daily sync | Off; upload Day Book exports instead | A hosted server cannot reach Tally on an office network. `TALLY_ALLOW_REMOTE=1` turns it on for a Tally you have deliberately exposed and secured. |
| Predictions (ML) | Not available: running them stops with "The ML worker is not installed" | The models run in Python, which the Vercel Node runtime does not have. Run the Docker `worker` against the same database to get them. |
| Rate limits | Weaker | They are held in each function instance's memory, and Vercel runs many short-lived instances. Add your provider's firewall or rate limiting for sign-in and sign-up. |
| Backups | Use the database provider's backups and point-in-time restore; `scripts/backup.sh` works too with `DATABASE_URL` set | |

### Checks after the first deploy

1. `GET /api/health` answers `200`.
2. Sign in at `/admin/login` with `ADMIN_EMAIL`, create your business on Data & connections and link the website.
3. Place a test order on the shop and check it appears under CRM → Customers and in the import history.
4. Load the quick demo, open each report, then delete it from **Business**.

The shop starts with three products; add yours on Products & stock.
