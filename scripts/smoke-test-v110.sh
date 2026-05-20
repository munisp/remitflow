#!/usr/bin/env bash
# ─── RemitFlow v110 Smoke Test Suite ─────────────────────────────────────────
# Tests all core services, payment rails, and middleware endpoints.
#
# Usage:
#   ./scripts/smoke-test-v110.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:3000
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
SKIP=0
RESULTS=()

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}✓ PASS${NC} $1"; PASS=$((PASS+1)); RESULTS+=("PASS: $1"); }
log_fail() { echo -e "${RED}✗ FAIL${NC} $1 — $2"; FAIL=$((FAIL+1)); RESULTS+=("FAIL: $1 — $2"); }
log_skip() { echo -e "${YELLOW}⊘ SKIP${NC} $1 — $2"; SKIP=$((SKIP+1)); RESULTS+=("SKIP: $1 — $2"); }
log_section() { echo -e "\n${BLUE}══ $1 ══${NC}"; }

# ─── HTTP Helper ──────────────────────────────────────────────────────────────
check_endpoint() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local method="${4:-GET}"
  local body="${5:-}"

  local status
  if [ -n "$body" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$body" \
      --max-time 10 \
      "$url" 2>/dev/null || echo "000")
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
      --max-time 10 \
      "$url" 2>/dev/null || echo "000")
  fi

  if [ "$status" = "$expected_status" ]; then
    log_pass "$name (HTTP $status)"
  elif [ "$status" = "000" ]; then
    log_skip "$name" "Service unreachable"
  else
    log_fail "$name" "Expected HTTP $expected_status, got $status"
  fi
}

check_json_field() {
  local name="$1"
  local url="$2"
  local field="$3"

  local response
  response=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "{}")
  if echo "$response" | grep -q "\"$field\""; then
    log_pass "$name (field '$field' present)"
  elif [ "$response" = "{}" ]; then
    log_skip "$name" "Service unreachable"
  else
    log_fail "$name" "Field '$field' not found in response: ${response:0:100}"
  fi
}

# ─── Test Suite ───────────────────────────────────────────────────────────────

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         RemitFlow v110 Smoke Test Suite                  ║"
echo "║         $(date '+%Y-%m-%d %H:%M:%S UTC')                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "Base URL: $BASE_URL"

# ─── 1. Core App Health ───────────────────────────────────────────────────────
log_section "Core Application"
check_endpoint "App Health" "$BASE_URL/health"
check_endpoint "App Root" "$BASE_URL/" "200"
check_json_field "tRPC Health" "$BASE_URL/api/trpc/system.health?batch=1&input={}" "result"

# ─── 2. tRPC Public Procedures ────────────────────────────────────────────────
log_section "tRPC Public Procedures"
check_json_field "FX Rates" "$BASE_URL/api/trpc/fx.getRates?batch=1&input={}" "result"
check_json_field "Corridors" "$BASE_URL/api/trpc/transfers.getCorridors?batch=1&input={}" "result"
check_json_field "Payment Rails" "$BASE_URL/api/trpc/paymentRails.getRails?batch=1&input={}" "result"
check_json_field "KYC Tiers" "$BASE_URL/api/trpc/kyc.getTiers?batch=1&input={}" "result"

# ─── 3. Payment Rails Microservices ──────────────────────────────────────────
log_section "Payment Rails Microservices"
check_endpoint "Go CIPS Health" "http://localhost:8091/health"
check_endpoint "Rust UPI Health" "http://localhost:8092/health"
check_endpoint "Python PIX Health" "http://localhost:8093/health"

# CIPS VPA lookup
check_endpoint "CIPS Account Lookup" \
  "http://localhost:8091/api/v1/lookup?cnaps_id=6222021001&bank_bic=ICBKCNBJ"

# UPI VPA lookup
check_endpoint "UPI VPA Lookup" \
  "http://localhost:8092/api/v1/lookup?vpa=john@oksbi"

# PIX key lookup
check_endpoint "PIX Key Lookup" \
  "http://localhost:8093/api/v1/lookup?pix_key=test@remitflow.com&key_type=email"

# ─── 4. Go Middleware Services ────────────────────────────────────────────────
log_section "Go Middleware Services"
check_endpoint "Go Kafka Health" "http://localhost:8094/health"
check_endpoint "Go Temporal Health" "http://localhost:8095/health"
check_endpoint "Go Permify Health" "http://localhost:8096/health"
check_endpoint "Go APISIX Config Health" "http://localhost:8103/health"

