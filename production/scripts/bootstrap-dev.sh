#!/bin/sh
# One-shot dev bootstrap. Run on a fresh clone:
#
#   chmod +x scripts/bootstrap-dev.sh
#   ./scripts/bootstrap-dev.sh
#
set -e

echo "▶ Copying env.example → .env"
[ -f .env ] || cp .env.example .env

echo "▶ Starting dev infra"
docker compose -f docker-compose.dev.yml up -d

echo "▶ Waiting for Postgres…"
for i in 1 2 3 4 5 6 7 8 9 10; do
  docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U bloomoulu && break
  sleep 2
done

echo "▶ Pulling Ollama models (one-time, ~5 GB)"
docker compose -f docker-compose.dev.yml exec -T ollama ollama pull llama3.1:8b-instruct-q5_K_M || true
docker compose -f docker-compose.dev.yml exec -T ollama ollama pull nomic-embed-text:v1.5 || true

echo "▶ Installing JS deps"
pnpm install

echo "▶ Generating Prisma client"
pnpm db:generate

echo "▶ Running migrations + seed"
pnpm db:migrate:dev || pnpm --filter @bloomoulu/db exec prisma migrate dev --name init
pnpm db:seed

echo "▶ Ingesting RAG corpus"
pnpm rag:ingest || true

echo ""
echo "✅ Done. Now run: pnpm dev"
echo "   web   → http://localhost:3000"
echo "   api   → http://localhost:4000/docs"
echo "   admin → http://localhost:4100/admin"
echo "   kiosk → http://localhost:3100"
echo "   mail  → http://localhost:8025"
echo "   minio → http://localhost:9001  (minioadmin/minioadmin)"
