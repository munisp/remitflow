#!/usr/bin/env bash
# RemitFlow — Dependency Vulnerability Audit
#
# Scans all package managers for known vulnerabilities:
#   - npm audit (TypeScript/Node.js)
#   - cargo audit (Rust)
#   - pip-audit (Python)
#   - govulncheck (Go)
#
# Usage:
#   ./qa/security/dependency-audit.sh
#
# CI/CD: Exits with code 1 if critical/high vulnerabilities found.

set -uo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  RemitFlow — Dependency Vulnerability Audit                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"

EXIT_CODE=0

# ─── npm audit ───────────────────────────────────────────────────────────────
echo ""
echo "── npm audit (TypeScript/Node.js) ──"
if command -v npm &>/dev/null; then
  npm audit --audit-level=high --json > qa/security/results/npm-audit.json 2>/dev/null || true
  CRITICAL=$(cat qa/security/results/npm-audit.json 2>/dev/null | grep -o '"critical":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
  HIGH=$(cat qa/security/results/npm-audit.json 2>/dev/null | grep -o '"high":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
  echo "  Critical: ${CRITICAL:-0}, High: ${HIGH:-0}"
  if [ "${CRITICAL:-0}" -gt 0 ]; then
    echo "  ❌ Critical npm vulnerabilities found"
    EXIT_CODE=1
  fi
else
  echo "  ⚠ npm not found — skipping"
fi

# ─── cargo audit (Rust) ─────────────────────────────────────────────────────
echo ""
echo "── cargo audit (Rust services) ──"
RUST_SERVICES=$(find services -name "Cargo.toml" -not -path "*/target/*" 2>/dev/null)
if [ -n "$RUST_SERVICES" ] && command -v cargo &>/dev/null; then
  for cargo_file in $RUST_SERVICES; do
    dir=$(dirname "$cargo_file")
    echo "  Scanning: $dir"
    if command -v cargo-audit &>/dev/null; then
      (cd "$dir" && cargo audit --json 2>/dev/null) > "qa/security/results/cargo-audit-$(basename $dir).json" || true
    else
      echo "    ⚠ cargo-audit not installed (install: cargo install cargo-audit)"
    fi
  done
else
  echo "  ⚠ No Rust services or cargo not found — skipping"
fi

# ─── pip-audit (Python) ─────────────────────────────────────────────────────
echo ""
echo "── pip-audit (Python services) ──"
PYTHON_SERVICES=$(find services -name "requirements.txt" 2>/dev/null)
if [ -n "$PYTHON_SERVICES" ]; then
  for req_file in $PYTHON_SERVICES; do
    dir=$(dirname "$req_file")
    echo "  Scanning: $dir"
    if command -v pip-audit &>/dev/null; then
      pip-audit -r "$req_file" --format json > "qa/security/results/pip-audit-$(basename $dir).json" 2>/dev/null || true
    else
      echo "    ⚠ pip-audit not installed (install: pip install pip-audit)"
    fi
  done
else
  echo "  ⚠ No Python requirements.txt found — skipping"
fi

# ─── govulncheck (Go) ───────────────────────────────────────────────────────
echo ""
echo "── govulncheck (Go services) ──"
GO_SERVICES=$(find services -name "go.mod" 2>/dev/null)
if [ -n "$GO_SERVICES" ] && command -v go &>/dev/null; then
  for go_mod in $GO_SERVICES; do
    dir=$(dirname "$go_mod")
    echo "  Scanning: $dir"
    if command -v govulncheck &>/dev/null; then
      (cd "$dir" && govulncheck -json ./... 2>/dev/null) > "qa/security/results/go-vuln-$(basename $dir).json" || true
    else
      echo "    ⚠ govulncheck not installed (install: go install golang.org/x/vuln/cmd/govulncheck@latest)"
    fi
  done
else
  echo "  ⚠ No Go services or go not found — skipping"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
if [ $EXIT_CODE -eq 0 ]; then
  echo "  ✓ No critical vulnerabilities found"
else
  echo "  ❌ Critical vulnerabilities detected — review reports in qa/security/results/"
fi
echo "══════════════════════════════════════════════════════════════"

exit $EXIT_CODE
