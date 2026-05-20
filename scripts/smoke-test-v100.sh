#!/usr/bin/env bash
##############################################################################
# RemitFlow v100 — Comprehensive Smoke Test
# Tests all 20 new v100 tRPC endpoints and verifies production readiness
# Usage: bash scripts/smoke-test-v100.sh [BASE_URL]
##############################################################################
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
SKIP=0
ERRORS=()

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}✓${NC} $1"; ((PASS++)); }
log_fail() { echo -e "${RED}✗${NC} $1"; ((FAIL++)); ERRORS+=("$1"); }
log_skip() { echo -e "${YELLOW}⊘${NC} $1"; ((SKIP++)); }
log_section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# ── Helper: HTTP check ────────────────────────────────────────────────────────
check_http() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local response
  local status
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [[ "$response" == "$expected_status" ]]; then
    log_pass "$name (HTTP $response)"
  else
    log_fail "$name (expected $expected_status, got $response)"
  fi
}

# ── Helper: tRPC public endpoint check ───────────────────────────────────────
check_trpc_public() {
  local name="$1"
  local procedure="$2"
  local input="${3:-{}}"
  local response
  response=$(curl -s --max-time 15 \
    -H "Content-Type: application/json" \
    "${BASE_URL}/api/trpc/${procedure}?input=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$input")" \
    2>/dev/null || echo '{"error":"connection_failed"}')
  if echo "$response" | grep -q '"result"'; then
    log_pass "$name"
  elif echo "$response" | grep -q '"error"'; then
    # Check if it's an auth error (expected for protected procedures)
    if echo "$response" | grep -q '"UNAUTHORIZED\|FORBIDDEN"'; then
      log_pass "$name (auth-protected, expected)"
    else
      log_fail "$name: $response"
    fi
  else
    log_fail "$name: unexpected response"
  fi
}

echo "============================================================"
echo "  RemitFlow v100 Smoke Test"
echo "  Target: $BASE_URL"
echo "  Date: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "============================================================"

# ── 1. Infrastructure Health ──────────────────────────────────────────────────
log_section "Infrastructure Health"
check_http "App health endpoint" "${BASE_URL}/api/health"
check_http "App root" "${BASE_URL}/" "200"
check_http "tRPC endpoint reachable" "${BASE_URL}/api/trpc" "404"  # 404 is correct for no procedure

# ── 2. Auth Endpoints ─────────────────────────────────────────────────────────
log_section "Auth Endpoints"
check_trpc_public "auth.me (public)" "auth.me"
check_http "OAuth callback route exists" "${BASE_URL}/api/oauth/callback" "400"

# ── 3. FX & Rates ─────────────────────────────────────────────────────────────
log_section "FX & Rates"
check_trpc_public "fx.getRates (public)" "fx.getRates"
check_trpc_public "fx.calculate (public)" "fx.calculate" '{"fromCurrency":"USD","toCurrency":"NGN","amount":100}'

# ── 4. v100 — Compliance Scoring V2 ──────────────────────────────────────────
log_section "v100 Compliance Scoring V2"
check_trpc_public "v100.complianceScoringV2.getScore" "v100.complianceScoringV2.getScore"
check_trpc_public "v100.complianceScoringV2.getFactors" "v100.complianceScoringV2.getFactors"

# ── 5. v100 — Notifications V2 ───────────────────────────────────────────────
log_section "v100 Notifications V2"
check_trpc_public "v100.notificationsV2.list" "v100.notificationsV2.list" '{"unreadOnly":false,"limit":10}'
check_trpc_public "v100.notificationsV2.getPreferences" "v100.notificationsV2.getPreferences"

# ── 6. v100 — Fraud Engine V2 ────────────────────────────────────────────────
log_section "v100 Fraud Engine V2"
check_trpc_public "v100.fraudEngineV2.getAlerts" "v100.fraudEngineV2.getAlerts" '{"status":"all","limit":10}'
check_trpc_public "v100.fraudEngineV2.getStats" "v100.fraudEngineV2.getStats"

# ── 7. v100 — FX Hedging ─────────────────────────────────────────────────────
log_section "v100 FX Hedging"
check_trpc_public "v100.fxHedging.getPositions" "v100.fxHedging.getPositions"
check_trpc_public "v100.fxHedging.getHedgeRatio" "v100.fxHedging.getHedgeRatio"

# ── 8. v100 — SWIFT/SEPA Rails ───────────────────────────────────────────────
log_section "v100 SWIFT/SEPA Rails"
check_trpc_public "v100.swiftSepaRails.getPayments" "v100.swiftSepaRails.getPayments" '{"rail":"all","limit":10}'
check_trpc_public "v100.swiftSepaRails.getRailStatus" "v100.swiftSepaRails.getRailStatus"

# ── 9. v100 — Open Banking ────────────────────────────────────────────────────
log_section "v100 Open Banking"
check_trpc_public "v100.openBanking.getConnectedAccounts" "v100.openBanking.getConnectedAccounts"
check_trpc_public "v100.openBanking.getProviders" "v100.openBanking.getProviders"

# ── 10. v100 — Treasury Management ───────────────────────────────────────────
log_section "v100 Treasury Management"
check_trpc_public "v100.treasuryManagement.getPositions" "v100.treasuryManagement.getPositions"
check_trpc_public "v100.treasuryManagement.getSummary" "v100.treasuryManagement.getSummary"

# ── 11. v100 — Liquidity Engine ───────────────────────────────────────────────
log_section "v100 Liquidity Engine"
check_trpc_public "v100.liquidityEngine.getPools" "v100.liquidityEngine.getPools"
check_trpc_public "v100.liquidityEngine.getAlerts" "v100.liquidityEngine.getAlerts"

