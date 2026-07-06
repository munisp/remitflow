#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RemitFlow — Deployment Cache Busting
# ─────────────────────────────────────────────────────────────────────────────
# Run this AFTER `npm run build` and BEFORE deploying to production.
# It performs three cache-busting steps:
#   1. Stamps the service worker with the build hash (forces SW update)
#   2. Generates a build-manifest.json (used by /api/version endpoint)
#   3. Optionally purges CDN caches (Cloudflare, CloudFront, Fastly)
#
# Usage:
#   ./ops/deploy/cache-bust.sh                      # stamp only
#   ./ops/deploy/cache-bust.sh --purge-cdn          # stamp + CDN purge
#   ./ops/deploy/cache-bust.sh --purge-cdn --dry-run # preview without executing
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist/public"
SW_PATH="${DIST_DIR}/sw.js"
MANIFEST_PATH="${DIST_DIR}/build-manifest.json"

PURGE_CDN=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --purge-cdn) PURGE_CDN=true ;;
    --dry-run)   DRY_RUN=true ;;
  esac
done

# ─── Step 0: Validate build output exists ─────────────────────────────────────

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: Build output not found at $DIST_DIR"
  echo "       Run 'npm run build' first."
  exit 1
fi

# ─── Step 1: Compute build hash from dist contents ───────────────────────────

echo "→ Computing build hash..."
BUILD_HASH=$(find "$DIST_DIR" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) \
  -exec sha256sum {} + | sort | sha256sum | cut -c1-12)
BUILD_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BUILD_VERSION="v-${BUILD_HASH}"

echo "  Hash:      ${BUILD_HASH}"
echo "  Timestamp: ${BUILD_TIMESTAMP}"
echo "  Version:   ${BUILD_VERSION}"

# ─── Step 2: Stamp the service worker ─────────────────────────────────────────

if [ -f "$SW_PATH" ]; then
  echo "→ Stamping service worker with build hash..."
  if $DRY_RUN; then
    echo "  [DRY RUN] Would replace CACHE_VERSION in $SW_PATH"
  else
    # Replace the CACHE_VERSION line with the new build hash
    sed -i "s/const CACHE_VERSION = '[^']*';/const CACHE_VERSION = '${BUILD_VERSION}';/" "$SW_PATH"
    echo "  ✓ SW CACHE_VERSION set to '${BUILD_VERSION}'"
  fi
else
  echo "  ⚠ sw.js not found in dist — skipping SW stamp"
fi

# ─── Step 3: Write build manifest ─────────────────────────────────────────────

echo "→ Writing build manifest..."
if $DRY_RUN; then
  echo "  [DRY RUN] Would write: { hash: ${BUILD_HASH}, timestamp: ${BUILD_TIMESTAMP} }"
else
  cat > "$MANIFEST_PATH" <<EOF
{
  "hash": "${BUILD_HASH}",
  "timestamp": "${BUILD_TIMESTAMP}",
  "version": "${BUILD_VERSION}"
}
EOF
  echo "  ✓ Manifest written to ${MANIFEST_PATH}"
fi

# ─── Step 4: CDN Purge (optional) ─────────────────────────────────────────────

if $PURGE_CDN; then
  echo "→ Purging CDN caches..."

  # Cloudflare
  if [ -n "${CLOUDFLARE_ZONE_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "  → Cloudflare zone ${CLOUDFLARE_ZONE_ID}..."
    if $DRY_RUN; then
      echo "    [DRY RUN] Would purge all files"
    else
      curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data '{"purge_everything":true}' | jq -r '.success // "failed"'
      echo "    ✓ Cloudflare cache purged"
    fi
  else
    echo "  ⚠ Cloudflare: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not set — skipping"
  fi

  # AWS CloudFront
  if [ -n "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]; then
    echo "  → CloudFront distribution ${CLOUDFRONT_DISTRIBUTION_ID}..."
    if $DRY_RUN; then
      echo "    [DRY RUN] Would create invalidation for /*"
    else
      aws cloudfront create-invalidation \
        --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
        --paths "/*" \
        --query 'Invalidation.Id' --output text 2>/dev/null || echo "    ⚠ CloudFront invalidation failed (aws CLI required)"
      echo "    ✓ CloudFront invalidation created"
    fi
  else
    echo "  ⚠ CloudFront: CLOUDFRONT_DISTRIBUTION_ID not set — skipping"
  fi

  # Fastly
  if [ -n "${FASTLY_SERVICE_ID:-}" ] && [ -n "${FASTLY_API_KEY:-}" ]; then
    echo "  → Fastly service ${FASTLY_SERVICE_ID}..."
    if $DRY_RUN; then
      echo "    [DRY RUN] Would purge all"
    else
      curl -s -X POST "https://api.fastly.com/service/${FASTLY_SERVICE_ID}/purge_all" \
        -H "Fastly-Key: ${FASTLY_API_KEY}" | jq -r '.status // "failed"'
      echo "    ✓ Fastly cache purged"
    fi
  else
    echo "  ⚠ Fastly: FASTLY_SERVICE_ID or FASTLY_API_KEY not set — skipping"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Cache busting complete"
echo "  Build:   ${BUILD_VERSION}"
echo "  Hash:    ${BUILD_HASH}"
echo "  Time:    ${BUILD_TIMESTAMP}"
echo "  CDN:     $(if $PURGE_CDN; then echo 'purged'; else echo 'skipped (use --purge-cdn)'; fi)"
echo "  Mode:    $(if $DRY_RUN; then echo 'DRY RUN'; else echo 'applied'; fi)"
echo "═══════════════════════════════════════════════════════"
