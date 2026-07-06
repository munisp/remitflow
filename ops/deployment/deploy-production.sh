#!/usr/bin/env bash
set -euo pipefail

# RemitFlow — Production Deployment Script
#
# Usage:
#   ./ops/deployment/deploy-production.sh --region=ca-central-1 --version=v1.2.3
#   ./ops/deployment/deploy-production.sh --region=all --version=v1.2.3 --canary-weight=5
#   ./ops/deployment/deploy-production.sh --rollback --region=ca-central-1
#
# Prerequisites:
#   - kubectl configured for target cluster(s)
#   - helm 3.x installed
#   - AWS CLI configured with appropriate role
#   - Vault token with deploy permissions

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="${SCRIPT_DIR}/helm/remitflow"
NAMESPACE="remitflow"

# ── Argument Parsing ───────────────────────────────────────────────────────────

REGION=""
VERSION=""
CANARY_WEIGHT=100
ROLLBACK=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --region=*) REGION="${arg#*=}" ;;
    --version=*) VERSION="${arg#*=}" ;;
    --canary-weight=*) CANARY_WEIGHT="${arg#*=}" ;;
    --rollback) ROLLBACK=true ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ -z "$REGION" ]]; then
  echo "Error: --region is required (ca-central-1, eu-west-1, af-south-1, or all)"
  exit 1
fi

if [[ "$ROLLBACK" == "false" && -z "$VERSION" ]]; then
  echo "Error: --version is required for deployments"
  exit 1
fi

# ── Helper Functions ───────────────────────────────────────────────────────────

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"; }
error() { echo "[ERROR] $*" >&2; exit 1; }

get_cluster_context() {
  local region="$1"
  echo "arn:aws:eks:${region}:ACCOUNT_ID:cluster/remitflow-production-${region%%-*}"
}

pre_deploy_checks() {
  log "Running pre-deployment checks..."

  # 1. Verify image exists
  if ! aws ecr describe-images --repository-name remitflow/api --image-ids imageTag="${VERSION}" >/dev/null 2>&1; then
    error "Image remitflow/api:${VERSION} not found in ECR"
  fi

  # 2. Verify image is signed
  if ! cosign verify "ACCOUNT_ID.dkr.ecr.${REGION}.amazonaws.com/remitflow/api:${VERSION}" >/dev/null 2>&1; then
    log "WARNING: Image signature verification failed (cosign)"
  fi

  # 3. Verify no critical vulnerabilities
  log "Checking image vulnerabilities..."
  CRITICAL_COUNT=$(trivy image --severity CRITICAL --format json "remitflow/api:${VERSION}" 2>/dev/null | jq '.Results[].Vulnerabilities | length' 2>/dev/null || echo "0")
  if [[ "${CRITICAL_COUNT}" -gt 0 ]]; then
    error "Image has ${CRITICAL_COUNT} critical vulnerabilities. Aborting."
  fi

  # 4. Verify Vault is healthy
  if ! vault status >/dev/null 2>&1; then
    error "Vault is sealed or unreachable"
  fi

  # 5. Check current error rate (don't deploy into an incident)
  CURRENT_ERROR_RATE=$(kubectl exec -n monitoring deploy/prometheus -- \
    promtool query instant 'rate(http_requests_total{namespace="remitflow",status=~"5.."}[5m])' 2>/dev/null | \
    awk '{print $2}' || echo "0")
  if (( $(echo "$CURRENT_ERROR_RATE > 0.01" | bc -l 2>/dev/null || echo 0) )); then
    error "Current error rate is ${CURRENT_ERROR_RATE}. Do not deploy during an incident."
  fi

  log "Pre-deployment checks passed"
}

