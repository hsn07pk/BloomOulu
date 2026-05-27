#!/bin/sh
# Daily backup script. Run via `docker compose --profile backup run --rm restic`.
# Cron entry on the host: 0 3 * * * cd /opt/bloomoulu && docker compose --profile backup run --rm restic
set -euo pipefail

: "${RESTIC_REPOSITORY:?must be set, e.g. s3:https://files.bloomoulu.fi/backups}"
: "${RESTIC_PASSWORD:?must be set}"
: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"

mkdir -p /backup-staging
echo "Dumping Postgres..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -F c -Z 6 \
  > /backup-staging/db.dump

echo "Backing up..."
# /srcdata/storage is the local-disk file store (api_storage volume),
# mounted in by docker-compose --profile backup. Holds receipts, audio
# narrations, rehosted plant images, GDPR exports.
restic backup /backup-staging /srcdata/storage \
  --tag "$(date +%F)" \
  --tag bloomoulu \
  --exclude-caches

echo "Pruning old snapshots..."
restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune

rm -rf /backup-staging
echo "Done."
