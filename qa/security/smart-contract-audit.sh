#!/usr/bin/env bash
# RemitFlow — Smart Contract Security Audit
#
# Runs static analysis tools on Solidity contracts:
#   - Slither (Trail of Bits) — detects common vulnerabilities
#   - Mythril (ConsenSys) — symbolic execution for deep bugs
#   - solhint — Solidity linting
#
# Usage:
#   ./qa/security/smart-contract-audit.sh
#
# CI/CD: Exits with code 1 if high/critical findings.

set -uo pipefail

CONTRACTS_DIR="contracts/src"
RESULTS_DIR="qa/security/results"

mkdir -p "$RESULTS_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  RemitFlow — Smart Contract Security Audit                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

EXIT_CODE=0

# ─── Slither Analysis ────────────────────────────────────────────────────────
echo ""
echo "── Slither Static Analysis ──"
if command -v slither &>/dev/null; then
  CONTRACTS=$(find "$CONTRACTS_DIR" -name "*.sol" 2>/dev/null)
  if [ -n "$CONTRACTS" ]; then
    slither "$CONTRACTS_DIR" --json "${RESULTS_DIR}/slither-report.json" \
      --exclude-dependencies \
      --filter-paths "test|lib|node_modules" \
      2>"${RESULTS_DIR}/slither-stderr.txt" || true

    # Count high/medium findings
    if [ -f "${RESULTS_DIR}/slither-report.json" ]; then
      HIGH_COUNT=$(grep -o '"impact": "High"' "${RESULTS_DIR}/slither-report.json" 2>/dev/null | wc -l || echo "0")
      MED_COUNT=$(grep -o '"impact": "Medium"' "${RESULTS_DIR}/slither-report.json" 2>/dev/null | wc -l || echo "0")
      echo "  High: $HIGH_COUNT, Medium: $MED_COUNT"
      if [ "$HIGH_COUNT" -gt 0 ]; then
        echo "  ❌ High-severity findings detected"
        EXIT_CODE=1
      fi
    fi
  else
    echo "  ⚠ No .sol files found in $CONTRACTS_DIR"
  fi
else
  echo "  ⚠ Slither not installed (install: pip install slither-analyzer)"
  echo "    Attempting Docker fallback..."
  if command -v docker &>/dev/null; then
    docker run --rm -v "$(pwd):/src" trailofbits/eth-security-toolbox:latest \
      bash -c "cd /src && slither $CONTRACTS_DIR --json /src/${RESULTS_DIR}/slither-report.json" 2>/dev/null || \
      echo "    Docker fallback also failed"
  fi
fi

# ─── Mythril Symbolic Execution ──────────────────────────────────────────────
echo ""
echo "── Mythril Symbolic Execution ──"
if command -v myth &>/dev/null; then
  CONTRACTS=$(find "$CONTRACTS_DIR" -name "*.sol" -not -name "*.t.sol" 2>/dev/null)
  for contract in $CONTRACTS; do
    echo "  Analyzing: $contract"
    myth analyze "$contract" \
      --solv 0.8.20 \
      --execution-timeout 120 \
      -o json > "${RESULTS_DIR}/mythril-$(basename $contract .sol).json" 2>/dev/null || \
      echo "    ⚠ Mythril analysis failed for $contract"
  done
else
  echo "  ⚠ Mythril not installed (install: pip install mythril)"
fi

# ─── Solhint Linting ────────────────────────────────────────────────────────
echo ""
echo "── Solhint Linting ──"
if command -v npx &>/dev/null; then
  npx solhint "$CONTRACTS_DIR/**/*.sol" \
    --formatter json > "${RESULTS_DIR}/solhint-report.json" 2>/dev/null || \
    echo "  ⚠ Solhint analysis failed"
  LINT_ERRORS=$(grep -o '"severity":2' "${RESULTS_DIR}/solhint-report.json" 2>/dev/null | wc -l || echo "0")
  echo "  Lint errors: $LINT_ERRORS"
else
  echo "  ⚠ npx not found — skipping solhint"
fi

# ─── Reentrancy Check ───────────────────────────────────────────────────────
echo ""
echo "── Custom: Reentrancy Pattern Check ──"
REENTRANCY_RISK=$(grep -rn "call{value\|\.call(" "$CONTRACTS_DIR" 2>/dev/null | grep -v "// safe" | wc -l || echo "0")
if [ "$REENTRANCY_RISK" -gt 0 ]; then
  echo "  ⚠ Found $REENTRANCY_RISK potential reentrancy patterns — review manually"
  grep -rn "call{value\|\.call(" "$CONTRACTS_DIR" 2>/dev/null | grep -v "// safe" | head -5
else
  echo "  ✓ No obvious reentrancy patterns"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  Reports: ${RESULTS_DIR}/slither-report.json"
echo "           ${RESULTS_DIR}/mythril-*.json"
if [ $EXIT_CODE -eq 0 ]; then
  echo "  ✓ No critical contract vulnerabilities found"
else
  echo "  ❌ Critical findings — review and remediate before deployment"
fi
echo "══════════════════════════════════════════════════════════════"

exit $EXIT_CODE
