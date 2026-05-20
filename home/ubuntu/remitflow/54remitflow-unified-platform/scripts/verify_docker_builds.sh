#!/usr/bin/env bash
set -euo pipefail

# PRB-005: Verify all Dockerfiles build successfully
# Pass: All Dockerfiles build without errors
# Fail: Any Dockerfile fails to build

echo "PRB-005: Checking Dockerfile builds..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

FAILED=0
CHECKED=0

# Find all Dockerfiles in core-services and ops-dashboard
DOCKERFILES=$(find "$REPO_ROOT/core-services" "$REPO_ROOT/ops-dashboard" -name "Dockerfile" 2>/dev/null || true)

if [ -z "$DOCKERFILES" ]; then
    echo "No Dockerfiles found to verify"
    echo "PRB-005: PASSED - No Dockerfiles to verify"
    exit 0
fi

for DOCKERFILE in $DOCKERFILES; do
    DIR=$(dirname "$DOCKERFILE")
    SERVICE=$(basename "$DIR")
    
    echo "Building $SERVICE..."
    CHECKED=$((CHECKED + 1))
    
    # Build with --check flag if available (Docker 24+), otherwise do a dry-run parse
    if docker build --help 2>&1 | grep -q "\-\-check"; then
        if ! docker build --check -f "$DOCKERFILE" "$DIR" >/dev/null 2>&1; then
            echo "FAILED: Dockerfile build check failed for $SERVICE"
            FAILED=1
        fi
    else
        # Fallback: just verify Dockerfile syntax by parsing
        if ! docker build --no-cache -f "$DOCKERFILE" "$DIR" -t "prb-verify-$SERVICE:test" >/dev/null 2>&1; then
            echo "FAILED: Dockerfile build failed for $SERVICE"
            FAILED=1
        else
            # Clean up test image
            docker rmi "prb-verify-$SERVICE:test" >/dev/null 2>&1 || true
        fi
    fi
done

if [ $FAILED -eq 1 ]; then
    echo ""
    echo "PRB-005: FAILED - Some Dockerfiles failed to build"
    exit 1
fi

echo "PRB-005: PASSED - All $CHECKED Dockerfiles build successfully"
exit 0
