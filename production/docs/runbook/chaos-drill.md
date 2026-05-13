# Runbook — Chaos drill (quarterly)

**Owner:** engineering lead
**Cadence:** quarterly (Q1, Q2, Q3, Q4)
**Time budget:** 2 hours including write-up
**Target environment:** staging — never production

ADR-0008 mandates quarterly chaos tests to confirm the platform survives
the failure modes its design claims to handle. This runbook walks them
all four; results land in `docs/runbook/chaos-drill-results-YYYY-Qn.md`.

Before each drill: take a fresh restic snapshot, confirm the snapshot
appears in `restic snapshots`, and tell the team in #bloomoulu-ops.

## 1. Database stop mid-payment

**Hypothesis:** A donation in flight when Postgres dies should fail
visibly to the donor with no partial state; once Postgres returns, the
donor's retry should succeed; no double-charge.

```bash
# Start an adoption in another terminal
curl -s -X POST http://localhost:4000/v1/adoptions -d '{...bank_transfer...}'

# Within 5s of the orderId being returned:
docker compose stop postgres

# Caller should get 502 / 503 within 30s. The Payment row should not
# exist (the tx never committed).
sleep 30

# Bring Postgres back:
docker compose start postgres

# Verify nothing partial in flight:
docker compose exec postgres psql -U bloomoulu -d bloomoulu \
  -c "SELECT count(*) FROM \"Payment\" WHERE status='pending' AND \"createdAt\" > now() - interval '5 minutes';"

# Retry the donation; should succeed with a fresh orderId.
```

**Expected:** Payment row count = 0 (no partial row); retried donation
completes; no duplicate ProcessedEvent on the eventual reconciliation.

## 2. Redis stop while workers run

**Hypothesis:** When Redis dies, in-flight BullMQ jobs pause; queued jobs
are durable; on Redis return the workers reconnect and drain the backlog
without losing any job.

```bash
# Trigger a slow job (rag-ingest a small corpus chunk):
docker compose exec api pnpm rag:ingest --path packages/rag/corpus/escape-programme.md

# Stop redis while the worker is processing:
sleep 2
docker compose stop redis

# Worker log shows reconnect attempts. After 60s, bring redis back:
sleep 60
docker compose start redis

# Verify: the rag-ingest job either completed (if it finished in flight)
# or resumed and completed. No duplicates in RagChunk.
docker compose exec postgres psql -U bloomoulu -d bloomoulu \
  -c "SELECT count(*) FROM \"RagChunk\";"
```

**Expected:** Worker reconnects within 30s of Redis return; RagChunk
count is exactly what it should be for the corpus; no duplicate rows.

## 3. Ollama (LLM) outage

**Hypothesis:** AskTheGarden gracefully degrades — donor sees the
"escalation card" instead of an error or a hallucination.

```bash
docker compose stop ollama

# In a browser, visit /fi/ask and submit a question.
# Expected behaviour:
#   - intent classifier still runs (it's a cheap heuristic, not LLM)
#   - retrieval still runs (pgvector + rerank)
#   - the LLM call short-circuits; UI shows "We'll get back to you"
#     card with a "Forward to a curator" button.
#   - AskAnswer row recorded with escalatedAt set.

docker compose start ollama
```

**Expected:** No 500 on `/v1/ask`; donor sees the escalation card; we
do not echo retrieved chunks back as if they were an answer.

## 4. MinIO outage during receipt rendering

**Hypothesis:** A succeeded payment's receipt PDF retries until MinIO
returns; the donor email is held until the PDF is uploadable; no
silent data loss.

```bash
docker compose stop minio

# Trigger a successful donation (reconciliation entry):
curl -s -X POST http://localhost:4000/v1/reconciliation/entries -d '...'

# Receipt processor will fail at uploadToS3 and retry with exponential
# backoff (BullMQ defaultJobOpts: attempts=5, base 5s).
docker compose logs api | tail -20

# Within 5 min, bring MinIO back:
docker compose start minio

# Wait for the retry to succeed:
sleep 30
docker compose exec postgres psql -U bloomoulu -d bloomoulu \
  -c "SELECT number, \"pdfUrl\" FROM \"Receipt\" ORDER BY \"createdAt\" DESC LIMIT 1;"
```

**Expected:** Receipt has pdfUrl set; email arrived in MailHog with the
attachment.

## Write-up

After all four checks pass, commit `docs/runbook/chaos-drill-results-YYYY-Qn.md`:

```markdown
# Chaos drill — YYYY Qn

**Date:** YYYY-MM-DD
**Operator:** <name>

| Scenario | Pass | Notes |
|---|---|---|
| 1. DB stop mid-payment | ✅ / ❌ | … |
| 2. Redis stop | ✅ / ❌ | … |
| 3. Ollama outage | ✅ / ❌ | … |
| 4. MinIO outage | ✅ / ❌ | … |

Issues raised: <link to bug tracker>
Mitigations added: <PRs>
```
