# Stationery Webapp MVP

> **In progress:** this storefront is being extended into an operations-intelligence platform for Indian trading SMEs (profitability, inventory, working capital, customer analytics). Plan and milestone log: [`docs/platform/`](docs/platform/README.md).

Phase 5 implementation scaffold for the stationery ecommerce project.

## Included In This Starter

1. Next.js TypeScript app setup.
2. Tailwind setup with project token colors and fonts.
3. Storefront home shell aligned with phase 2 style direction.
4. Admin dashboard shell aligned with phase 3 operations direction.
5. API starter routes for health, catalog categories, and admin order queue.
6. Prisma schema starter aligned with phase 4 data model.

## Run with Docker (recommended for a business)

```bash
cp .env.docker.example .env      # then replace every "change-me" (openssl rand -hex 32)
docker compose up -d --build     # Postgres, migrations, web app on :3000, background worker
```

Sign in at `http://localhost:3000/admin/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then open `/bi`. Backups, HTTPS, upgrades and the optional local model server: [`docs/platform/09-operations.md`](docs/platform/09-operations.md).

## Run Locally (development)

1. Install dependencies:

```bash
npm install
```

2. Set up environment file:

```bash
cp .env.example .env
```

3. Generate Prisma client:

```bash
npm run prisma:generate
```

4. Run migrations:

```bash
npm run prisma:migrate
```

5. Seed baseline roles and admin account:

```bash
npm run seed:admin
```

6. Start development server:

```bash
npm run dev
```

7. Open admin login and sign in:

1. URL: `/admin/login`
2. Default credentials come from `.env` values for `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Tests

1. Unit tests: `npm test`.
2. Integration tests need a separate PostgreSQL database: set `TEST_DATABASE_URL` (see `.env.example`), then `npm run test:int`. Migrations are applied automatically; tests create and delete their own tenants.
3. ML worker tests: `python -m venv ml/.venv && ml/.venv/bin/pip install -r ml/requirements.txt && (cd ml && .venv/bin/python -m pytest)`.
4. Browser tests: `npm run build`, then `npx playwright test` (starts the app on port 3200), or `E2E_BASE_URL=http://localhost:3000 npx playwright test` against a running app. Needs the owner account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Payment Integration (Razorpay)

1. Razorpay code is still in the repo, but the service is paused by default with `RAZORPAY_ENABLED="false"` and `NEXT_PUBLIC_RAZORPAY_ENABLED="false"`.
2. With Razorpay paused, checkout runs in Cash on Delivery mode only.
3. To re-enable later, set both flags to `"true"` and add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
4. When enabled, checkout payment-intent will create real Razorpay orders.
5. Configure webhook URL to:

```text
/api/webhooks/payments/razorpay
```

6. On `payment.captured`, order payment status is reconciled to paid and order status moves to confirmed.
7. Admin reconciliation view is available at `/admin/payments` for mismatch checks and retries.

## Product Media (Cloudinary)

1. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to `.env`.
2. Admin gallery uploads now store product images in Cloudinary instead of local disk.
3. This makes admin product media compatible with Vercel deployment.

## Deploy Without Razorpay

1. Keep `RAZORPAY_ENABLED="false"` and `NEXT_PUBLIC_RAZORPAY_ENABLED="false"` in your environment.
2. Set these required variables in Vercel: `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and optionally `NEXT_PUBLIC_APP_NAME`.
3. Do not configure a Razorpay webhook while the flags stay false.
4. Run Prisma in production with `npx prisma migrate deploy`.
5. Seed the admin account once with `npm run seed:admin` against the production database.
6. Checkout will work with Cash on Delivery only until Razorpay is re-enabled.

## Next Build Steps

1. Integrate real payment gateway in place of payment-intent placeholder logic.
2. Build full admin modules for catalog, inventory, promotions, and order actions.
3. Add registration, password reset, and hardened session management.
4. Add end-to-end tests for auth, cart, checkout, order placement, and account views.
5. Add webhook-driven payment reconciliation and order status updates.