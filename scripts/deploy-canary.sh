#!/bin/bash
# ─── RemitFlow Canary Deployment Script ──────────────────────────────────────────
#
# Performs progressive traffic shift: 0% → 10% → 25% → 50% → 100%
# Automatically rolls back if error rate exceeds threshold at any stage.
#
# Usage:
#   ./scripts/deploy-canary.sh v2.1.0                     # Deploy version
#   ./scripts/deploy-canary.sh v2.1.0 --skip-tests        # Skip smoke tests
#   ./scripts/deploy-canary.sh --rollback                 # Manual rollback
#
# Required:
#   - kubectl configured with cluster access
#   - Istio installed in cluster
#   - Prometheus accessible for metrics
#
set -euo pipefail

VERSION="${1:-}"
NAMESPACE="remitflow"
REGISTRY="registry.remitflow.com"
ERROR_THRESHOLD="5"  # Max error rate % before rollback
PROMETHEUS_URL="${PROMETHEUS_URL:-http://prometheus.remitflow.svc:9090}"
WAIT_BETWEEN_STAGES=60  # seconds to observe each traffic stage

# Traffic stages (percentage to canary)
STAGES=(10 25 50 100)

log() { echo "[$(date +%H:%M:%S)] $*"; }
err() { echo "[$(date +%H:%M:%S)] ERROR: $*" >&2; }

# ─── Rollback ────────────────────────────────────────────────────────────────────
rollback() {
  log "🔄 Rolling back to stable (blue)..."
  
  # Set traffic 100% to stable
  kubectl -n "$NAMESPACE" patch virtualservice remitflow-api --type merge -p '{
    "spec": {"http": [{"route": [
      {"destination": {"host": "remitflow-api", "subset": "stable"}, "weight": 100},
      {"destination": {"host": "remitflow-api", "subset": "canary"}, "weight": 0}
    ]}]}
  }'
  
  # Scale down green
  kubectl -n "$NAMESPACE" scale deployment remitflow-api-green --replicas=0
  
  log "✓ Rollback complete — all traffic on stable (blue)"
}

# ─── Health Check ────────────────────────────────────────────────────────────────
check_canary_health() {
  local stage_pct=$1
  log "  Checking canary health at ${stage_pct}% traffic..."
  
  # Wait for metrics to accumulate
  sleep "$WAIT_BETWEEN_STAGES"
  
  # Check pod status
  local ready=$(kubectl -n "$NAMESPACE" get pods -l version=green --no-headers 2>/dev/null | grep -c "Running" || echo 0)
  if [ "$ready" -eq 0 ]; then
    err "No healthy canary pods!"
    return 1
  fi
  
  # Check error rate from Prometheus
  local error_rate=$(curl -s "${PROMETHEUS_URL}/api/v1/query?query=rate(http_requests_total{namespace=\"${NAMESPACE}\",version=\"green\",code=~\"5..\"}[2m])/rate(http_requests_total{namespace=\"${NAMESPACE}\",version=\"green\"}[2m])*100" 2>/dev/null | \
    python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('data',{}).get('result',[{}])[0].get('value',['',0])[1])" 2>/dev/null || echo "0")
  
  log "  Error rate: ${error_rate}% (threshold: ${ERROR_THRESHOLD}%)"
  
  # Compare with threshold
  if python3 -c "exit(0 if float('${error_rate}') < float('${ERROR_THRESHOLD}') else 1)" 2>/dev/null; then
    log "  ✓ Health check passed"
    return 0
  else
    err "Error rate ${error_rate}% exceeds threshold ${ERROR_THRESHOLD}%"
    return 1
  fi
}

