#!/usr/bin/env bash
set -euo pipefail

# PRB-002: Verify no mock data functions in production code
# Pass: No generateMock* or _generate_mock* functions in production paths
# Fail: Any mock function found outside test/debug code

echo "PRB-002: Checking for mock data functions in production code..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

FAILED=0

# Check Python services for _generate_mock* functions
# Exclude test files, __pycache__, and dev-only modules (dev_mock_data.py)
PYTHON_MATCHES=$(grep -rn "def _generate_mock\|def generate_mock" \
    "$REPO_ROOT/core-services" \
    --include="*.py" \
    2>/dev/null | grep -v "__pycache__" | grep -v "_test.py" | grep -v "test_" | grep -v "dev_mock_data.py" || true)

if [ -n "$PYTHON_MATCHES" ]; then
    echo "FAILED: Found mock functions in Python production code:"
    echo "$PYTHON_MATCHES"
    FAILED=1
fi

# Check iOS for generateMock* functions (excluding #if DEBUG blocks and Preview files)
if [ -d "$REPO_ROOT/ios-native" ]; then
    IOS_MATCHES=$(grep -rn "func generateMock" \
        "$REPO_ROOT/ios-native/RemittanceApp" \
        --include="*.swift" \
        2>/dev/null | grep -v "Preview" | grep -v "Tests" || true)
    
    if [ -n "$IOS_MATCHES" ]; then
        # Check if these are inside #if DEBUG blocks
        for match in $IOS_MATCHES; do
            FILE=$(echo "$match" | cut -d: -f1)
            LINE=$(echo "$match" | cut -d: -f2)
            
            # Check if there's a #if DEBUG before this line without a matching #endif
            BEFORE_LINES=$(head -n "$LINE" "$FILE" 2>/dev/null || true)
            DEBUG_COUNT=$(echo "$BEFORE_LINES" | grep -c "#if DEBUG" || true)
            ENDIF_COUNT=$(echo "$BEFORE_LINES" | grep -c "#endif" || true)
            
            if [ "$DEBUG_COUNT" -le "$ENDIF_COUNT" ]; then
                echo "FAILED: Found mock function outside #if DEBUG in iOS:"
                echo "$match"
                FAILED=1
            fi
        done
    fi
fi

# Check Android for generateMock* functions
if [ -d "$REPO_ROOT/android-native" ]; then
    ANDROID_MATCHES=$(grep -rn "fun generateMock" \
        "$REPO_ROOT/android-native/app/src/main" \
        --include="*.kt" \
        2>/dev/null | grep -v "Test" | grep -v "Preview" || true)
    
    if [ -n "$ANDROID_MATCHES" ]; then
        echo "FAILED: Found mock functions in Android production code:"
        echo "$ANDROID_MATCHES"
        FAILED=1
    fi
fi

# Check PWA for generateMock* functions
if [ -d "$REPO_ROOT/pwa/src" ]; then
    PWA_MATCHES=$(grep -rn "generateMock\|MOCK_DATA" \
        "$REPO_ROOT/pwa/src" \
        --include="*.ts" --include="*.tsx" \
        2>/dev/null | grep -v "node_modules" | grep -v ".test." | grep -v ".spec." || true)
    
    if [ -n "$PWA_MATCHES" ]; then
        echo "FAILED: Found mock functions in PWA production code:"
        echo "$PWA_MATCHES"
        FAILED=1
    fi
fi

if [ $FAILED -eq 1 ]; then
    echo ""
    echo "PRB-002: FAILED - Mock functions found in production code"
    exit 1
fi

echo "PRB-002: PASSED - No mock functions in production code"
exit 0
