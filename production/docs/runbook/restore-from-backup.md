# Runbook — Restore from backup

**Scenario:** DB corruption, data centre outage, or human-error mass-delete.

## Backup layout

- `restic` snapshots, daily at 03:00 UTC, 14 daily + 8 weekly + 12 monthly kept.
- Stored in MinIO (`bloomoulu-backups` bucket) + a weekly copy pushed offsite (S3-compatible, configurable).
- Encrypted with `RESTIC_PASSWORD` (kept in Doppler).

## Restore procedure

```bash
# 1. List snapshots
docker compose run --rm restic snapshots

# 2. Choose latest pre-incident snapshot, restore to staging volume
docker compose run --rm restic restore <snapshot-id> --target /restore

# 3. Stop API to avoid concurrent writes
docker compose stop api admin

# 4. Restore Postgres dump
docker compose exec -T postgres pg_restore -U bloomoulu -d bloomoulu --clean --if-exists /restore/srcdata/postgres/db.dump

# 5. Restore MinIO data
docker compose run --rm -v ./_restored_minio:/dst restic restore <snapshot-id> --path /srcdata/minio --target /dst
# Sync into MinIO via mc or rclone

# 6. Run forward migrations if schema changed since the snapshot
docker compose exec api pnpm --filter @bloomoulu/db run migrate:deploy

# 7. Restart API
docker compose start api admin

# 8. Verify
docker compose exec api wget -q --spider http://localhost:4000/healthz
```

## Smoke tests after restore

- `/v1/plants?limit=1` returns plants
- `/v1/healthz` returns `ok` with `db: ok`
- Admin login works
- Recent `AuditLog` rows visible
- Reconciliation cron output for the snapshot day matches Postgres

## RTO / RPO

- **RTO** (recovery time objective): 30 min
- **RPO** (recovery point objective): 24 h (last nightly backup) — for tighter RPO enable Postgres WAL archiving to MinIO
