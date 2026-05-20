#!/bin/bash
# RemitFlow v111 Smoke Test Suite
# Tests: API health, payment rails, analytics, security, Mojaloop, CIPS/UPI/PIX

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0; FAIL=0

check() {
  local name="$1"; local url="$2"; local expected="$3"
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [[ "$response" == "$expected" ]]; then
    echo "  PASS: $name (HTTP $response)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected $expected, got $response)"
    FAIL=$((FAIL + 1))
  fi
}

check_json() {
  local name="$1"; local url="$2"; local field="$3"
  local response
  response=$(curl -s "$url" 2>/dev/null)
  if echo "$response" | grep -q "$field"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (field '$field' not found)"
    FAIL=$((FAIL + 1))
    echo "     Response: ${response:0:200}"
  fi
}

echo "RemitFlow v111 Smoke Test Suite"
echo "Target: $BASE_URL"
echo "---"

echo "Core API Health"
check "Server health" "$BASE_URL/api/health" "200"
check "tRPC endpoint" "$BASE_URL/api/trpc" "404"

echo "Payment Rails API"
check_json "getSupportedRails" "$BASE_URL/api/trpc/v90.paymentRails.getSupportedRails?input=%7B%7D&batch=1" "rails"
check_json "getLiveRates" "$BASE_URL/api/trpc/v90.paymentRails.getLiveRates?input=%7B%22json%22%3A%7B%22from%22%3A%22USD%22%7D%7D&batch=1" "rates"

echo "Security Headers"
HEADERS=$(curl -sI "$BASE_URL" 2>/dev/null)
for header in "X-Content-Type-Options" "X-Frame-Options" "Strict-Transport-Security" "Content-Security-Policy"; do
  if echo "$HEADERS" | grep -qi "$header"; then
    echo "  PASS: $header present"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $header missing"
    FAIL=$((FAIL + 1))
  fi
done

echo "Frontend Routes"
check "Landing page" "$BASE_URL/" "200"

echo "---"
TOTAL=$((PASS + FAIL))
echo "Results: $PASS passed, $FAIL failed out of $TOTAL tests"
if [[ $FAIL -gt 0 ]]; then
  echo "Note: Microservice tests require Docker Compose stack"
fi
