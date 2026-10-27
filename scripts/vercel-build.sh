#!/usr/bin/env bash
# Build on Vercel: apply migrations when a database is configured, then build the app.
# Preview builds without DATABASE_URL still build; the app then answers 503 on /api/health.
set -euo pipefail
npx prisma generate
if [ -n "${DATABASE_URL:-}" ]; then
  # Migrations need a direct (unpooled) connection; fall back to DATABASE_URL when none is given.
  DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}" npx prisma migrate deploy
else
  echo "DATABASE_URL is not set: skipping migrations"
fi
npx next build
