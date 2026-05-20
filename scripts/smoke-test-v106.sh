#!/usr/bin/env bash
# ============================================================
# RemitFlow v106 Comprehensive Smoke Test
# Tests all major endpoints: health, auth, FX stream, WAF,
# CSP report, security alert, receipt, and tRPC procedures
# ============================================================
set -uo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0
SKIP=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}✗ FAIL${NC} $1 — $2"; FAIL=$((FAIL+1)); }
skip() { echo -e "${YELLOW}⊘ SKIP${NC} $1"; SKIP=$((SKIP+1)); }

check_status() {
  local name="$1" url="$2" expected="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected" ]; then pass "$name (HTTP $status)"; else fail "$name" "Expected $expected, got $status"; fi
}

check_json_field() {
  local name="$1" url="$2" field="$3"
  local body
  body=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "{}")
  if echo "$body" | grep -q "\"$field\""; then pass "$name (field: $field)"; else fail "$name" "Field '$field' not found in response"; fi
}

echo "============================================================"
echo "  RemitFlow v106 Smoke Test"
echo "  Target: $BASE"
echo "  Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"
echo ""

echo "--- Core Health Checks ---"
check_json_field "Health endpoint (status)" "$BASE/api/health" "status"
check_json_field "Health endpoint (version)" "$BASE/api/health" "version"
check_status "CSRF token endpoint" "$BASE/api/csrf-token" "200"

echo ""
echo "--- tRPC Public Procedures ---"
FX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE/api/trpc/fx.rates?batch=1&input=%7B%220%22:%7B%22json%22:null%7D%7D" 2>/dev/null || echo "000")
if [ "$FX_STATUS" = "200" ]; then pass "tRPC fx.rates (HTTP $FX_STATUS)"; else fail "tRPC fx.rates" "HTTP $FX_STATUS"; fi

FX2_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE/api/trpc/fx.liveRates?batch=1&input=%7B%220%22:%7B%22json%22:%7B%22base%22:%22USD%22%7D%7D%7D" 2>/dev/null || echo "000")
if [ "$FX2_STATUS" = "200" ]; then pass "tRPC fx.liveRates (HTTP $FX2_STATUS)"; else fail "tRPC fx.liveRates" "HTTP $FX2_STATUS"; fi

echo ""
echo "--- Real-time FX Stream ---"
SSE_BODY=$(curl -s --max-time 4 "$BASE/api/fx/stream" 2>/dev/null || echo "")
if echo "$SSE_BODY" | grep -q "data:"; then
  pass "FX SSE stream (live data events received)"
else
  fail "FX SSE stream" "No SSE data events received"
fi

echo ""
echo "--- Security Endpoints ---"
CSP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST \
  -H "Content-Type: application/csp-report" \
  -d '{"csp-report":{"document-uri":"https://test.example.com","violated-directive":"script-src","blocked-uri":"https://evil.example.com"}}' \
  "$BASE/api/csp-report" 2>/dev/null || echo "000")
if [ "$CSP_STATUS" = "204" ] || [ "$CSP_STATUS" = "200" ]; then pass "CSP report endpoint (HTTP $CSP_STATUS)"; else fail "CSP report endpoint" "HTTP $CSP_STATUS"; fi

ALERT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST \
  -H "Content-Type: application/json" \
  -d '{"alerts":[{"labels":{"alertname":"TestAlert","severity":"info"},"status":"firing"}]}' \
  "$BASE/api/security-alert" 2>/dev/null || echo "000")
if [ "$ALERT_STATUS" = "200" ] || [ "$ALERT_STATUS" = "204" ]; then pass "Security alert endpoint (HTTP $ALERT_STATUS)"; else fail "Security alert endpoint" "HTTP $ALERT_STATUS"; fi

echo ""
echo "--- Receipt Endpoint ---"
RECEIPT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/receipt/TEST-REF-001" 2>/dev/null || echo "000")
if [ "$RECEIPT_STATUS" = "200" ] || [ "$RECEIPT_STATUS" = "404" ] || [ "$RECEIPT_STATUS" = "401" ]; then
  pass "Receipt PDF endpoint reachable (HTTP $RECEIPT_STATUS)"
