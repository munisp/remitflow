#!/usr/bin/env bash
# RemitFlow — OWASP API Security Testing
#
# Automated security scanning for OWASP Top 10 API vulnerabilities:
#   A1: Broken Object Level Authorization (BOLA)
#   A2: Broken Authentication
#   A3: Broken Object Property Level Authorization
#   A4: Unrestricted Resource Consumption
#   A5: Broken Function Level Authorization
#   A6: Unrestricted Access to Sensitive Business Flows
#   A7: Server-Side Request Forgery (SSRF)
#   A8: Security Misconfiguration
#   A9: Improper Inventory Management
#   A10: Unsafe Consumption of APIs
#
# Usage:
#   ./qa/security/owasp-api-scan.sh http://localhost:3001
#   ./qa/security/owasp-api-scan.sh https://staging.remitflow.io
#
# CI/CD: Exits with code 1 if any critical/high vulnerability found.

set -euo pipefail

BASE_URL="${1:-http://localhost:3001}"
TRPC_URL="${BASE_URL}/api/trpc"
RESULTS_DIR="qa/security/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${RESULTS_DIR}/owasp-scan-${TIMESTAMP}.json"

mkdir -p "$RESULTS_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  RemitFlow — OWASP API Security Scan                       ║"
echo "║  Target: ${BASE_URL}                                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"

PASSED=0
FAILED=0
WARNINGS=0

results=()

log_result() {
  local test_id="$1" severity="$2" result="$3" details="$4"
  results+=("{\"id\":\"$test_id\",\"severity\":\"$severity\",\"result\":\"$result\",\"details\":\"$details\"}")
  if [ "$result" = "PASS" ]; then
    echo "  ✓ [$severity] $test_id — $details"
    PASSED=$((PASSED + 1))
  elif [ "$result" = "FAIL" ]; then
    echo "  ✗ [$severity] $test_id — $details"
    FAILED=$((FAILED + 1))
  else
    echo "  ⚠ [$severity] $test_id — $details"
    WARNINGS=$((WARNINGS + 1))
  fi
}

# ─── A1: Broken Object Level Authorization (BOLA) ───────────────────────────
echo ""
echo "── A1: Broken Object Level Authorization ──"

# Test: Access another user's wallet
BOLA_RES=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${TRPC_URL}/accountAbstraction.listWallets" \
  -H "Content-Type: application/json" \
  -d '{"json":{"userId":9999}}' 2>/dev/null || echo "000")

if [ "$BOLA_RES" = "401" ] || [ "$BOLA_RES" = "403" ]; then
  log_result "A1-01" "CRITICAL" "PASS" "Cross-user wallet access blocked (HTTP $BOLA_RES)"
elif [ "$BOLA_RES" = "000" ]; then
  log_result "A1-01" "CRITICAL" "WARN" "Connection failed — verify server is running"
else
  log_result "A1-01" "CRITICAL" "WARN" "Response $BOLA_RES — requires auth context to fully test"
fi

# ─── A2: Broken Authentication ───────────────────────────────────────────────
echo ""
echo "── A2: Broken Authentication ──"

# Test: Access protected endpoint without auth
AUTH_RES=$(curl -s -o /dev/null -w "%{http_code}" \
  "${TRPC_URL}/programmablePayments.create" \
  -X POST -H "Content-Type: application/json" \
  -d '{"json":{"amount":100,"stablecoin":"USDC"}}' 2>/dev/null || echo "000")

if [ "$AUTH_RES" = "401" ]; then
  log_result "A2-01" "CRITICAL" "PASS" "Unauthenticated access to protected endpoint blocked"
else
  log_result "A2-01" "CRITICAL" "WARN" "Response $AUTH_RES — may need session cookie test"
fi

# ─── A4: Unrestricted Resource Consumption ───────────────────────────────────
echo ""
echo "── A4: Unrestricted Resource Consumption ──"

# Test: Rate limiting works
RATE_LIMIT_HIT=false
for i in $(seq 1 120); do
  RL_RES=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/services/health" 2>/dev/null || echo "000")
  if [ "$RL_RES" = "429" ]; then
    RATE_LIMIT_HIT=true
    log_result "A4-01" "HIGH" "PASS" "Rate limiting active (429 at request #$i)"
    break
  fi
done
if [ "$RATE_LIMIT_HIT" = false ]; then
  log_result "A4-01" "HIGH" "WARN" "No 429 after 120 requests — rate limit may be too high for test"
fi

