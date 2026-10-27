#!/bin/sh
# Runs once, when the database volume is first created. The app connects as a role that is not a
# superuser and owns its tables, so Postgres row-level security applies to it.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE serenity LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE serenity OWNER serenity;
SQL