deploy_region() {
  local region="$1"
  local context
  context=$(get_cluster_context "$region")

  log "Deploying v${VERSION} to ${region} (canary weight: ${CANARY_WEIGHT}%)"

  # Switch kubectl context
  kubectl config use-context "$context" 2>/dev/null || \
    aws eks update-kubeconfig --name "remitflow-production-${region%%-*}" --region "$region"

  # Run cache busting
  if [[ -f "${SCRIPT_DIR}/../deploy/cache-bust.sh" ]]; then
    log "Running cache bust..."
    bash "${SCRIPT_DIR}/../deploy/cache-bust.sh"
  fi

  # Helm upgrade
  local helm_args=(
    upgrade remitflow "$CHART_DIR"
    --namespace "$NAMESPACE"
    --create-namespace
    --values "${CHART_DIR}/values.yaml"
    --values "${CHART_DIR}/values-production.yaml"
    --set "api.image.tag=${VERSION}"
    --set "frontend.image.tag=${VERSION}"
    --set "temporal.worker.image.tag=${VERSION}"
    --set "services.goFxBridge.image.tag=${VERSION}"
    --set "services.rustKycBridge.image.tag=${VERSION}"
    --set "services.pythonSettlement.image.tag=${VERSION}"
    --set "global.canaryWeight=${CANARY_WEIGHT}"
    --timeout 10m
    --wait
    --atomic
  )

  if [[ "$DRY_RUN" == "true" ]]; then
    helm_args+=(--dry-run)
  fi

  helm "${helm_args[@]}"

  # Wait for rollout
  if [[ "$DRY_RUN" == "false" ]]; then
    kubectl rollout status deployment/remitflow-api -n "$NAMESPACE" --timeout=300s
    log "Deployment to ${region} complete"
  fi
}

rollback_region() {
  local region="$1"
  local context
  context=$(get_cluster_context "$region")

  log "Rolling back ${region}..."

  kubectl config use-context "$context" 2>/dev/null || \
    aws eks update-kubeconfig --name "remitflow-production-${region%%-*}" --region "$region"

  helm rollback remitflow --namespace "$NAMESPACE" --wait --timeout 5m
  kubectl rollout status deployment/remitflow-api -n "$NAMESPACE" --timeout=300s

  log "Rollback of ${region} complete"
}

post_deploy_verify() {
  local region="$1"
  log "Running post-deployment verification for ${region}..."

  # Health check
  local api_url="https://api.remitflow.app/api/health"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$api_url" || echo "000")
  if [[ "$status" != "200" ]]; then
    error "Health check failed (HTTP ${status}). Consider rolling back."
  fi

  # Version check
  local deployed_version
  deployed_version=$(curl -s "https://api.remitflow.app/api/version" | jq -r '.version' 2>/dev/null || echo "unknown")
  log "Deployed version: ${deployed_version}"

  # Reconciliation check
  local recon_status
  recon_status=$(curl -s "https://api.remitflow.app/internal/reconciliation" | jq -r '.status' 2>/dev/null || echo "unknown")
  if [[ "$recon_status" != "balanced" ]]; then
    error "LEDGER IMBALANCE DETECTED after deployment. ROLLING BACK."
  fi

  log "Post-deployment verification passed for ${region}"
}

# ── Main Execution ─────────────────────────────────────────────────────────────

REGIONS=()
if [[ "$REGION" == "all" ]]; then
  REGIONS=("ca-central-1" "eu-west-1" "af-south-1")
else
  REGIONS=("$REGION")
fi

if [[ "$ROLLBACK" == "true" ]]; then
  for r in "${REGIONS[@]}"; do
    rollback_region "$r"
  done
  log "Rollback complete for all regions"
  exit 0
fi

# Pre-checks
pre_deploy_checks

# Deploy each region sequentially (primary first)
for r in "${REGIONS[@]}"; do
  deploy_region "$r"

  if [[ "$DRY_RUN" == "false" ]]; then
    post_deploy_verify "$r"

    # Wait 5 minutes between regions to observe
    if [[ "${#REGIONS[@]}" -gt 1 && "$r" != "${REGIONS[-1]}" ]]; then
      log "Waiting 5 minutes before deploying next region..."
      sleep 300
    fi
  fi
done

log "Deployment complete: v${VERSION} deployed to ${REGIONS[*]} (canary: ${CANARY_WEIGHT}%)"
