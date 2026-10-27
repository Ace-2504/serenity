#!/bin/sh
# Back up the Serenity database from the Docker Compose stack into ./backups (custom pg_dump format).
#   scripts/backup.sh                 -> backups/serenity-YYYYMMDD-HHMMSS.dump
#   KEEP_DAYS=30 scripts/backup.sh    -> also deletes local dumps older than 30 days
# Copy the dumps to another machine or drive: a backup on the same disk does not survive a disk failure.
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
name="serenity-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U postgres -d serenity --format=custom --no-owner --file="/backups/$name"
docker compose exec -T db pg_restore --list "/backups/$name" > /dev/null # fails if the dump is unreadable
echo "backups/$name ($(du -h "backups/$name" | cut -f1))"
if [ -n "${KEEP_DAYS:-}" ]; then
  find backups -name 'serenity-*.dump' -mtime +"$KEEP_DAYS" -print -delete
fi
