#!/usr/bin/env bash
# =============================================================================
# RemitFlow — Temporal Worker Startup Script
# Usage: ./scripts/start-temporal-worker.sh [--dev|--prod]
# =============================================================================
set -euo pipefail

MODE="${1:---dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[worker]${NC} $*"; }
success() { echo -e "${GREEN}[worker]${NC} $*"; }
warn()    { echo -e "${YELLOW}[worker]${NC} $*"; }
error()   { echo -e "${RED}[worker]${NC} $*" >&2; exit 1; }

# ── Environment defaults ──────────────────────────────────────────────────────
export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
export TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-remitflow}"
export TEMPORAL_TASK_QUEUE="${TEMPORAL_TASK_QUEUE:-remitflow-transfers}"
export WORKER_HEALTH_PORT="${WORKER_HEALTH_PORT:-8080}"
export NODE_ENV="${NODE_ENV:-development}"

# Load .env if present (dev only)
if [[ -f "$PROJECT_ROOT/.env" && "$MODE" == "--dev" ]]; then
  info "Loading .env from project root"
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

info "Starting Temporal worker"
info "  Temporal:   $TEMPORAL_ADDRESS / namespace=$TEMPORAL_NAMESPACE"
info "  Task queue: $TEMPORAL_TASK_QUEUE"
info "  Mode:       $MODE"
info "  Health:     http://localhost:$WORKER_HEALTH_PORT/health"

# ── Wait for Temporal to be reachable ────────────────────────────────────────
wait_for_temporal() {
  local host port max_attempts=30 attempt=0
  IFS=':' read -r host port <<< "$TEMPORAL_ADDRESS"
  port="${port:-7233}"
  info "Waiting for Temporal at $host:$port…"
  until nc -z "$host" "$port" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      warn "Temporal not reachable after ${max_attempts}s — starting anyway (graceful fallback enabled)"
      return 0
    fi
    sleep 1
  done
  success "Temporal is reachable"
}

# Only wait in production (dev uses graceful fallback)
if [[ "$MODE" == "--prod" ]]; then
  wait_for_temporal
fi

# ── Launch ────────────────────────────────────────────────────────────────────
cd "$PROJECT_ROOT"

if [[ "$MODE" == "--dev" ]]; then
  info "Running in dev mode with tsx watch"
  exec npx tsx --tsconfig tsconfig.json server/temporal/worker.ts
else
  info "Running in production mode (compiled JS)"
  if [[ ! -f "dist/server/temporal/worker.js" ]]; then
    info "Compiled output not found — building…"
    pnpm exec tsc --project tsconfig.json --outDir dist --skipLibCheck --declaration false
  fi
  exec node dist/server/temporal/worker.js
fi