# ─── Smoke Test ──────────────────────────────────────────────────────────────────
run_smoke_tests() {
  if [ "${2:-}" = "--skip-tests" ]; then
    log "Skipping smoke tests (--skip-tests)"
    return 0
  fi
  
  log "Running smoke tests against canary..."
  
  # Get canary pod IP
  local canary_pod=$(kubectl -n "$NAMESPACE" get pods -l version=green -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [ -z "$canary_pod" ]; then
    err "No canary pod found"
    return 1
  fi
  
  # Port-forward and test
  kubectl -n "$NAMESPACE" port-forward "pod/${canary_pod}" 3099:3000 &
  local pf_pid=$!
  sleep 3
  
  local health=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/api/health --max-time 5 2>/dev/null || echo "000")
  kill "$pf_pid" 2>/dev/null || true
  
  if [ "$health" = "200" ]; then
    log "  ✓ Smoke test passed (health: ${health})"
    return 0
  else
    err "Smoke test failed (health: ${health})"
    return 1
  fi
}

# ─── Deploy Canary ───────────────────────────────────────────────────────────────
deploy_canary() {
  local version=$1
  log "═══════════════════════════════════════════════════"
  log " Canary Deploy: ${version}"
  log "═══════════════════════════════════════════════════"
  
  # Update green deployment image
  log "Updating green deployment to ${REGISTRY}/api:${version}..."
  kubectl -n "$NAMESPACE" set image deployment/remitflow-api-green \
    api="${REGISTRY}/api:${version}"
  
  # Scale up green (1 replica initially for testing)
  kubectl -n "$NAMESPACE" scale deployment remitflow-api-green --replicas=1
  
  # Wait for green to be ready
  log "Waiting for green deployment to be ready..."
  kubectl -n "$NAMESPACE" rollout status deployment/remitflow-api-green --timeout=120s
  
  # Run smoke tests
  run_smoke_tests "$@"
  if [ $? -ne 0 ]; then
    rollback
    exit 1
  fi
  
  # Progressive traffic shift
  for pct in "${STAGES[@]}"; do
    local stable_pct=$((100 - pct))
    log "Shifting traffic: stable=${stable_pct}%, canary=${pct}%..."
    
    # Scale green proportionally
    local green_replicas=$(( (pct * 3 + 99) / 100 ))  # At least 1, proportional to traffic
    [ "$green_replicas" -lt 1 ] && green_replicas=1
    kubectl -n "$NAMESPACE" scale deployment remitflow-api-green --replicas="$green_replicas"
    
    # Update Istio traffic weights
    kubectl -n "$NAMESPACE" patch virtualservice remitflow-api --type merge -p "{
      \"spec\": {\"http\": [{\"route\": [
        {\"destination\": {\"host\": \"remitflow-api\", \"subset\": \"stable\"}, \"weight\": ${stable_pct}},
        {\"destination\": {\"host\": \"remitflow-api\", \"subset\": \"canary\"}, \"weight\": ${pct}}
      ]}]}
    }"
    
    # Check health at this stage
    if ! check_canary_health "$pct"; then
      err "Canary failed at ${pct}% — initiating rollback"
      rollback
      exit 1
    fi
  done
  
  # ─── Promote: green becomes the new stable ────────────────────────────────────
  log "Promoting green to stable..."
  
  # Update blue to use new image
  kubectl -n "$NAMESPACE" set image deployment/remitflow-api-blue \
    api="${REGISTRY}/api:${version}"
  kubectl -n "$NAMESPACE" rollout status deployment/remitflow-api-blue --timeout=180s
  
  # Route all traffic to stable (blue, now with new version)
  kubectl -n "$NAMESPACE" patch virtualservice remitflow-api --type merge -p '{
    "spec": {"http": [{"route": [
      {"destination": {"host": "remitflow-api", "subset": "stable"}, "weight": 100},
      {"destination": {"host": "remitflow-api", "subset": "canary"}, "weight": 0}
    ]}]}
  }'
  
  # Scale down green
  kubectl -n "$NAMESPACE" scale deployment remitflow-api-green --replicas=0
  
  log "═══════════════════════════════════════════════════"
  log " ✓ Canary deploy complete: ${version}"
  log "   Blue updated, green scaled down, 100% stable"
  log "═══════════════════════════════════════════════════"
}

# ─── Main ────────────────────────────────────────────────────────────────────────
if [ "$VERSION" = "--rollback" ]; then
  rollback
  exit 0
fi

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [--skip-tests]"
  echo "       $0 --rollback"
  exit 1
fi

deploy_canary "$VERSION" "${2:-}"