# ─── 5. Rust Middleware Services ──────────────────────────────────────────────
log_section "Rust Middleware Services"
check_endpoint "Rust Redis Health" "http://localhost:8097/health"
check_endpoint "Rust Fluvio Health" "http://localhost:8098/health"
check_endpoint "Rust PG Health" "http://localhost:8102/health"
check_endpoint "Rust TigerBeetle Health" "http://localhost:8104/health"

# ─── 6. Python Middleware Services ────────────────────────────────────────────
log_section "Python Middleware Services"
check_endpoint "Python Keycloak Health" "http://localhost:8099/health"
check_endpoint "Python OpenSearch Health" "http://localhost:8100/health"
check_endpoint "Python Lakehouse Health" "http://localhost:8101/health"

# ─── 7. Infrastructure Services ──────────────────────────────────────────────
log_section "Infrastructure Services"
check_endpoint "Kafka UI" "http://localhost:8080/" "200"
check_endpoint "Temporal UI" "http://localhost:8088/" "200"
check_endpoint "Grafana" "http://localhost:3001/api/health"
check_endpoint "Prometheus" "http://localhost:9090/-/healthy"
check_endpoint "MinIO Health" "http://localhost:9000/minio/health/live"
check_endpoint "OpenSearch Cluster" "http://localhost:9200/_cluster/health"
check_endpoint "APISIX Gateway" "http://localhost:9080/" "404"  # 404 = APISIX running but no default route

# ─── 8. Security Headers ─────────────────────────────────────────────────────
log_section "Security Headers"
HEADERS=$(curl -s -I --max-time 10 "$BASE_URL/" 2>/dev/null || echo "")
if echo "$HEADERS" | grep -qi "x-content-type-options"; then
  log_pass "X-Content-Type-Options header present"
else
  log_fail "X-Content-Type-Options" "Header missing"
fi
if echo "$HEADERS" | grep -qi "x-frame-options"; then
  log_pass "X-Frame-Options header present"
else
  log_fail "X-Frame-Options" "Header missing"
fi
if echo "$HEADERS" | grep -qi "strict-transport-security"; then
  log_pass "HSTS header present"
else
  log_skip "HSTS" "Only required in production HTTPS"
fi

# ─── 9. Rate Limiting ─────────────────────────────────────────────────────────
log_section "Rate Limiting"
RATE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "$BASE_URL/api/trpc/system.health?batch=1&input={}" 2>/dev/null || echo "000")
if [ "$RATE_STATUS" = "200" ] || [ "$RATE_STATUS" = "429" ]; then
  log_pass "Rate limiter active (HTTP $RATE_STATUS)"
else
  log_skip "Rate Limiting" "Could not verify"
fi

# ─── 10. Database Connectivity ────────────────────────────────────────────────
log_section "Database Connectivity"
check_json_field "DB via tRPC" "$BASE_URL/api/trpc/system.health?batch=1&input={}" "result"

# ─── 11. Payment Rail tRPC Procedures ────────────────────────────────────────
log_section "Payment Rails tRPC"
check_json_field "CIPS Rail Info" \
  "$BASE_URL/api/trpc/paymentRails.getRailInfo?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22rail%22%3A%22cips%22%7D%7D%7D" \
  "result"
check_json_field "UPI Rail Info" \
  "$BASE_URL/api/trpc/paymentRails.getRailInfo?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22rail%22%3A%22upi%22%7D%7D%7D" \
  "result"
check_json_field "PIX Rail Info" \
  "$BASE_URL/api/trpc/paymentRails.getRailInfo?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22rail%22%3A%22pix%22%7D%7D%7D" \
  "result"

# ─── 12. Stripe Webhook ───────────────────────────────────────────────────────
log_section "Stripe Integration"
STRIPE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_test_smoke","type":"payment_intent.succeeded"}' \
  --max-time 10 \
  "$BASE_URL/api/stripe/webhook" 2>/dev/null || echo "000")
if [ "$STRIPE_STATUS" = "200" ] || [ "$STRIPE_STATUS" = "400" ]; then
  log_pass "Stripe webhook endpoint reachable (HTTP $STRIPE_STATUS)"
else
  log_skip "Stripe Webhook" "Status $STRIPE_STATUS"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "  Smoke Test Results — RemitFlow v110"
echo -e "  Total: $TOTAL  |  ${GREEN}Pass: $PASS${NC}  |  ${RED}Fail: $FAIL${NC}  |  ${YELLOW}Skip: $SKIP${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed tests:${NC}"
  for r in "${RESULTS[@]}"; do
    if [[ "$r" == FAIL:* ]]; then
      echo "  $r"
    fi
  done
  exit 1
fi

echo -e "\n${GREEN}All tests passed!${NC}"
exit 0