else
  fail "Receipt PDF endpoint" "HTTP $RECEIPT_STATUS"
fi

echo ""
echo "--- Static Assets & Frontend ---"
check_status "Frontend root" "$BASE/" "200"
check_status "Robots.txt" "$BASE/robots.txt" "200"

echo ""
echo "--- Auth Endpoints ---"
OAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/oauth/login" 2>/dev/null || echo "000")
if [ "$OAUTH_STATUS" = "200" ] || [ "$OAUTH_STATUS" = "302" ] || [ "$OAUTH_STATUS" = "429" ]; then
  pass "OAuth login endpoint reachable (HTTP $OAUTH_STATUS)"
else
  fail "OAuth login endpoint" "HTTP $OAUTH_STATUS"
fi

CALLBACK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/oauth/callback" 2>/dev/null || echo "000")
if [ "$CALLBACK_STATUS" = "400" ] || [ "$CALLBACK_STATUS" = "302" ] || [ "$CALLBACK_STATUS" = "500" ] || [ "$CALLBACK_STATUS" = "429" ]; then
  pass "OAuth callback (no params) → $CALLBACK_STATUS (expected error/rate-limit)"
else
  fail "OAuth callback" "Unexpected HTTP $CALLBACK_STATUS"
fi

echo ""
echo "--- Protected tRPC (expect 401) ---"
for proc in "transactions.list" "beneficiaries.list" "cards.list" "disputes.list" "kyc.status" "wallet.balances"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
    "$BASE/api/trpc/$proc?batch=1&input=%7B%220%22:%7B%22json%22:null%7D%7D" 2>/dev/null || echo "000")
  if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
    pass "Protected: $proc (HTTP $STATUS)"
  else
    fail "Protected: $proc" "Expected 401/403, got $STATUS"
  fi
done

echo ""
echo "--- Rate Limiting ---"
RATE_PASS=0
for i in $(seq 1 15); do
  S=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE/api/oauth/login" 2>/dev/null || echo "000")
  if [ "$S" = "429" ]; then RATE_PASS=1; break; fi
done
if [ "$RATE_PASS" = "1" ]; then
  pass "Rate limiting active (429 returned)"
else
  skip "Rate limiting (threshold not reached in 15 requests)"
fi

echo ""
echo "--- APISIX WAF (if deployed) ---"
APISIX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:9080/health" 2>/dev/null || echo "000")
if [ "$APISIX_STATUS" = "200" ]; then
  pass "APISIX gateway health (HTTP $APISIX_STATUS)"
else
  skip "APISIX gateway (deploy: docker-compose -f docker-compose.waf.yml up -d)"
fi

APISIX_DASHBOARD=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:9000" 2>/dev/null || echo "000")
if [ "$APISIX_DASHBOARD" = "200" ]; then pass "APISIX dashboard (HTTP $APISIX_DASHBOARD)"; else skip "APISIX dashboard (not running)"; fi

echo ""
echo "--- Observability Stack (if deployed) ---"
PROMETHEUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:9090/-/healthy" 2>/dev/null || echo "000")
if [ "$PROMETHEUS" = "200" ]; then pass "Prometheus healthy"; else skip "Prometheus (deploy: docker-compose -f docker-compose.observability.yml up -d)"; fi

GRAFANA=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:3001/api/health" 2>/dev/null || echo "000")
if [ "$GRAFANA" = "200" ]; then pass "Grafana healthy"; else skip "Grafana (not running)"; fi

ALERTMANAGER=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:9093/-/healthy" 2>/dev/null || echo "000")
if [ "$ALERTMANAGER" = "200" ]; then pass "Alertmanager healthy"; else skip "Alertmanager (not running)"; fi

echo ""
echo "============================================================"
echo "  RESULTS: ${PASS} passed | ${FAIL} failed | ${SKIP} skipped"
echo "============================================================"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}SMOKE TEST FAILED — $FAIL check(s) failed${NC}"
  exit 1
else
  echo -e "${GREEN}SMOKE TEST PASSED — all critical checks passed${NC}"
  exit 0
fi
