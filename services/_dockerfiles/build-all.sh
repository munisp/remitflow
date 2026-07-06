#!/usr/bin/env bash
set -euo pipefail

# Build all polyglot service Docker images
#
# Usage:
#   ./services/_dockerfiles/build-all.sh                    # Build all
#   ./services/_dockerfiles/build-all.sh --push             # Build + push to registry
#   ./services/_dockerfiles/build-all.sh --service=go-*     # Build only Go services
#
# Requires: docker (or podman aliased to docker)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICES_DIR="$(dirname "$SCRIPT_DIR")"
REGISTRY="${REGISTRY:-remitflow}"
TAG="${TAG:-latest}"
PUSH=false
FILTER="*"

for arg in "$@"; do
  case $arg in
    --push) PUSH=true ;;
    --service=*) FILTER="${arg#*=}" ;;
    --registry=*) REGISTRY="${arg#*=}" ;;
    --tag=*) TAG="${arg#*=}" ;;
  esac
done

log() { echo "[$(date -u '+%H:%M:%S')] $*"; }

build_count=0
fail_count=0

# ── Go Services ────────────────────────────────────────────────────────────────

for dir in "$SERVICES_DIR"/go-$FILTER; do
  if [[ ! -d "$dir" ]] || [[ ! -f "$dir/go.mod" ]]; then
    continue
  fi

  name=$(basename "$dir")
  log "Building $name (Go)..."

  if docker build \
    -f "$SCRIPT_DIR/Dockerfile.go" \
    --build-arg "SERVICE_NAME=$name" \
    -t "$REGISTRY/$name:$TAG" \
    "$dir" 2>/dev/null; then
    log "  ✓ $name built"
    ((build_count++))
    if [[ "$PUSH" == "true" ]]; then
      docker push "$REGISTRY/$name:$TAG"
    fi
  else
    log "  ✗ $name FAILED"
    ((fail_count++))
  fi
done

# ── Rust Services ──────────────────────────────────────────────────────────────

for dir in "$SERVICES_DIR"/rust-$FILTER; do
  if [[ ! -d "$dir" ]] || [[ ! -f "$dir/Cargo.toml" ]]; then
    continue
  fi

  name=$(basename "$dir")
  log "Building $name (Rust)..."

  if docker build \
    -f "$SCRIPT_DIR/Dockerfile.rust" \
    --build-arg "SERVICE_NAME=$name" \
    -t "$REGISTRY/$name:$TAG" \
    "$dir" 2>/dev/null; then
    log "  ✓ $name built"
    ((build_count++))
    if [[ "$PUSH" == "true" ]]; then
      docker push "$REGISTRY/$name:$TAG"
    fi
  else
    log "  ✗ $name FAILED"
    ((fail_count++))
  fi
done

# ── Python Services ────────────────────────────────────────────────────────────

for dir in "$SERVICES_DIR"/python-$FILTER; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi

  name=$(basename "$dir")
  log "Building $name (Python)..."

  if docker build \
    -f "$SCRIPT_DIR/Dockerfile.python" \
    --build-arg "SERVICE_NAME=$name" \
    -t "$REGISTRY/$name:$TAG" \
    "$dir" 2>/dev/null; then
    log "  ✓ $name built"
    ((build_count++))
    if [[ "$PUSH" == "true" ]]; then
      docker push "$REGISTRY/$name:$TAG"
    fi
  else
    log "  ✗ $name FAILED"
    ((fail_count++))
  fi
done

log "Done: $build_count built, $fail_count failed"
exit $((fail_count > 0 ? 1 : 0))
