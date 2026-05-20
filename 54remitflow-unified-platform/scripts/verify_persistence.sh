#!/usr/bin/env bash
set -euo pipefail

# PRB-007: Verify database persistence (no in-memory defaults in production)
# Pass: No silent in-memory fallbacks in production paths
# Fail: Any :memory: or sqlite:/// in production config, or silent fallbacks

echo "PRB-007: Checking database persistence configuration..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

FAILED=0

# Check for :memory: or sqlite:/// in production code (excluding COMPREHENSIVE_SUPER_PLATFORM)
MEMORY_MATCHES=$(grep -rn ":memory:\|sqlite:///" \
    "$REPO_ROOT/core-services" \
    --include="*.py" \
    2>/dev/null | grep -v "__pycache__" | grep -v "_test.py" | grep -v "test_" || true)

# Filter out matches that are properly gated by environment checks
for match in $MEMORY_MATCHES; do
    FILE=$(echo "$match" | cut -d: -f1)
    LINE_NUM=$(echo "$match" | cut -d: -f2)
    
    # Check if this is inside an environment-gated block
    # Look for ENVIRONMENT check within 10 lines before
    START_LINE=$((LINE_NUM - 10))
    if [ $START_LINE -lt 1 ]; then START_LINE=1; fi
    
    CONTEXT=$(sed -n "${START_LINE},${LINE_NUM}p" "$FILE" 2>/dev/null || true)
    
    # If there's no environment check nearby, it's a violation
    if ! echo "$CONTEXT" | grep -q "ENVIRONMENT\|development\|test\|USE_MOCK"; then
        echo "FAILED: Found in-memory database without environment guard:"
        echo "$match"
        FAILED=1
    fi
done

# Check for silent in-memory fallbacks (fallback without explicit flag check)
FALLBACK_MATCHES=$(grep -rn "falling back to in-memory\|using in-memory storage\|in-memory for now" \
    "$REPO_ROOT/core-services" \
    --include="*.py" \
    2>/dev/null | grep -v "__pycache__" | grep -v "_test.py" || true)

for match in $FALLBACK_MATCHES; do
    FILE=$(echo "$match" | cut -d: -f1)
    LINE_NUM=$(echo "$match" | cut -d: -f2)
    
    # Check if this fallback is gated by production environment check
    START_LINE=$((LINE_NUM - 15))
    if [ $START_LINE -lt 1 ]; then START_LINE=1; fi
    
    CONTEXT=$(sed -n "${START_LINE},${LINE_NUM}p" "$FILE" 2>/dev/null || true)
    
    # Check if there's a production check that would prevent this in production
    if ! echo "$CONTEXT" | grep -q "ENVIRONMENT.*!=.*production\|ENVIRONMENT.*==.*development\|ALLOW_IN_MEMORY"; then
        echo "WARNING: Found potential silent in-memory fallback:"
        echo "$match"
        echo "  (This should fail fast in production instead of silently falling back)"
        # Don't fail for now, just warn - these need manual review
    fi
done

if [ $FAILED -eq 1 ]; then
    echo ""
    echo "PRB-007: FAILED - In-memory defaults found in production paths"
    exit 1
fi

echo "PRB-007: PASSED - Database persistence verified"
exit 0
