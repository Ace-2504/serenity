#!/bin/sh
# Restore a dump made by scripts/backup.sh.
#   scripts/restore.sh backups/serenity-....dump check     -> restores into a scratch database "serenity_restore_check",
#                                                            prints row counts, and drops it (a restore drill)
#   scripts/restore.sh backups/serenity-....dump replace   -> stops the app and worker, REPLACES the live database, restarts
set -eu
cd "$(dirname "$0")/.."
file="${1:?usage: scripts/restore.sh FILE check|replace}"
mode="${2:?usage: scripts/restore.sh FILE check|replace}"
base="$(basename "$file")"
[ -f "backups/$base" ] || { echo "backups/$base not found (dumps must be in ./backups)"; exit 1; }
psql() { docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
counts='SELECT (SELECT count(*) FROM "Tenant") AS businesses, (SELECT count(*) FROM "Voucher") AS vouchers, (SELECT count(*) FROM "VoucherLine") AS lines, (SELECT count(*) FROM "Party") AS parties, (SELECT count(*) FROM "Item") AS items;'
case "$mode" in
  check)
    psql -d postgres -c 'DROP DATABASE IF EXISTS serenity_restore_check' -c 'CREATE DATABASE serenity_restore_check OWNER serenity'
    docker compose exec -T db pg_restore -U postgres -d serenity_restore_check --no-owner --role=serenity --exit-on-error "/backups/$base"
    echo "Restored copy:"; psql -d serenity_restore_check -c "$counts"
    echo "Live database:"; psql -d serenity -c "$counts"
    psql -d postgres -c 'DROP DATABASE serenity_restore_check'
    ;;
  replace)
    docker compose stop app worker
    psql -d postgres -c 'DROP DATABASE IF EXISTS serenity_previous' -c 'ALTER DATABASE serenity RENAME TO serenity_previous' -c 'CREATE DATABASE serenity OWNER serenity'
    docker compose exec -T db pg_restore -U postgres -d serenity --no-owner --role=serenity --exit-on-error "/backups/$base"
    docker compose up -d app worker
    echo "Restored. The previous database is kept as serenity_previous; drop it once you have checked the app."
    ;;
  *) echo "mode must be check or replace"; exit 1 ;;
esac
