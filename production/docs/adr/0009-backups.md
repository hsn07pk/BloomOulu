# ADR-0009: Backups + disaster recovery

**Status:** Accepted
**Date:** 2026-05-13

## Decision

### Backup strategy

- **Daily Postgres dump** at 03:00 UTC via `pg_dump -F c -Z 6` → `/backup-staging/db.dump`.
- **Daily restic snapshot** at 03:05 UTC covering:
  - the staged Postgres dump
  - the MinIO `bloomoulu-assets` bucket (plant images, audio, PDFs)
  - the curator-uploaded RAG corpus
- **Encryption** — restic AES-256 with `RESTIC_PASSWORD` (in Doppler).
- **Storage** — primary destination is the same MinIO instance under bucket `bloomoulu-backups` with versioning on; secondary is a remote S3-compatible target weekly (Hetzner Storage Box `EUR 4/mo` or an off-site NAS).
- **Retention** — 14 daily + 8 weekly + 12 monthly snapshots. Anything older than 30 days requires a manual restore request.

### Recovery targets

- **RTO** (recovery time objective): 30 min — verified quarterly by a chaos drill where we restore from yesterday's snapshot to a staging VPS.
- **RPO** (recovery point objective): 24 h — the last nightly backup. For tighter RPO we recommend enabling Postgres WAL archiving (`archive_command = 'restic backup …'`), reducing RPO to ~5 minutes.

### Restore procedure

Documented step-by-step in `docs/runbook/restore-from-backup.md`. Quarterly drill ensures the runbook stays accurate.

### Verification

- Every backup run logs to `JobRun`.
- A Prometheus rule fires P0 if the most recent successful backup is older than 30 hours.
- The admin panel shows the time of the most recent successful backup at `/admin/pages/backups`.

## Consequences

**Positive**

- Restoring to a sibling VPS is a single command + 30 minutes of human time.
- Encrypted snapshots are safe to copy offsite without further wrapping.

**Negative**

- We are the operator. If a backup fails silently, no one calls us. Mitigated by the 30-hour alert.
