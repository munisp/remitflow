#!/usr/bin/env bash
set -euo pipefail

# PRB-001: Verify no hardcoded credentials in infrastructure YAML files
# Pass: No hardcoded credentials found
# Fail: Any password/secret/api_key/token with actual values found

echo "PRB-001: Checking for hardcoded credentials in infrastructure YAML..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Patterns that indicate hardcoded credentials (not env var references)
# We look for patterns like: password: "actualvalue" or password=actualvalue
# But exclude patterns like: password: ${VAR} or password: "" or password: null

FAILED=0

# Check infrastructure YAML files
if [ -d "$REPO_ROOT/infrastructure" ]; then
    MATCHES=$(grep -rEin "(password|secret|api_key|apikey|token)[[:space:]]*[:=][[:space:]]*['\"][^$\{\}][^'\"]+['\"]" \
        "$REPO_ROOT/infrastructure" \
        --include="*.yaml" --include="*.yml" 2>/dev/null || true)
    
    if [ -n "$MATCHES" ]; then
        echo "FAILED: Found potential hardcoded credentials in infrastructure:"
        echo "$MATCHES"
        FAILED=1
    fi
fi

# Check GitHub workflows
if [ -d "$REPO_ROOT/.github/workflows" ]; then
    MATCHES=$(grep -rEin "(password|secret|api_key|apikey|token)[[:space:]]*[:=][[:space:]]*['\"][^$\{\}][^'\"]+['\"]" \
        "$REPO_ROOT/.github/workflows" \
        --include="*.yaml" --include="*.yml" 2>/dev/null || true)
    
    if [ -n "$MATCHES" ]; then
        echo "FAILED: Found potential hardcoded credentials in workflows:"
        echo "$MATCHES"
        FAILED=1
    fi
fi

if [ $FAILED -eq 1 ]; then
    echo ""
    echo "PRB-001: FAILED - Hardcoded credentials found"
    exit 1
fi

echo "PRB-001: PASSED - No hardcoded credentials found"
exit 0
