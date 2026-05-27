#!/usr/bin/env bash
# Tear down the test-payments environment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

green() { printf "\033[32m%s\033[0m\n" "$*"; }

if [[ -f "$ROOT/.run/dev.pid" ]]; then
  pid=$(cat "$ROOT/.run/dev.pid")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true
    green "Stopped dev (PID $pid)"
  fi
  rm -f "$ROOT/.run/dev.pid"
fi

if [[ -f "$ROOT/.run/worker.pid" ]]; then
  pid=$(cat "$ROOT/.run/worker.pid")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true
    green "Stopped worker (PID $pid)"
  fi
  rm -f "$ROOT/.run/worker.pid"
fi

# Kill ALL dev processes regardless of parent — turbo's nested children
# survive parent kills, leaving orphans bound to the ports.
pkill -9 -f "node.*apps/api/dist/main"  2>/dev/null && green "Stopped api"   || true
pkill -9 -f "node.*nest.js start"       2>/dev/null || true
pkill -9 -f "node.*apps/api/src/worker" 2>/dev/null && green "Stopped worker"|| true
pkill -9 -f "node.*apps/web/.*next"     2>/dev/null && green "Stopped web"   || true
pkill -9 -f "node.*apps/kiosk/.*next"   2>/dev/null && green "Stopped kiosk" || true
pkill -9 -f "node.*apps/admin"          2>/dev/null && green "Stopped admin" || true
pkill -9 -f "turbo run dev"             2>/dev/null || true
pkill -9 -f "tsx watch"                 2>/dev/null || true

# Belt-and-braces: clear any orphan still on dev ports.
for port in 3000 3100 4000 4100; do
  pid=$(lsof -ti ":$port" 2>/dev/null | head -n1)
  if [[ -n "$pid" ]]; then
    kill -9 "$pid" 2>/dev/null && green "Cleared port :$port (PID $pid)" || true
  fi
done

pkill -f 'ngrok.*http (3000|4000)' 2>/dev/null && green "Stopped ngrok tunnels" || true

docker compose stop postgres redis >/dev/null 2>&1 || true
green "Stopped backing services (bloomoulu postgres/redis)"
