#!/usr/bin/env bash
set -euo pipefail

# PRB-003: Verify no TODO/FIXME placeholders in production code
# Pass: No TODO/FIXME/XXX/HACK comments found
# Fail: Any placeholder comment found (excluding UI placeholder text)

echo "PRB-003: Checking for TODO/FIXME placeholders..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

FAILED=0

# Check Python services
# Exclude: test files, __pycache__, and comments that are just documentation
PYTHON_MATCHES=$(grep -rn "# TODO\|# FIXME\|# XXX\|# HACK" \
    "$REPO_ROOT/core-services" \
    --include="*.py" \
    2>/dev/null | grep -v "__pycache__" | grep -v "_test.py" | grep -v "test_" || true)

if [ -n "$PYTHON_MATCHES" ]; then
    echo "FAILED: Found TODO/FIXME in Python code:"
    echo "$PYTHON_MATCHES"
    FAILED=1
fi

# Check TypeScript/React (PWA)
# Exclude: node_modules, test files, and placeholder text in UI (like phone formats)
if [ -d "$REPO_ROOT/pwa/src" ]; then
    PWA_MATCHES=$(grep -rn "// TODO\|// FIXME\|// XXX\|// HACK" \
        "$REPO_ROOT/pwa/src" \
        --include="*.ts" --include="*.tsx" \
        2>/dev/null | grep -v "node_modules" | grep -v ".test." | grep -v ".spec." || true)
    
    if [ -n "$PWA_MATCHES" ]; then
        echo "FAILED: Found TODO/FIXME in PWA code:"
        echo "$PWA_MATCHES"
        FAILED=1
    fi
fi

# Check Kotlin (Android)
if [ -d "$REPO_ROOT/android-native" ]; then
    ANDROID_MATCHES=$(grep -rn "// TODO\|// FIXME\|// XXX\|// HACK" \
        "$REPO_ROOT/android-native/app/src/main" \
        --include="*.kt" \
        2>/dev/null | grep -v "Test" || true)
    
    if [ -n "$ANDROID_MATCHES" ]; then
        echo "FAILED: Found TODO/FIXME in Android code:"
        echo "$ANDROID_MATCHES"
        FAILED=1
    fi
fi

# Check Swift (iOS)
if [ -d "$REPO_ROOT/ios-native" ]; then
    IOS_MATCHES=$(grep -rn "// TODO\|// FIXME\|// XXX\|// HACK" \
        "$REPO_ROOT/ios-native/RemittanceApp" \
        --include="*.swift" \
        2>/dev/null | grep -v "Tests" | grep -v "Preview" || true)
    
    if [ -n "$IOS_MATCHES" ]; then
        echo "FAILED: Found TODO/FIXME in iOS code:"
        echo "$IOS_MATCHES"
        FAILED=1
    fi
fi

if [ $FAILED -eq 1 ]; then
    echo ""
    echo "PRB-003: FAILED - TODO/FIXME placeholders found"
    exit 1
fi

echo "PRB-003: PASSED - No TODO/FIXME placeholders found"
exit 0
