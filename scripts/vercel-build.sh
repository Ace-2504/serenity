#!/usr/bin/env bash
# Build on Vercel: apply migrations and create the owner account when a database is configured,
# then build the app. Preview builds without a database still build; /api/health then answers 503.
set -euo pipefail

# Vercel's Postgres (Neon) integration names the direct connection DATABASE_URL_UNPOOLED.
export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-${DATABASE_URL:-}}}}"

npx prisma generate
if [ -n "${DATABASE_URL:-}" ]; then
  npx prisma migrate deploy
  if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
    # Creates (or resets the password of) the owner account and the starter catalogue. Safe to re-run.
    SEED_SAMPLE_ORDER=0 node scripts/seed-admin.mjs
  else
    echo "ADMIN_EMAIL and ADMIN_PASSWORD are not both set: no owner account created"
  fi
else
  echo "DATABASE_URL is not set: skipping migrations"
fi
npx next build