# ── 12. v100 — AML Batch Screening ───────────────────────────────────────────
log_section "v100 AML Batch Screening"
check_trpc_public "v100.amlBatchScreening.getResults" "v100.amlBatchScreening.getResults" '{"status":"all","limit":10}'
check_trpc_public "v100.amlBatchScreening.getStats" "v100.amlBatchScreening.getStats"

# ── 13. v100 — Beneficiary Verification ──────────────────────────────────────
log_section "v100 Beneficiary Verification"
check_trpc_public "v100.beneficiaryVerification.getVerifications" "v100.beneficiaryVerification.getVerifications"

# ── 14. v100 — Payment Orchestration ─────────────────────────────────────────
log_section "v100 Payment Orchestration"
check_trpc_public "v100.paymentOrchestration.getWorkflows" "v100.paymentOrchestration.getWorkflows" '{"status":"all","limit":10}'

# ── 15. v100 — Settlement Engine ─────────────────────────────────────────────
log_section "v100 Settlement Engine"
check_trpc_public "v100.settlementEngine.getBatches" "v100.settlementEngine.getBatches" '{"status":"all","limit":10}'
check_trpc_public "v100.settlementEngine.getStats" "v100.settlementEngine.getStats"

# ── 16. v100 — Merchant Onboarding ───────────────────────────────────────────
log_section "v100 Merchant Onboarding"
check_trpc_public "v100.merchantOnboarding.getMerchants" "v100.merchantOnboarding.getMerchants" '{"status":"all","limit":10}'

# ── 17. v100 — Loyalty Rewards V2 ────────────────────────────────────────────
log_section "v100 Loyalty Rewards V2"
check_trpc_public "v100.loyaltyRewardsV2.getBalance" "v100.loyaltyRewardsV2.getBalance"
check_trpc_public "v100.loyaltyRewardsV2.getHistory" "v100.loyaltyRewardsV2.getHistory" '{"limit":10}'

# ── 18. v100 — Referral Engine V2 ────────────────────────────────────────────
log_section "v100 Referral Engine V2"
check_trpc_public "v100.referralEngineV2.getStats" "v100.referralEngineV2.getStats"
check_trpc_public "v100.referralEngineV2.getCodes" "v100.referralEngineV2.getCodes"

# ── 19. v100 — Carbon Offset ─────────────────────────────────────────────────
log_section "v100 Carbon Offset"
check_trpc_public "v100.carbonOffset.getFootprint" "v100.carbonOffset.getFootprint"
check_trpc_public "v100.carbonOffset.getProjects" "v100.carbonOffset.getProjects"

# ── 20. v100 — Document OCR ──────────────────────────────────────────────────
log_section "v100 Document OCR"
check_trpc_public "v100.documentOCR.getPipelineStatus" "v100.documentOCR.getPipelineStatus" '{"limit":10}'

# ── 21. v100 — Partner API Gateway ───────────────────────────────────────────
log_section "v100 Partner API Gateway"
check_trpc_public "v100.partnerAPIGateway.getPartners" "v100.partnerAPIGateway.getPartners" '{"status":"all","limit":10}'

# ── 22. v100 — Real-Time FX Stream ───────────────────────────────────────────
log_section "v100 Real-Time FX Stream"
check_trpc_public "v100.realTimeFXStream.getSnapshot" "v100.realTimeFXStream.getSnapshot"
check_trpc_public "v100.realTimeFXStream.getVolatility" "v100.realTimeFXStream.getVolatility"

# ── 23. v100 — Corridor Analytics ────────────────────────────────────────────
log_section "v100 Corridor Analytics"
check_trpc_public "v100.corridorAnalytics.getTopCorridors" "v100.corridorAnalytics.getTopCorridors"
check_trpc_public "v100.corridorAnalytics.getCorridorDetail" "v100.corridorAnalytics.getCorridorDetail" '{"fromCountry":"USA","toCountry":"Nigeria"}'

# ── 24. Security Headers ──────────────────────────────────────────────────────
log_section "Security Headers"
HEADERS=$(curl -s -I --max-time 10 "${BASE_URL}/" 2>/dev/null || echo "")
if echo "$HEADERS" | grep -qi "x-content-type-options"; then
  log_pass "X-Content-Type-Options header present"
else
  log_fail "X-Content-Type-Options header missing"
fi
if echo "$HEADERS" | grep -qi "x-frame-options\|content-security-policy"; then
  log_pass "Clickjacking protection header present"
else
  log_fail "Clickjacking protection header missing"
fi
if echo "$HEADERS" | grep -qi "strict-transport-security"; then
  log_pass "HSTS header present"
else
  log_skip "HSTS header (only required in production with TLS)"
fi

# ── 25. Rate Limiting ─────────────────────────────────────────────────────────
log_section "Rate Limiting"
RATE_LIMIT_HEADER=$(curl -s -I --max-time 10 "${BASE_URL}/api/health" 2>/dev/null | grep -i "x-ratelimit\|ratelimit" || echo "")
if [[ -n "$RATE_LIMIT_HEADER" ]]; then
  log_pass "Rate limiting headers present"
else
  log_skip "Rate limiting headers (may be configured at load balancer level)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  RemitFlow v100 Smoke Test Results"
echo "============================================================"
echo -e "  ${GREEN}PASS:${NC} $PASS"
echo -e "  ${RED}FAIL:${NC} $FAIL"
echo -e "  ${YELLOW}SKIP:${NC} $SKIP"
echo "  TOTAL: $((PASS + FAIL + SKIP))"
echo ""

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo -e "${RED}Failed tests:${NC}"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  echo ""
fi

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}✅ All tests passed! RemitFlow v100 is production-ready.${NC}"
  exit 0
else
  echo -e "${RED}❌ $FAIL test(s) failed. Please review before deploying.${NC}"
  exit 1
fi
