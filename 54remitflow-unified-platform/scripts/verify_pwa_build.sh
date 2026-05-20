#!/usr/bin/env bash
set -euo pipefail

# PRB-006: Verify PWA builds successfully
# Pass: npm run build completes without errors
# Fail: Build fails

echo "PRB-006: Checking PWA build..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [ ! -d "$REPO_ROOT/pwa" ]; then
    echo "PWA directory not found"
    echo "PRB-006: SKIPPED - No PWA directory"
    exit 0
fi

cd "$REPO_ROOT/pwa"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm ci || npm install
fi

# Run build
echo "Building PWA..."
if ! npm run build 2>&1; then
    echo ""
    echo "PRB-006: FAILED - PWA build failed"
    exit 1
fi

echo "PRB-006: PASSED - PWA builds successfully"
exit 0
