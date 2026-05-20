#!/usr/bin/env bash
set -euo pipefail

# PRB-004: Verify all Python services compile
# Pass: All Python files compile without syntax errors
# Fail: Any syntax error found

echo "PRB-004: Checking Python compilation..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

FAILED=0

# Compile all Python files in core-services
if [ -d "$REPO_ROOT/core-services" ]; then
    echo "Compiling core-services..."
    if ! python3 -m compileall -q "$REPO_ROOT/core-services" 2>&1; then
        echo "FAILED: Python compilation errors in core-services"
        FAILED=1
    fi
fi

# Compile ops-dashboard if it exists
if [ -d "$REPO_ROOT/ops-dashboard" ] && [ -f "$REPO_ROOT/ops-dashboard/main.py" ]; then
    echo "Compiling ops-dashboard..."
    if ! python3 -m compileall -q "$REPO_ROOT/ops-dashboard" 2>&1; then
        echo "FAILED: Python compilation errors in ops-dashboard"
        FAILED=1
    fi
fi

if [ $FAILED -eq 1 ]; then
    echo ""
    echo "PRB-004: FAILED - Python compilation errors found"
    exit 1
fi

echo "PRB-004: PASSED - All Python services compile successfully"
exit 0
