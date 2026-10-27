# 09 — Operations: install, secure, back up, upgrade

This guide is for whoever runs Serenity for a business: on one office computer, a small server, or a private cloud machine. Everything runs in Docker on that machine; business data does not leave it unless you turn on email sending (or a remote model server, which is refused by default).

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

Open `http://localhost:3000/admin/login`, sign in with `ADMIN_EMAIL`, then go to **Business intelligence** (`/bi`). Load a demo business from the Imports page to look around; demo data is labelled everywhere and never mixed with real data.

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

## 3. What protects the data

| Layer | What it does | Where |
|---|---|---|
| Roles | Owner (`owner_admin`): everything, including approving recommendations and campaigns. Accountant: imports, data quality, system page. Analyst: read-only. | `src/server/bi/context.ts` |
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
| Sign-in | 10 per 15 min | email address |
| Sign-in | 50 per 15 min | client address (only with `TRUST_PROXY=1`) |
| Sign-up | 10 per hour | client address (only with `TRUST_PROXY=1`) |
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

* **System page** (`/bi/system`, for the owner and the accountant). For each business it shows:
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
