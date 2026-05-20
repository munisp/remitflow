#!/usr/bin/env bash
# ── RemitFlow Smoke Test Suite ───────────────────────────────────────────────
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Default BASE_URL: http://localhost:3000

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
ERRORS=()

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# NOTE: Use PASS=$((PASS+1)) instead of ((PASS++)) to avoid bash set -e
# treating arithmetic-zero as a failure exit code.
log_pass() { echo -e "${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
log_fail() { echo -e "${RED}✗${NC} $1"; FAIL=$((FAIL+1)); ERRORS+=("$1"); }
log_info() { echo -e "${BLUE}→${NC} $1"; }

echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  RemitFlow Smoke Test Suite${NC}"
echo -e "${BLUE}  Target: ${BASE_URL}${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo ""

# ── Helper: call tRPC endpoint ───────────────────────────────────────────────
trpc_call() {
  local procedure="$1"
  local input="${2:-{}}"
  curl -sf \
    "${BASE_URL}/api/trpc/${procedure}?batch=1&input=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "${input}")" \
    -H "Content-Type: application/json" \
    2>/dev/null
}

# ── 1. Health Check ──────────────────────────────────────────────────────────
log_info "Testing health endpoint..."
HEALTH=$(trpc_call "system.health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  log_pass "Health check: status=ok"
else
  log_fail "Health check failed: $HEALTH"
fi

if echo "$HEALTH" | grep -q '"db":true'; then
  log_pass "Database connection: healthy"
else
  log_fail "Database connection: unhealthy"
fi

# ── 2. Static Assets ─────────────────────────────────────────────────────────
log_info "Testing static assets..."
HTTP_STATUS=$(curl -so /dev/null -w "%{http_code}" "${BASE_URL}/")
if [ "$HTTP_STATUS" = "200" ]; then
  log_pass "Root page returns 200"
else
  log_fail "Root page returned $HTTP_STATUS"
fi

# ── 3. tRPC Public Procedures ────────────────────────────────────────────────
log_info "Testing public tRPC procedures..."

# FX Rates
FX=$(trpc_call "fx.rates")
if echo "$FX" | grep -q '"NGN"'; then
  log_pass "FX rates: NGN rate available"
else
  log_fail "FX rates: NGN not found in response"
fi

# Corridors
CORRIDORS=$(trpc_call "corridors.list")
if echo "$CORRIDORS" | grep -q '"result"'; then
  log_pass "Corridors: list endpoint responds"
else
  log_fail "Corridors: list endpoint failed"
fi

# ── 4. Auth Endpoints ────────────────────────────────────────────────────────
log_info "Testing auth endpoints..."

# Auth me (returns 200 with UNAUTHORIZED body, or 401 — both are correct)
AUTH_ME=$(curl -so /dev/null -w "%{http_code}" "${BASE_URL}/api/trpc/auth.me?batch=1&input=%7B%7D")
if [ "$AUTH_ME" = "200" ] || [ "$AUTH_ME" = "401" ]; then
  log_pass "Auth.me: endpoint responds (status $AUTH_ME — expected without session)"
else
  log_fail "Auth.me: unexpected HTTP status $AUTH_ME"
fi

# OAuth callback endpoint exists
OAUTH=$(curl -so /dev/null -w "%{http_code}" "${BASE_URL}/api/oauth/callback")
if [ "$OAUTH" != "404" ]; then
  log_pass "OAuth callback endpoint: exists (status $OAUTH)"
else
  log_fail "OAuth callback endpoint: 404 not found"
fi

# ── 5. API Route Structure ───────────────────────────────────────────────────
log_info "Testing API route structure..."

# tRPC batch endpoint (GET with batch=1 parameter)
BATCH=$(curl -sf "${BASE_URL}/api/trpc/system.health?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
  -H "Content-Type: application/json" 2>/dev/null)
if echo "$BATCH" | grep -q '"result"'; then
  log_pass "tRPC batch GET: works"
else
  log_fail "tRPC batch GET: failed"
fi

# ── 6. Security Headers ──────────────────────────────────────────────────────
log_info "Testing security headers..."

HEADERS=$(curl -sI "${BASE_URL}/")
if echo "$HEADERS" | grep -qi "x-content-type-options"; then
  log_pass "X-Content-Type-Options header present"
else
  log_fail "X-Content-Type-Options header missing"
fi

# ── 7. Error Handling ────────────────────────────────────────────────────────
log_info "Testing error handling..."

# Non-existent procedure (tRPC returns 404 for unknown procedures)
BAD_PROC_STATUS=$(curl -so /dev/null -w "%{http_code}" "${BASE_URL}/api/trpc/nonexistent.procedure?batch=1&input=%7B%7D" 2>/dev/null)
if [ "$BAD_PROC_STATUS" = "404" ] || [ "$BAD_PROC_STATUS" = "400" ]; then
  log_pass "Non-existent procedure: returns $BAD_PROC_STATUS (not 500)"
else
  log_fail "Non-existent procedure: unexpected HTTP status $BAD_PROC_STATUS"
fi

# ── 8. Database Operations ───────────────────────────────────────────────────
log_info "Testing database operations..."

DB_HEALTH=$(trpc_call "system.health")
if echo "$DB_HEALTH" | grep -q '"db":true'; then
  log_pass "Database: read operation successful"
else
  log_fail "Database: read operation failed"
fi

# ── 9. New v73 Endpoints ─────────────────────────────────────────────────────
log_info "Testing v73 production endpoints..."

# Helper: curl without -f so 4xx responses are captured (not treated as errors)
trpc_call_any() {
  local procedure="$1"
  local input="${2:-{}}"
  curl -s \
    "${BASE_URL}/api/trpc/${procedure}?batch=1&input=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "${input}")" \
    -H "Content-Type: application/json" \
    2>/dev/null
}

# System config (admin-protected, expect FORBIDDEN or result)
SYSCFG=$(trpc_call_any "systemConfig.list")
if echo "$SYSCFG" | grep -q '"result"\|"UNAUTHORIZED"\|"FORBIDDEN"\|"error"'; then
  log_pass "SystemConfig.list: endpoint responds (admin-protected)"
else
  log_fail "SystemConfig.list: no response"
fi

# Compliance watchlist (admin-protected)
WATCHLIST=$(trpc_call_any "complianceWatchlist.list")
if echo "$WATCHLIST" | grep -q '"result"\|"UNAUTHORIZED"\|"FORBIDDEN"\|"error"'; then
  log_pass "ComplianceWatchlist.list: endpoint responds (admin-protected)"
else
  log_fail "ComplianceWatchlist.list: no response"
fi

# Partner payouts (admin-protected)
PAYOUTS=$(trpc_call_any "partnerPayouts.list")
if echo "$PAYOUTS" | grep -q '"result"\|"UNAUTHORIZED"\|"FORBIDDEN"\|"error"'; then
  log_pass "PartnerPayouts.list: endpoint responds (admin-protected)"
else
  log_fail "PartnerPayouts.list: no response"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
echo -e "  Results: ${GREEN}${PASS} passed${NC} / ${RED}${FAIL} failed${NC} / ${TOTAL} total"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}  Failed tests:${NC}"
  for err in "${ERRORS[@]}"; do
    echo -e "    ${RED}•${NC} $err"
  done
fi
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
else
  echo -e "${GREEN}All smoke tests passed!${NC}"
  exit 0
fi
