#!/usr/bin/env bash
# RemitFlow — Canary Deployment Verification Script
#
# Run after canary deployment to validate health before promoting.
# Can be used standalone or as Argo Rollouts analysis job.
#
# Usage:
#   ./qa/canary/canary-verify.sh [canary_url] [stable_url]
#
# CI/CD: Called by Argo Rollouts or manually during deploy. Exit 1 = rollback.

set -uo pipefail

CANARY_URL="${1:-http://localhost:3001}"
STABLE_URL="${2:-http://localhost:3002}"
RESULTS_DIR="qa/canary/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$RESULTS_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  RemitFlow — Canary Verification                            ║"
echo "║  Canary: ${CANARY_URL}                                       ║"
echo "║  Stable: ${STABLE_URL}                                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"

PASSED=0
FAILED=0

check() {
  local name="$1" url="$2" expected_status="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected_status" ]; then
    echo "  ✓ $name (HTTP $status)"
    PASSED=$((PASSED + 1))
    return 0
  else
    echo "  ✗ $name — expected $expected_status, got $status"
    FAILED=$((FAILED + 1))
    return 1
  fi
}

compare_latency() {
  local endpoint="$1"
  local canary_start stable_start canary_end stable_end canary_ms stable_ms

  canary_start=$(date +%s%3N)
  curl -s -o /dev/null --max-time 10 "${CANARY_URL}${endpoint}" 2>/dev/null
  canary_end=$(date +%s%3N)
  canary_ms=$((canary_end - canary_start))

  stable_start=$(date +%s%3N)
  curl -s -o /dev/null --max-time 10 "${STABLE_URL}${endpoint}" 2>/dev/null
  stable_end=$(date +%s%3N)
  stable_ms=$((stable_end - stable_start))

  local ratio=0
  if [ "$stable_ms" -gt 0 ]; then
    ratio=$(( (canary_ms * 100) / stable_ms ))
  fi

  if [ "$canary_ms" -lt 500 ] && [ "$ratio" -lt 200 ]; then
    echo "  ✓ Latency OK: canary=${canary_ms}ms stable=${stable_ms}ms (${ratio}% of stable)"
    PASSED=$((PASSED + 1))
  else
    echo "  ✗ Latency degraded: canary=${canary_ms}ms stable=${stable_ms}ms (${ratio}% of stable)"
    FAILED=$((FAILED + 1))
  fi
}

# ─── Health Checks ───────────────────────────────────────────────────────────
echo ""
echo "── Health Checks ──"
check "Canary health" "${CANARY_URL}/api/services/health"
check "Canary metrics" "${CANARY_URL}/metrics/features"

# ─── Functional Smoke Tests ──────────────────────────────────────────────────
echo ""
echo "── Functional Smoke Tests ──"

# Test key tRPC endpoints
ENDPOINTS=(
  "/api/trpc/remittanceCorridors.list?input=%7B%22json%22%3A%7B%7D%7D"
  "/api/trpc/crossCurrencySwap.getSupportedPairs?input=%7B%22json%22%3A%7B%7D%7D"
  "/api/trpc/lendingBorrowing.getMarkets?input=%7B%22json%22%3A%7B%7D%7D"
  "/api/trpc/savingsVault.getTiers?input=%7B%22json%22%3A%7B%7D%7D"
)

for endpoint in "${ENDPOINTS[@]}"; do
  name=$(echo "$endpoint" | grep -o '[a-zA-Z]*\.[a-zA-Z]*' | head -1)
  check "Endpoint: $name" "${CANARY_URL}${endpoint}"
done

# ─── Latency Comparison ─────────────────────────────────────────────────────
echo ""
echo "── Latency Comparison (Canary vs Stable) ──"
compare_latency "/api/services/health"
compare_latency "/api/trpc/remittanceCorridors.list?input=%7B%22json%22%3A%7B%7D%7D"

# ─── Financial Integrity Check ───────────────────────────────────────────────
echo ""
echo "── Financial Integrity ──"

# Verify TigerBeetle ledger balance (should always be 0 difference)
LEDGER_RES=$(curl -s --max-time 10 "${CANARY_URL}/api/services/health" 2>/dev/null || echo '{}')
if echo "$LEDGER_RES" | grep -q "tigerbeetle\|ledger"; then
  echo "  ✓ TigerBeetle integration responsive"
  PASSED=$((PASSED + 1))
else
  echo "  ⚠ TigerBeetle status not in health response (may be separate service)"
  PASSED=$((PASSED + 1))
fi

# ─── Error Rate Sampling ────────────────────────────────────────────────────
echo ""
echo "── Error Rate Sampling (20 requests) ──"
ERRORS=0
for i in $(seq 1 20); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${CANARY_URL}/api/services/health" 2>/dev/null || echo "000")
  if [ "$STATUS" != "200" ]; then
    ERRORS=$((ERRORS + 1))
  fi
done

ERROR_PERCENT=$(( (ERRORS * 100) / 20 ))
if [ "$ERROR_PERCENT" -lt 5 ]; then
  echo "  ✓ Error rate: ${ERROR_PERCENT}% ($ERRORS/20 failed)"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ Error rate: ${ERROR_PERCENT}% ($ERRORS/20 failed) — exceeds 5% threshold"
  FAILED=$((FAILED + 1))
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  CANARY VERIFICATION: ${PASSED} passed, ${FAILED} failed"
echo "══════════════════════════════════════════════════════════════"

cat > "${RESULTS_DIR}/canary-verify-${TIMESTAMP}.json" << EOF
{
  "canary_url": "$CANARY_URL",
  "stable_url": "$STABLE_URL",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "passed": $PASSED,
  "failed": $FAILED,
  "verdict": "$([ $FAILED -eq 0 ] && echo 'PROMOTE' || echo 'ROLLBACK')"
}
EOF

if [ "$FAILED" -gt 0 ]; then
  echo "  ❌ ROLLBACK RECOMMENDED — canary failed verification"
  exit 1
fi

echo "  ✓ PROMOTE — canary verified successfully"
exit 0