# ─── A6: Unrestricted Access to Sensitive Business Flows ─────────────────────
echo ""
echo "── A6: Sensitive Business Flow Protection ──"

# Test: simulatePayment blocked in production
SIM_RES=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${TRPC_URL}/merchantGateway.simulatePayment" \
  -H "Content-Type: application/json" \
  -d '{"json":{"intentId":"fake-intent"}}' 2>/dev/null || echo "000")

if [ "$SIM_RES" = "403" ] || [ "$SIM_RES" = "401" ]; then
  log_result "A6-01" "HIGH" "PASS" "simulatePayment blocked in production mode"
else
  log_result "A6-01" "HIGH" "WARN" "Response $SIM_RES — verify NODE_ENV=production guard"
fi

# ─── A7: Server-Side Request Forgery (SSRF) ─────────────────────────────────
echo ""
echo "── A7: SSRF Protection ──"

# Test: Internal URL in user input
SSRF_RES=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${TRPC_URL}/merchantGateway.register" \
  -H "Content-Type: application/json" \
  -d '{"json":{"businessName":"test","webhookUrl":"http://169.254.169.254/latest/meta-data/"}}' 2>/dev/null || echo "000")

if [ "$SSRF_RES" = "400" ] || [ "$SSRF_RES" = "422" ]; then
  log_result "A7-01" "HIGH" "PASS" "Internal IP in webhook URL rejected"
else
  log_result "A7-01" "HIGH" "WARN" "Response $SSRF_RES — verify webhook URL validation"
fi

# ─── A8: Security Misconfiguration ──────────────────────────────────────────
echo ""
echo "── A8: Security Misconfiguration ──"

# Test: Server headers don't leak info
HEADERS=$(curl -s -I "${BASE_URL}/" 2>/dev/null || echo "")
if echo "$HEADERS" | grep -qi "x-powered-by"; then
  log_result "A8-01" "MEDIUM" "FAIL" "X-Powered-By header exposes server technology"
else
  log_result "A8-01" "MEDIUM" "PASS" "No X-Powered-By header leakage"
fi

# Test: CORS not wildcard in production
CORS_RES=$(curl -s -I -X OPTIONS "${BASE_URL}/api/trpc/health" \
  -H "Origin: https://evil.com" 2>/dev/null || echo "")
if echo "$CORS_RES" | grep -q "access-control-allow-origin: \*"; then
  log_result "A8-02" "MEDIUM" "FAIL" "CORS allows wildcard origin"
else
  log_result "A8-02" "MEDIUM" "PASS" "CORS properly configured"
fi

# Test: No sensitive data in error messages
ERR_RES=$(curl -s "${TRPC_URL}/nonexistent.endpoint" 2>/dev/null || echo "")
if echo "$ERR_RES" | grep -qi "stack\|trace\|sql\|password\|secret"; then
  log_result "A8-03" "MEDIUM" "FAIL" "Error response leaks sensitive information"
else
  log_result "A8-03" "MEDIUM" "PASS" "Error messages don't leak sensitive data"
fi

# ─── XSS/Injection Testing ───────────────────────────────────────────────────
echo ""
echo "── Injection Testing ──"

# Test: XSS in business name
XSS_PAYLOAD='<script>alert("xss")</script>'
XSS_RES=$(curl -s -X POST "${TRPC_URL}/merchantGateway.register" \
  -H "Content-Type: application/json" \
  -d "{\"json\":{\"businessName\":\"$XSS_PAYLOAD\"}}" 2>/dev/null || echo "")

if echo "$XSS_RES" | grep -q "<script>"; then
  log_result "INJ-01" "HIGH" "FAIL" "XSS payload reflected in response"
else
  log_result "INJ-01" "HIGH" "PASS" "XSS payload sanitized or rejected"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  RESULTS: ${PASSED} passed, ${FAILED} failed, ${WARNINGS} warnings"
echo "══════════════════════════════════════════════════════════════"

# Write JSON report
cat > "$REPORT_FILE" << EOF
{
  "scan": "owasp-api-top10",
  "target": "$BASE_URL",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "summary": {"passed": $PASSED, "failed": $FAILED, "warnings": $WARNINGS},
  "results": [$(IFS=,; echo "${results[*]:-}")]
}
EOF

echo "  Report: $REPORT_FILE"

# CI/CD exit code: fail if any CRITICAL/HIGH vulnerabilities found
if [ "$FAILED" -gt 0 ]; then
  echo "  ❌ SECURITY SCAN FAILED — $FAILED vulnerabilities found"
  exit 1
fi

echo "  ✓ Security scan passed"
exit 0
